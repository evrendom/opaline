import type {
	CostDashboard,
	CostDashboardRequestedMetric,
	CostDimension,
	DashboardMetric,
} from "@rudel/api-routes";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";

export const METRIC_LABELS = {
	cost: "Cost",
	sessions: "Sessions",
	commits: "Commits",
	signals: "Language",
	agentRuns: "Agent runs",
	mergedPullRequests: "Merged PRs",
	ciFailuresPerPullRequest: "CI failures / PR",
	ciRuns: "CI runs",
};
// Presentation order of the metric tabs. Which of them render is decided by the
// server's `availableMetrics`; the CI-errors-per-PR companion has no tab of its
// own and is drawn inside the Merged PRs chart.
export const DASHBOARD_METRICS = [
	"cost",
	"sessions",
	"agentRuns",
	"signals",
	"mergedPullRequests",
	"ciRuns",
] as const satisfies readonly CostDashboardRequestedMetric[];
export type DashboardTabMetric = (typeof DASHBOARD_METRICS)[number];
// Before the server has answered, list only the metrics every scope serves so
// an optional metric never flashes in and back out. Their stat cards load
// straight away; optional ones join at the end once the server answers.
const PRE_AVAILABILITY_METRICS: readonly CostDashboardRequestedMetric[] = [
	"cost",
	"sessions",
	"agentRuns",
	"signals",
];
export function listDashboardTabs(
	availableMetrics: readonly CostDashboardRequestedMetric[] | undefined,
): DashboardTabMetric[] {
	const available = availableMetrics ?? PRE_AVAILABILITY_METRICS;
	return DASHBOARD_METRICS.filter((metric) => available.includes(metric));
}
export function getMetricData(
	data: CostDashboard | undefined,
	metric: DashboardMetric,
) {
	return data?.metrics[metric];
}
export function getMetricTotal(
	data: CostDashboard | undefined,
	metric: DashboardMetric,
) {
	return data === undefined ? undefined : (data.metrics[metric]?.total ?? null);
}
export function formatMetric(value: number, metric: DashboardMetric) {
	if (metric === "ciFailuresPerPullRequest") {
		return new Intl.NumberFormat("en-US", {
			maximumFractionDigits: 2,
			minimumFractionDigits: 0,
		}).format(value);
	}
	return metric === "cost"
		? formatCost(value)
		: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
				value,
			);
}

export function formatMetricRatio(
	value: number,
	metric: DashboardMetric,
	denominator: number | undefined,
) {
	return metric === "ciFailuresPerPullRequest" && denominator === 0
		? "—"
		: formatMetric(value, metric);
}
export function formatCost(value: number) {
	if (value > 0 && value < 0.01) return "<$0.01";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);
}
export function formatRunDuration(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	if (value < 60) {
		if (value > 0 && value < 0.1) return "<0.1s";
		return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}s`;
	}
	const seconds = Math.round(value);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainder = seconds % 60;
	return hours > 0
		? `${hours}h${minutes ? ` ${minutes}m` : ""}`
		: `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
}
export function costLabel(dimension: CostDimension, label: string) {
	if (dimension === "signalTypes") {
		const labels: Record<string, string> = {
			modelApologies: "Model apologies",
			userPositive: "Positive user",
			userNegative: "Negative user",
		};
		return labels[label] ?? label;
	}
	return dimension === "models" ? formatModelDisplayLabel(label) : label;
}
