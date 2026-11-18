import type { Format } from "@number-flow/react";
import type { DashboardMetricData } from "@rudel/api-routes";
import { type Figure, figureText } from "@/lib/figure";
import { type ChartInterval, groupChartTrend } from "./chart-interval";

const SWEARS = "Negative user";
const APOLOGIES = "Model apologies";

export type LanguageRates = {
	swears: number[];
	apologies: number[];
	dates: string[];
	total: { swears: number; apologies: number };
};

const rate = (count: number, runs: number) => (runs > 0 ? count / runs : 0);

const WHOLE: Format = { useGrouping: false };

export function perRunFigure(rate: number): Figure {
	const [count, runs] = !(rate > 0)
		? [0, 1]
		: rate >= 1
			? [Math.round(rate), 1]
			: [1, Math.round(1 / rate)];
	return [{ value: count, format: WHOLE }, "/", { value: runs, format: WHOLE }];
}

export function formatPerRun(rate: number, short = false) {
	if (short) return figureText(perRunFigure(rate));
	if (!(rate > 0)) return "none";
	if (rate >= 1) return `${Math.round(rate * 10) / 10} per run`;
	return `1 per ${Math.round(1 / rate)} runs`;
}

export function perRunTick(rate: number) {
	return formatPerRun(rate, true);
}

function seriesOf(data: DashboardMetricData, label: string) {
	return data.series?.find((series) => series.label === label)?.id;
}

export function languageRates(
	signals: DashboardMetricData | null | undefined,
	runs: DashboardMetricData | null | undefined,
	interval: ChartInterval,
): LanguageRates | undefined {
	if (!signals || !runs) return undefined;
	const swearsId = seriesOf(signals, SWEARS);
	const apologiesId = seriesOf(signals, APOLOGIES);
	const language = groupChartTrend(signals.trend, interval);
	const runsByDate = new Map(
		groupChartTrend(runs.trend, interval).map((point) => [
			point.date,
			point.total,
		]),
	);
	const count = (values: Record<string, number>, id: string | undefined) =>
		id ? (values[id] ?? 0) : 0;
	const totals = { swears: 0, apologies: 0, runs: 0 };
	const swears: number[] = [];
	const apologies: number[] = [];
	for (const point of language) {
		const runCount = runsByDate.get(point.date) ?? 0;
		const swearCount = count(point.values, swearsId);
		const apologyCount = count(point.values, apologiesId);
		totals.swears += swearCount;
		totals.apologies += apologyCount;
		totals.runs += runCount;
		swears.push(rate(swearCount, runCount));
		apologies.push(rate(apologyCount, runCount));
	}
	return {
		swears,
		apologies,
		dates: language.map((point) => point.date),
		total: {
			swears: rate(totals.swears, totals.runs),
			apologies: rate(totals.apologies, totals.runs),
		},
	};
}
