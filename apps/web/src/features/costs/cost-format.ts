import type { Format } from "@number-flow/react";
import type {
	CostDashboard,
	CostDashboardRequestedMetric,
	CostDimension,
	DashboardMetric,
} from "@rudel/api-routes";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { type Figure, figureText } from "@/lib/figure";
import { unitFigure } from "@/lib/format";

export const METRIC_LABELS = {
	cost: "Cost",
	sessions: "Sessions",
	commits: "Commits",
	signals: "Frustrations",
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
const RATIO_FORMAT: Format = {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
};
const COUNT_FORMAT: Format = { maximumFractionDigits: 0 };
const COST_FORMAT: Format = {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
};
export function metricFigure(value: number, metric: DashboardMetric): Figure {
	if (metric === "ciFailuresPerPullRequest")
		return [{ value, format: RATIO_FORMAT }];
	return metric === "cost"
		? costFigure(value)
		: [{ value, format: COUNT_FORMAT }];
}
export function formatMetric(value: number, metric: DashboardMetric) {
	return figureText(metricFigure(value, metric));
}

const COMPACT_TICK = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
/** The chart's value axis labels, shared with the demo's static preview. */
export function formatChartValueTick(value: number, metric: DashboardMetric) {
	return `${metric === "cost" ? "$" : ""}${COMPACT_TICK.format(value)}`;
}

export function metricRatioFigure(
	value: number,
	metric: DashboardMetric,
	denominator: number | undefined,
): Figure {
	return metric === "ciFailuresPerPullRequest" && denominator === 0
		? ["—"]
		: metricFigure(value, metric);
}
export function formatMetricRatio(
	value: number,
	metric: DashboardMetric,
	denominator: number | undefined,
) {
	return figureText(metricRatioFigure(value, metric, denominator));
}
export function costFigure(value: number): Figure {
	return value > 0 && value < 0.01
		? [{ value: 0.01, format: COST_FORMAT, prefix: "<" }]
		: [{ value, format: COST_FORMAT }];
}
export function formatCost(value: number) {
	return figureText(costFigure(value));
}
export const TENTHS: Format = { maximumFractionDigits: 1 };
export function runDurationFigure(value: number | null | undefined): Figure {
	if (value === null || value === undefined) return ["—"];
	if (value < 60) {
		if (value > 0 && value < 0.1)
			return [{ value: 0.1, format: TENTHS, prefix: "<", suffix: "s" }];
		return [{ value, format: TENTHS, suffix: "s" }];
	}
	const seconds = Math.round(value);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainder = seconds % 60;
	const [major, minor] =
		hours > 0
			? [unitFigure(hours, "h"), minutes ? unitFigure(minutes, "m") : null]
			: [
					unitFigure(minutes, "m"),
					remainder ? unitFigure(remainder, "s") : null,
				];
	return minor ? [major, " ", minor] : [major];
}
export function formatRunDuration(value: number | null | undefined): string {
	return figureText(runDurationFigure(value));
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
