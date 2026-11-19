import type {
	CostDashboardInput,
	DashboardMetricData,
} from "@rudel/api-routes";

type AgentRunDurationInterval = NonNullable<
	CostDashboardInput["durationInterval"]
>;
type AgentRunDurationStats = NonNullable<DashboardMetricData["durationStats"]>;

export function buildDurationPeriods(
	startDate: string,
	endDate: string,
	interval: AgentRunDurationInterval,
): AgentRunDurationStats["trend"] {
	const periods = new Map<string, AgentRunDurationStats["trend"][number]>();
	for (
		let stamp = Date.parse(startDate);
		stamp <= Date.parse(endDate);
		stamp += 86_400_000
	) {
		const currentDate = new Date(stamp).toISOString().slice(0, 10);
		const date = durationPeriodDate(currentDate, interval);
		const existing = periods.get(date);
		if (existing) {
			existing.endDate = currentDate;
			continue;
		}
		periods.set(date, {
			date,
			startDate: currentDate,
			endDate: currentDate,
			sampleCount: 0,
			unknownCount: 0,
			medianSeconds: null,
			p95Seconds: null,
		});
	}
	return [...periods.values()];
}

function durationPeriodDate(
	value: string,
	interval: AgentRunDurationInterval,
): string {
	const date = new Date(`${value}T00:00:00Z`);
	if (interval === "weekly") {
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	} else if (interval !== "daily") {
		date.setUTCDate(1);
		if (interval === "quarterly")
			date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
		if (interval === "yearly") date.setUTCMonth(0);
	}
	return date.toISOString().slice(0, 10);
}
