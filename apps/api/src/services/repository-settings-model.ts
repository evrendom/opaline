import {
	type RepositorySettings,
	RepositoryUploadSettingsSchema,
	unifyRepoIdentities,
} from "@rudel/api-routes";
import { toRepoIdentityInput } from "./repo-identity-rows.js";

export interface RepositoryInventory {
	project_path: string;
	git_remote: string;
	package_name: string;
	session_count: number;
}

export interface SavedRepositoryReport {
	installation_id: string;
	repositories: unknown;
	reported_at: string | Date;
}

export function buildRepositorySettings(
	inventory: RepositoryInventory[],
	savedReports: SavedRepositoryReport[],
): RepositorySettings {
	const resolver = unifyRepoIdentities(inventory.map(toRepoIdentityInput));
	const reports = savedReports.map((report) => ({
		...report,
		repositories: RepositoryUploadSettingsSchema.parse(report.repositories),
	}));
	// A CLI can confirm which legacy worktree identity belongs to its saved repo.
	// Conflicting claims remain separate; matching by display name is ambiguous.
	const aliases = new Map<string, string | null>();
	for (const report of reports) {
		for (const setting of report.repositories) {
			for (const alias of [setting.key, ...(setting.aliases ?? [])]) {
				const repoKey = resolver.resolveKey(alias);
				const previous = aliases.get(repoKey);
				aliases.set(
					repoKey,
					previous === undefined || previous === setting.key
						? setting.key
						: null,
				);
			}
		}
	}
	const repositories = new Map<
		string,
		RepositorySettings["repositories"][number]
	>();
	for (const row of inventory) {
		const identity = resolver.resolve(toRepoIdentityInput(row));
		const key = aliases.get(identity.repoKey) ?? identity.repoKey;
		const previous = repositories.get(key);
		repositories.set(key, {
			key,
			name: identity.repoLabel,
			sessionCount: (previous?.sessionCount ?? 0) + Number(row.session_count),
			reports: [],
		});
	}
	for (const report of reports) {
		for (const setting of report.repositories) {
			const repository = repositories.get(setting.key) ?? {
				key: setting.key,
				name: setting.name,
				sessionCount: 0,
				reports: [],
			};
			repository.name = setting.name;
			repository.reports.push({
				installationId: report.installation_id,
				state: setting.state,
				reportedAt: new Date(report.reported_at).toISOString(),
			});
			repositories.set(setting.key, repository);
		}
	}
	return {
		repositories: [...repositories.values()].sort(
			(a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name),
		),
	};
}
