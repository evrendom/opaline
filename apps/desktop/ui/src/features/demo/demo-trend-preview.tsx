import type { DashboardMetric, DashboardMetricData } from "@rudel/api-routes";
import { useSyncExternalStore } from "react";
import { getNiceTickValues } from "recharts";
import {
	type ChartInterval,
	formatChartDate,
} from "@/features/costs/chart-interval";
import { formatChartValueTick } from "@/features/costs/cost-format";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

// The chart's Recharts layout (cost-chart.tsx): 12px top and right margins,
// a 56px value axis and a 40px date axis. Labels sit their tick margin plus
// Recharts' 6px tick size (kept even without tick lines) from the plot.
const PLOT_TOP = 12;
const PLOT_RIGHT = 12;
const PLOT_BOTTOM = 40;
const PLOT_LEFT = 56;
const VALUE_TICK_MARGIN = 10;
const DATE_TICK_MARGIN = 14;
const TICK_SIZE = 6;
const LABEL_FONT_SIZE = 11;
const DATE_MIN_TICK_GAP = 65;
// Widest chart the date labels are worked out for; wider charts keep its labels.
const MAX_CHART_WIDTH = 2560;
// Inter's advance widths in em, for the characters chart dates use.
const INTER_ADVANCE: Record<string, number> = {
	" ": 0.281,
	"0": 0.631,
	"1": 0.407,
	"2": 0.61,
	"3": 0.618,
	"4": 0.646,
	"5": 0.593,
	"6": 0.62,
	"7": 0.566,
	"8": 0.619,
	"9": 0.62,
	A: 0.69,
	D: 0.722,
	F: 0.59,
	J: 0.571,
	M: 0.903,
	N: 0.754,
	O: 0.765,
	Q: 0.765,
	S: 0.642,
	a: 0.562,
	b: 0.612,
	c: 0.571,
	e: 0.583,
	g: 0.613,
	l: 0.242,
	n: 0.591,
	o: 0.6,
	p: 0.612,
	r: 0.377,
	t: 0.327,
	u: 0.591,
	v: 0.562,
	y: 0.562,
};

const plotX = (fraction: number) =>
	`calc(${PLOT_LEFT}px + ${fraction} * (100% - ${PLOT_LEFT + PLOT_RIGHT}px))`;
const plotY = (fraction: number) =>
	`calc(${PLOT_TOP}px + ${fraction} * (100% - ${PLOT_TOP + PLOT_BOTTOM}px))`;
const labelStyle = {
	position: "absolute",
	color: "var(--ink-3)",
	fontSize: LABEL_FONT_SIZE,
	lineHeight: 1,
	whiteSpace: "nowrap",
} as const;

const labelWidth = (label: string) =>
	[...label].reduce(
		(width, character) => width + (INTER_ADVANCE[character] ?? 0.6),
		0,
	) * LABEL_FONT_SIZE;

// Recharts' `preserveEnd` interval: from the last date back, it keeps each
// label that fits in the chart and clears the last kept one by minTickGap.
// The last label is pulled inside the chart's right edge.
function shownDateLabels(chartWidth: number, widths: number[]) {
	const last = widths.length - 1;
	const plotWidth = chartWidth - PLOT_LEFT - PLOT_RIGHT;
	const shown: number[] = [];
	let end = chartWidth;
	for (let index = last; index >= 0; index--) {
		const half = widths[index] / 2;
		let center = PLOT_LEFT + (last > 0 ? index / last : 0.5) * plotWidth;
		if (index === last) center = Math.min(center, chartWidth - half);
		if (center - half >= 0 && center + half <= end) {
			shown.push(index);
			end = center - half - DATE_MIN_TICK_GAP;
		}
	}
	return shown;
}

