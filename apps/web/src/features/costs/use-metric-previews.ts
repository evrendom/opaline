import type {
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import { useQueries } from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

/** Daily trend per stat card; the chart groups it by the picked interval. */
export type MetricPreviews = Partial<
	Record<DashboardMetric, DashboardMetricData["trend"]>
>;

/**
 * Daily trend for each stat card's sparkline. The dashboard response
 * only carries a real trend for the requested metric, so each card asks for
 * its own with the same request the chart would send for it. Keys match the
 * main dashboard query, so switching cards renders from cache.
 */
export function useMetricPreviews(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	metrics: readonly DashboardMetric[],
): MetricPreviews {
	const { state } = useOrganization();
	const demo = useDemoRuntime();
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
			const options = orpc.analytics.overview.costs.queryOptions({
				input: inputFor(metric),
			});
			return {
				...options,
				queryKey: ["org", state.activeOrg?.id, ...options.queryKey],
				enabled: !!state.activeOrg?.id && demo?.live !== false,
				// Keep the last trend while new filters load, so sparklines update
				// in place instead of flashing back to the placeholder.
				placeholderData: (
					previous: CostDashboard | undefined,
					previousQuery: { queryKey: readonly unknown[] } | undefined,
				) =>
					// Same workspace and same metric only: observers are kept by
					// position, so a slot can change metric between renders.
					previousQuery?.queryKey[1] === state.activeOrg?.id &&
					previous?.requestedMetric === metric
						? previous
						: undefined,
				staleTime: 60_000,
				refetchOnWindowFocus: false,
			};
		}),
	});
	return Object.fromEntries(
		others.map((metric, index) => [
			metric,
			results[index]?.data?.metrics[metric]?.trend,
		]),
	);
}
