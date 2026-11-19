import type { SessionAnalyticsSummaryComparison } from "@rudel/api-routes";
import type {
	DashboardDeltaTone,
	DashboardHeadlineMetric,
} from "@/features/dashboard/data/dashboard-static-data";

function formatSignedPercentChange(value: number) {
	if (!Number.isFinite(value) || value === 0) {
		return "0%";
	}

	const roundedValue =
		Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
	return `${value > 0 ? "+" : ""}${roundedValue}%`;
}

function getDeltaTone(
	value: number,
	options?: {
		inverse?: boolean;
	},
): DashboardDeltaTone {
	if (!Number.isFinite(value) || value === 0) {
		return "neutral";
	}

	const isPositive = options?.inverse ? value < 0 : value > 0;
	return isPositive ? "positive" : "negative";
}

export function buildDashboardSessionTabMetrics(
	summaryComparison: SessionAnalyticsSummaryComparison | undefined,
): DashboardHeadlineMetric[] {
	const current = summaryComparison?.current;
	const changes = summaryComparison?.changes;
	const totalSessions = current?.total_sessions ?? 0;
	const avgDuration = current?.avg_session_duration_min ?? 0;
	const totalSessionChange = changes?.total_sessions ?? 0;
	const avgDurationChange = changes?.avg_session_duration_min ?? 0;

	return [
		{
			id: "sessions",
			label: "Sessions run",
			valueLabel: totalSessions.toString(),
			deltaLabel: formatSignedPercentChange(totalSessionChange),
			deltaTone: getDeltaTone(totalSessionChange),
			description: "Total AI sessions in the selected range.",
		},
		{
			id: "avgDuration",
			label: "Avg duration",
			valueLabel: `${avgDuration.toFixed(1)}m`,
			deltaLabel: formatSignedPercentChange(avgDurationChange),
			deltaTone: getDeltaTone(avgDurationChange, { inverse: true }),
			description: "Average session duration.",
		},
	];
}
