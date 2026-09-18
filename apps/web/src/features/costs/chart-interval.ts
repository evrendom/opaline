import type { DashboardMetricData } from "@rudel/api-routes";

export type ChartInterval =
	| "daily"
	| "weekly"
	| "monthly"
	| "quarterly"
	| "yearly";

export const CHART_INTERVALS: readonly {
	value: ChartInterval;
	label: string;
}[] = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "quarterly", label: "Quarterly" },
	{ value: "yearly", label: "Yearly" },
];

type DailyPoint = DashboardMetricData["trend"][number];
interface ChartPoint extends DailyPoint {
	startDate: string;
	endDate: string;
}

export function groupChartTrend(
	trend: readonly DailyPoint[],
	interval: ChartInterval,
): ChartPoint[] {
	const buckets = new Map<string, ChartPoint>();
	for (const point of trend) {
		const date = bucketDate(point.date, interval);
		let bucket = buckets.get(date);
		if (!bucket) {
			bucket = {
				date,
				startDate: point.date,
				endDate: point.date,
				total: 0,
				values: {},
			};
			buckets.set(date, bucket);
		}
		bucket.endDate = point.date;
		bucket.total += point.total;
		for (const [id, value] of Object.entries(point.values)) {
			bucket.values[id] = (bucket.values[id] ?? 0) + value;
		}
	}
	return [...buckets.values()];
}

export function getChartSeriesValue(
	point: ChartPoint,
	seriesId: string,
	today: string,
) {
	return point.startDate > today ? null : (point.values[seriesId] ?? 0);
}

function bucketDate(value: string, interval: ChartInterval): string {
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

export function formatChartDate(
	value: string,
	interval: ChartInterval,
): string {
	const date = new Date(`${value}T00:00:00Z`);
	if (interval === "yearly") return String(date.getUTCFullYear());
	if (interval === "quarterly")
		return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
	return date.toLocaleDateString("en-US", {
		month: "short",
		...(interval === "monthly" ? { year: "numeric" } : { day: "numeric" }),
		timeZone: "UTC",
	});
}

export function formatChartPeriod(point: ChartPoint): string {
	const formatter = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
	return formatter.formatRange(
		new Date(`${point.startDate}T00:00:00Z`),
		new Date(`${point.endDate}T00:00:00Z`),
	);
}
