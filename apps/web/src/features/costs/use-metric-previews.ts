import type {
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetric,
} from "@rudel/api-routes";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { costsQueryScope, dashboardPlaceholder } from "./use-cost-dashboard";

/**
 * Each stat card's own answer: its total, availability and daily trend (the
 * chart groups it by the picked interval). Undefined while it loads.
 */
export type MetricPreviews = Partial<Record<DashboardMetric, CostDashboard>>;

/**
 * The answer behind each stat card. The dashboard response only carries the
 * requested metric in full (pull request and CI metrics are absent from the
 * others), so each card asks with the same request the chart would send for
 * it. Keys and stand-ins match the main dashboard query, so switching cards
 * renders from cache and a new date range loads the cards and the chart
 * together.
 */
export function useMetricPreviews(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	metrics: readonly DashboardMetric[],
): MetricPreviews {
	const { state } = useOrganization();
	const queryClient = useQueryClient();
	const demo = useDemoRuntime();
	const scope = costsQueryScope(state.activeOrg?.id);
	// Every card, the charted one included: its request is the chart's own, so
	// it shares that cache entry rather than adding a request.
	const others = metrics.filter(
		(metric): metric is CostDashboardRequestedMetric & DashboardMetric =>
			metric !== "ciFailuresPerPullRequest",
	);
	const results = useQueries({
		queries: others.map((metric) => {
			// Exactly the request the chart sends for this metric, so a click on
			// the card renders straight from cache.
			const input = inputFor(metric);
			const options = orpc.analytics.overview.costs.queryOptions({ input });
			return {
				...options,
				queryKey: ["org", state.activeOrg?.id, ...options.queryKey],
				enabled: !!state.activeOrg?.id && demo?.live !== false,
				placeholderData: dashboardPlaceholder(queryClient, scope, input),
				staleTime: 60_000,
				refetchOnWindowFocus: false,
			};
		}),
	});
	return Object.fromEntries(
		others.map((metric, index) => [metric, results[index]?.data]),
	);
}
