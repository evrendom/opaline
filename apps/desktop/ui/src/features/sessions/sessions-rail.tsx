import type { DashboardMetric } from "@rudel/api-routes";
import { CostDashboardView } from "@/features/costs/cost-dashboard-page";
import { useCostDashboard } from "@/features/costs/use-cost-dashboard";
import {
	useMetricPreviews,
	usePrefetchDashboardMetric,
} from "@/features/costs/use-metric-previews";
import { ShellHeaderPortalContext } from "@/features/shell/shell-header-portal";

const GITHUB_CARDS: readonly DashboardMetric[] = [
	"mergedPullRequests",
	"ciRuns",
];

export function SessionsRail() {
	const dashboard = useCostDashboard();
	const previews = useMetricPreviews(
		dashboard.inputFor,
		dashboard.metricsPending
			? [...dashboard.metrics, ...GITHUB_CARDS]
			: dashboard.metrics,
		dashboard.input,
	);
	const prefetchMetric = usePrefetchDashboardMetric(dashboard.inputFor);
	return (
		<ShellHeaderPortalContext.Provider value={null}>
			<div className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto">
				<CostDashboardView
					dashboard={dashboard}
					previews={previews}
					onMetricIntent={prefetchMetric}
					variant="rail-chat"
				/>
			</div>
		</ShellHeaderPortalContext.Provider>
	);
}
