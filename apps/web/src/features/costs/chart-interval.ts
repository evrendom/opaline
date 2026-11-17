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

export type ChartAggregation = "ratio" | "sum";

export function groupChartTrend(
	trend: readonly DailyPoint[],
	interval: ChartInterval,
	aggregation: ChartAggregation = "sum",
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
			if (aggregation === "ratio") {
				bucket.numerator = 0;
				bucket.denominator = 0;
				bucket.numeratorValues = {};
				bucket.denominatorValues = {};
			}
			buckets.set(date, bucket);
		}
		bucket.endDate = point.date;
		if (aggregation === "ratio") {
			bucket.numerator = (bucket.numerator ?? 0) + (point.numerator ?? 0);
			bucket.denominator = (bucket.denominator ?? 0) + (point.denominator ?? 0);
			for (const [id, value] of Object.entries(point.numeratorValues ?? {})) {
				if (bucket.numeratorValues) {
					bucket.numeratorValues[id] =
						(bucket.numeratorValues[id] ?? 0) + value;
				}
			}
			for (const [id, value] of Object.entries(point.denominatorValues ?? {})) {
				if (bucket.denominatorValues) {
					bucket.denominatorValues[id] =
						(bucket.denominatorValues[id] ?? 0) + value;
				}
			}
		} else {
			bucket.total += point.total;
		}
		for (const [id, value] of Object.entries(point.values)) {
			if (aggregation === "sum") {
				bucket.values[id] = (bucket.values[id] ?? 0) + value;
			}
		}
	}
	if (aggregation === "ratio") {
		for (const bucket of buckets.values()) {
			bucket.total = divideRatio(bucket.numerator, bucket.denominator);
			const seriesIds = new Set([
				...Object.keys(bucket.numeratorValues ?? {}),
				...Object.keys(bucket.denominatorValues ?? {}),
			]);
			for (const id of seriesIds) {
				bucket.values[id] = divideRatio(
					bucket.numeratorValues?.[id],
					bucket.denominatorValues?.[id],
				);
			}
		}
	}
	return [...buckets.values()];
}

function divideRatio(
	numerator: number | undefined,
	denominator: number | undefined,
) {
	return denominator && denominator > 0 ? (numerator ?? 0) / denominator : 0;
}

export function getChartSeriesValue(
	point: ChartPoint,
	seriesId: string,
	today: string,
	aggregation: ChartAggregation = "sum",
	availableFrom?: string | null,
	historyAvailable = true,
) {
	if (
		!historyAvailable ||
		point.startDate > today ||
		(availableFrom && point.endDate < availableFrom)
	)
		return null;
	if (
		aggregation === "ratio" &&
		(point.denominatorValues?.[seriesId] ?? 0) === 0
	) {
		return null;
	}
	return point.values[seriesId] ?? 0;
}

export function isCiHistoryAvailable(
	history: DashboardMetricData["githubHistory"],
	endDate: string,
) {
	return Boolean(history?.ciFrom && endDate >= history.ciFrom);
}

export function bucketDate(value: string, interval: ChartInterval): string {
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

export function chartPeriodDates(
	startDate: string,
	endDate: string,
	interval: ChartInterval,
): string[] {
	const periods: string[] = [];
	const day = new Date(`${startDate}T00:00:00Z`);
	const last = new Date(`${endDate}T00:00:00Z`);
	while (day <= last) {
		const period = bucketDate(day.toISOString().slice(0, 10), interval);
		if (periods.at(-1) !== period) periods.push(period);
		day.setUTCDate(day.getUTCDate() + 1);
	}
	return periods;
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
