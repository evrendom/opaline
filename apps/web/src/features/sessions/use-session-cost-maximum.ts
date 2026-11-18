import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";
import { SESSION_QUERY_STALE_TIME } from "./sessions-list-query";

export function useSessionCostMaximum(): number | undefined {
	return useAnalyticsQuery({
		...orpc.analytics.sessions.costMaximum.queryOptions(),
		enabled: import.meta.env.MODE !== "plugin",
		staleTime: SESSION_QUERY_STALE_TIME,
	}).data;
}
