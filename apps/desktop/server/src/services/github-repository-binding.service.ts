import type { GitHubRepositoryConnectionStatus as ContractConnectionStatus } from "@rudel/api-routes";
import type postgres from "postgres";
import {
	type GitHubRepositoryReadiness,
	readGitHubOutcomesReadiness,
} from "./github-outcomes-readiness.service.js";

type GitHubRepositorySyncState = NonNullable<
	ContractConnectionStatus["repositories"][number]["sync"]
>;

export interface GitHubRepositoryBinding {
	readonly sync?: GitHubRepositorySyncState;
	readonly defaultBranch: string;
	readonly installationId: string;
	readonly isPrivate: boolean;
	readonly name: string;
	readonly nodeId: string;
	readonly organizationId: string;
	readonly owner: string;
	readonly repositoryId: string;
}

export interface GitHubRepositoryConnectionStatus {
	readonly accountLogin: string | null;
	readonly accountType: "Organization" | "User" | null;
	readonly suspended: boolean;
	readonly connected: boolean;
	readonly installationId: string | null;
	readonly manageUrl: string | null;
	readonly repositories: readonly GitHubRepositoryBinding[];
	readonly repositorySelection: "all" | "selected" | null;
}

export function createGitHubInstallationManagementUrl(input: {
	readonly accountLogin: string;
	readonly accountType: "Organization" | "User";
	readonly installationId: string;
}): string {
	if (input.accountType === "Organization") {
		return new URL(
			`/organizations/${encodeURIComponent(input.accountLogin)}/settings/installations/${encodeURIComponent(input.installationId)}`,
			"https://github.com",
		).toString();
	}
	return new URL(
		`/settings/installations/${encodeURIComponent(input.installationId)}`,
		"https://github.com",
	).toString();
}

export async function getGitHubRepositoryConnectionStatus(input: {
	readonly database: postgres.Sql;
	readonly organizationId: string;
}): Promise<GitHubRepositoryConnectionStatus> {
	const installations = await input.database.unsafe<
		Array<{
			account_login: string;
			account_type: "Organization" | "User";
			installation_id: string;
			repository_selection: "all" | "selected";
			status: "active" | "suspended";
		}>
	>(
		"SELECT installation_id, account_login, account_type, repository_selection, status FROM github_app_installation WHERE organization_id = $1 AND status IN ('active', 'suspended') ORDER BY updated_at DESC LIMIT 1",
		[input.organizationId],
	);
	const installation = installations[0];
	if (!installation) {
		return {
			accountLogin: null,
			accountType: null,
			suspended: false,
			connected: false,
			installationId: null,
			manageUrl: null,
			repositories: [],
			repositorySelection: null,
		};
	}
	const repositories = await input.database.unsafe<
		Array<{
			default_branch: string;
			installation_id: string;
			is_private: boolean;
			name: string;
			node_id: string;
			organization_id: string;
			owner: string;
			repository_id: string;
		}>
	>(
		"SELECT organization_id, repository_id, installation_id, node_id, owner, name, default_branch, is_private FROM github_repository_binding WHERE organization_id = $1 AND installation_id = $2 AND status = 'active' ORDER BY lower(owner), lower(name), repository_id",
		[input.organizationId, installation.installation_id],
	);
	const [readiness, windows] = await Promise.all([
		readGitHubOutcomesReadiness(input.database, input.organizationId),
		input.database.unsafe<
			Array<{ repository_id: string; done: number; total: number }>
		>(
			`SELECT repository_id, count(*) FILTER (WHERE status IN ('complete', 'unavailable'))::int AS done, count(*) FILTER (WHERE status <> 'split')::int AS total
			 FROM github_repository_sweep WHERE organization_id = $1 GROUP BY repository_id, dataset`,
			[input.organizationId],
		),
	]);
	const progressByRepository = readSweepProgress(windows);
	const readinessByRepository = new Map(
		readiness?.details.repositories.map((repository) => [
			repository.repositoryId,
			repository,
		]),
	);
	return {
		accountLogin: installation.account_login,
		accountType: installation.account_type,
		suspended: installation.status === "suspended",
		connected: true,
		installationId: installation.installation_id,
		manageUrl: createGitHubInstallationManagementUrl({
			accountLogin: installation.account_login,
			accountType: installation.account_type,
			installationId: installation.installation_id,
		}),
		repositories: repositories.map((row) => ({
			...mapBindingRow(row),
			sync: toRepositorySyncState(
				readinessByRepository.get(row.repository_id),
				progressByRepository.get(row.repository_id),
			),
		})),
		repositorySelection: installation.repository_selection,
	};
}

export async function getGitHubRepositoryBinding(input: {
	readonly database: postgres.Sql;
	readonly organizationId: string;
	readonly repositoryId: string;
}): Promise<GitHubRepositoryBinding | null> {
	const rows = await input.database.unsafe<
		Array<{
			default_branch: string;
			installation_id: string;
			is_private: boolean;
			name: string;
			node_id: string;
			organization_id: string;
			owner: string;
			repository_id: string;
		}>
	>(
		"SELECT binding.organization_id, binding.repository_id, binding.installation_id, binding.node_id, binding.owner, binding.name, binding.default_branch, binding.is_private FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id WHERE binding.organization_id = $1 AND binding.repository_id = $2 AND binding.status = 'active' AND installation.status = 'active' LIMIT 1",
		[input.organizationId, input.repositoryId],
	);
	return rows[0] ? mapBindingRow(rows[0]) : null;
}

function mapBindingRow(row: {
	readonly default_branch: string;
	readonly installation_id: string;
	readonly is_private: boolean;
	readonly name: string;
	readonly node_id: string;
	readonly organization_id: string;
	readonly owner: string;
	readonly repository_id: string;
}): GitHubRepositoryBinding {
	return {
		defaultBranch: row.default_branch,
		installationId: row.installation_id,
		isPrivate: row.is_private,
		name: row.name,
		nodeId: row.node_id,
		organizationId: row.organization_id,
		owner: row.owner,
		repositoryId: row.repository_id,
	};
}

function toRepositorySyncState(
	readiness: GitHubRepositoryReadiness | undefined,
	progress: number | undefined,
): GitHubRepositorySyncState {
	if (readiness?.reason === "github-403")
		return { state: "unavailable", reason: "no-access" };
	if (readiness?.reason === "github-404")
		return { state: "unavailable", reason: "not-found" };
	if (readiness?.included) return { state: "ready" };
	return progress === undefined
		? { state: "syncing" }
		: { state: "syncing", progress };
}

/** Per repository: the mean, over its datasets, of finished history windows. */
function readSweepProgress(
	windows: ReadonlyArray<{
		repository_id: string;
		done: number;
		total: number;
	}>,
): Map<string, number> {
	const shares = new Map<string, number[]>();
	for (const { repository_id: repositoryId, done, total } of windows) {
		if (total <= 0) continue;
		shares.set(repositoryId, [
			...(shares.get(repositoryId) ?? []),
			Math.min(1, done / total),
		]);
	}
	return new Map(
		[...shares].map(([repositoryId, values]) => [
			repositoryId,
			values.reduce((sum, value) => sum + value, 0) / values.length,
		]),
	);
}
