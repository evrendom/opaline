import type {
	RepositoryEvidenceProviderIdentity,
	RepositoryEvidenceRemoteHint,
	RepositoryEvidenceRepositoryIdentity,
} from "@rudel/api-routes";
import type postgres from "postgres";

export interface RepositoryBindingLookupInput {
	readonly name: string;
	readonly organizationId: string;
	readonly owner: string;
}

export type RepositoryBindingLookupResult = Readonly<{
	name: string;
	nodeId: string;
	owner: string;
	repositoryId: string;
}>;

export class RepositoryEvidenceRepositoryBindingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RepositoryEvidenceRepositoryBindingError";
	}
}

export async function resolveTrustedRepositoryIdentity(input: {
	readonly lookup: (
		input: RepositoryBindingLookupInput,
	) => Promise<RepositoryBindingLookupResult | null>;
	readonly organizationId: string;
	readonly repository: RepositoryEvidenceRepositoryIdentity;
}): Promise<RepositoryEvidenceRepositoryIdentity> {
	if (input.repository.provider !== null) {
		throw new RepositoryEvidenceRepositoryBindingError(
			"Repository provider identity must be resolved by the server.",
		);
	}
	const hint = input.repository.remoteHint;
	if (!hint) return input.repository;
	const binding = await input.lookup({
		name: hint.name,
		organizationId: input.organizationId,
		owner: hint.owner,
	});
	const provider = binding ? toProviderIdentity(hint, binding) : null;
	return { ...input.repository, provider };
}

export function createPostgresRepositoryBindingLookup(
	database: postgres.Sql,
): (
	input: RepositoryBindingLookupInput,
) => Promise<RepositoryBindingLookupResult | null> {
	return async (input) => {
		const rows = await database.unsafe<
			Array<{
				name: string;
				node_id: string;
				owner: string;
				repository_id: string;
			}>
		>(
			"SELECT binding.repository_id, binding.node_id, binding.owner, binding.name FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id WHERE binding.organization_id = $1 AND lower(binding.owner) = lower($2) AND lower(binding.name) = lower($3) AND binding.status = 'active' AND installation.status = 'active' LIMIT 1",
			[input.organizationId, input.owner, input.name],
		);
		const row = rows[0];
		return row
			? {
					name: row.name,
					nodeId: row.node_id,
					owner: row.owner,
					repositoryId: row.repository_id,
				}
			: null;
	};
}

function toProviderIdentity(
	hint: RepositoryEvidenceRemoteHint,
	binding: RepositoryBindingLookupResult,
): RepositoryEvidenceProviderIdentity {
	return {
		host: hint.host,
		name: binding.name,
		nodeId: binding.nodeId,
		owner: binding.owner,
		provider: "github",
		repositoryId: binding.repositoryId,
	};
}
