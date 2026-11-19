import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";

export function useRepoPullRequests(repoKey: string) {
	return useAnalyticsQuery(
		orpc.analytics.repositories.pullRequests.queryOptions({
			input: { repoKey },
		}),
	);
}