// Recharts measures the labels in the browser; static HTML can't, so it works
// out the chart widths each label shows at and container queries show it.
function dateLabelRules(labels: string[]) {
	const widths = labels.map(labelWidth);
	const ranges = labels.map(() => [] as Array<[number, number]>);
	for (let width = 0; width <= MAX_CHART_WIDTH; width++) {
		for (const label of shownDateLabels(width, widths)) {
			const range = ranges[label].at(-1);
			if (range?.[1] === width) range[1] = width + 1;
			else ranges[label].push([width, width + 1]);
		}
	}
	return [
		"[data-demo-date-label] { display: none; }",
		...ranges.map((labelRanges, label) => {
			const query = labelRanges
				.map(([from, to]) =>
					to > MAX_CHART_WIDTH
						? `(width >= ${from}px)`
						: `(${from}px <= width < ${to}px)`,
				)
				.join(" or ");
			return query
				? `@container ${query} { [data-demo-date-label="${label}"] { display: block; } }`
				: "";
		}),
	]
		.filter(Boolean)
		.join("\n");
}

// Recharts fills its store in effects, so its SVG is absent from server HTML.
// Show the same seeded totals, with the chart's own axis labels, until the
// interactive chart has mounted.
export function DemoTrendPreview({
	trend,
	color,
	metric,
	interval,
}: {
	trend: DashboardMetricData["trend"];
	color: string;
	metric: DashboardMetric;
	interval: ChartInterval;
}) {
	const hydrated = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);
	if (hydrated || trend.length === 0) return null;
	// The value axis: Recharts' own ticks for a [0, auto] domain.
	const ticks: number[] = getNiceTickValues(
		[0, Math.max(0, ...trend.map((point) => point.total))],
		4,
		metric === "cost",
	);
	const top = ticks.at(-1) || 1;
	const last = trend.length - 1;
	const x = (index: number) => (last > 0 ? index / last : 0.5);
	const y = (value: number) => 1 - value / top;
	const dates = trend.map((point) => formatChartDate(point.date, interval));
	const points = trend
		.map((point, index) => `${x(index) * 1000},${y(point.total) * 1000}`)
		.join(" ");
	return (
		<div
			aria-hidden="true"
			data-demo-trend-preview
			style={{
				position: "absolute",
				inset: 0,
				pointerEvents: "none",
				containerType: "inline-size",
			}}
		>
			<style>{dateLabelRules(dates)}</style>
			<svg
				aria-hidden="true"
				viewBox="0 0 1000 1000"
				preserveAspectRatio="none"
				overflow="visible"
				style={{
					position: "absolute",
					left: PLOT_LEFT,
					top: PLOT_TOP,
					width: `calc(100% - ${PLOT_LEFT + PLOT_RIGHT}px)`,
					height: `calc(100% - ${PLOT_TOP + PLOT_BOTTOM}px)`,
				}}
			>
				{ticks.map((tick) => (
					<line
						key={tick}
						x1={0}
						x2={1000}
						y1={y(tick) * 1000}
						y2={y(tick) * 1000}
						stroke="var(--line)"
						strokeDasharray="3 4"
						vectorEffect="non-scaling-stroke"
					/>
				))}
				<polygon
					points={`0,1000 ${points} 1000,1000`}
					fill={color}
					fillOpacity={0.04}
				/>
				<polyline
					points={points}
					fill="none"
					stroke={color}
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			{ticks.map((tick) => (
				<span
					key={tick}
					style={{
						...labelStyle,
						left: 0,
						width: PLOT_LEFT - VALUE_TICK_MARGIN - TICK_SIZE,
						textAlign: "right",
						top: plotY(y(tick)),
						transform: "translateY(-50%)",
					}}
				>
					{formatChartValueTick(tick, metric)}
				</span>
			))}
			{trend.map((point, index) => (
				<span
					key={point.date}
					data-demo-date-label={index}
					style={{
						...labelStyle,
						// Recharts' baseline sits 0.71em below the tick; centre on it.
						top: `calc(100% - ${PLOT_BOTTOM - TICK_SIZE - DATE_TICK_MARGIN}px + 0.355em)`,
						// Recharts keeps the last label inside the chart's edge.
						...(index === last && last > 0
							? { right: 0, transform: "translateY(-50%)" }
							: {
									left: plotX(x(index)),
									transform: "translate(-50%, -50%)",
								}),
					}}
				>
					{dates[index]}
				</span>
			))}
		</div>
	);
}
