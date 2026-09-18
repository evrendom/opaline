import type {
	CostDashboard,
	CostDimension,
	DashboardMetric,
} from "@rudel/api-routes";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";

export const METRIC_LABELS = {
	cost: "API Cost",
	sessions: "Sessions",
	commits: "Commits",
	signals: "Language signals",
	agentRuns: "Agent runs",
};
export const DASHBOARD_METRICS: DashboardMetric[] = [
	"cost",
	"sessions",
	"agentRuns",
];
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
	return metric === "cost"
		? formatCost(value)
		: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
				value,
			);
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
