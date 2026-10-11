import type { SessionAnalytics } from "@rudel/api-routes";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { client } from "@/lib/orpc";

const SESSION_PAGE_SIZE = 1000;
const MAX_SESSION_PAGES = 20;
// The dashboard accepts up to 100 repository filters.
const MAX_REPOSITORIES = 100;

/**
 * The dashboard's repository id for a session: its git remote without the
 * protocol, user and `.git` suffix (`git@github.com:o/r.git` →
 * `github.com/o/r`), else its project path — the dashboard's own
 * `repositorySql`.
 */
export function dashboardRepositoryId(
	session: Pick<SessionAnalytics, "git_remote" | "project_path">,
) {
	if (!session.git_remote) return session.project_path;
	return session.git_remote
		.replace(/^(https?:\/\/|ssh:\/\/)?(git@)?/u, "")
		.replace(":", "/")
		.replace(/[.]git\/?$/u, "");
}

/**
 * The dashboard repository ids one repo spans. A repo groups sessions by
 * identity (worktrees of one checkout, say), while the dashboard filters by
 * remote or path, so collect the ids its sessions carry.
 */
export function useRepoDashboardRepositories(repoKey: string) {
	return useAnalyticsQuery({
		queryKey: ["repo-dashboard-repositories", repoKey],
		queryFn: async ({ signal }) => {
			const ids = new Set<string>();
			for (let page = 0; page < MAX_SESSION_PAGES; page++) {
				const rows = parseSessionOverviewRows(
					await client.analytics.sessions.list(
						{
							repoKey,
							startDate: "1970-01-01",
							endDate: "2100-01-01",
							limit: SESSION_PAGE_SIZE,
							offset: page * SESSION_PAGE_SIZE,
						},
						{ signal },
					),
				);
				for (const row of rows) ids.add(dashboardRepositoryId(row));
				if (rows.length < SESSION_PAGE_SIZE || ids.size >= MAX_REPOSITORIES)
					break;
			}
			return [...ids].filter(Boolean).sort().slice(0, MAX_REPOSITORIES);
		},
		staleTime: 5 * 60_000,
	});
}

/**
 * The GitHub repository ids (as pull request and CI metrics filter by) among
 * the workspace's connected repositories whose `github.com/owner/name`
 * matches one of the repo's dashboard ids.
 */
export function githubRepositoryIds(
	dashboardIds: readonly string[],
	connected: readonly { owner: string; name: string; repositoryId: string }[],
) {
	const wanted = new Set(dashboardIds.map((id) => id.toLowerCase()));
	return connected
		.filter((repo) =>
			wanted.has(`github.com/${repo.owner}/${repo.name}`.toLowerCase()),
		)
		.map((repo) => repo.repositoryId);
}
