import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";

export function useRepoDashboardRepositories(repoKey: string) {
	const list = useAnalyticsQuery(
		orpc.analytics.repositories.list.queryOptions({}),
	);
	return {
		data: list.data
			? (list.data.find((repo) => repo.identity.repoKey === repoKey)
					?.dashboardIds ?? [])
			: undefined,
		isError: list.isError,
	};
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
