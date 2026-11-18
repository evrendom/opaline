import type {
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import {
	type CSSProperties,
	type RefObject,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { orpc } from "@/lib/orpc";
import { PULL_REQUEST_COLOR } from "./chart-colors";
import {
	type ChartInterval,
	formatChartDate,
	groupChartTrend,
} from "./chart-interval";
import { useHoverDateStore, useMarkedDate } from "./cost-hover-date";

const FAILED_CONCLUSIONS = ["failure", "timedOut"] as const;

export type CiDay = {
	date: string;
	runs: number;
	failed: number;
	merged: number;
};

export type CiTotals = { runs: number; failed: number };

function ciRunsInput(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	failedOnly: boolean,
): CostDashboardInput {
	const input = { ...inputFor("ciRuns"), sessionMetrics: false };
	if (!failedOnly) return input;
	const picked = input.ciConclusions ?? [];
	return {
		...input,
		ciConclusions:
			picked.length === 0
				? [...FAILED_CONCLUSIONS]
				: picked.filter((id) =>
						(FAILED_CONCLUSIONS as readonly string[]).includes(id),
					),
	};
}

function useCiRuns(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	failedOnly: boolean,
	enabled: boolean,
) {
	const input = ciRunsInput(inputFor, failedOnly);
	const empty = failedOnly && input.ciConclusions?.length === 0;
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		enabled: enabled && !empty,
		staleTime: 60_000,
	});
	if (empty) return null;
	return query.data === undefined
		? undefined
		: (query.data.metrics.ciRuns ?? null);
}

export function useCiDays({
	inputFor,
	merged,
	interval,
	enabled,
}: {
	inputFor:
		| ((metric: CostDashboardRequestedMetric) => CostDashboardInput)
		| undefined;
	merged: DashboardMetricData | null | undefined;
	interval: ChartInterval;
	enabled: boolean;
}): CiDay[] | undefined {
	const read = inputFor ?? ((() => ({})) as never);
	const all = useCiRuns(read, false, enabled && inputFor !== undefined);
	const failed = useCiRuns(read, true, enabled && inputFor !== undefined);
	return useMemo(() => {
		if (!enabled || !merged || all === undefined || failed === undefined)
			return undefined;
		const runs = new Map(
			groupChartTrend(all?.trend ?? [], interval).map((point) => [
				point.date,
				point.total,
			]),
		);
		const failures = new Map(
			groupChartTrend(failed?.trend ?? [], interval).map((point) => [
				point.date,
				point.total,
			]),
		);
		return groupChartTrend(merged.trend, interval).map((point) => ({
			date: point.date,
			runs: runs.get(point.date) ?? 0,
			failed: Math.min(
				failures.get(point.date) ?? 0,
				runs.get(point.date) ?? 0,
			),
			merged: point.total,
		}));
	}, [all, enabled, failed, interval, merged]);
}

export function ciTotals(days: readonly CiDay[]): CiTotals {
	return days.reduce(
		(sum, day) => ({
			runs: sum.runs + day.runs,
			failed: sum.failed + day.failed,
		}),
		{ runs: 0, failed: 0 },
	);
}

const RING_SEGMENTS = 5;
const RING_GAP = (26 * Math.PI) / 180;
const RING_RADIUS = 6.6;

function ringArc(from: number, to: number) {
	const at = (angle: number) =>
		`${(9 + RING_RADIUS * Math.sin(angle)).toFixed(2)} ${(9 - RING_RADIUS * Math.cos(angle)).toFixed(2)}`;
	return `M${at(from)} A${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${at(to)}`;
}

export function failedSegments({ runs, failed }: CiTotals): number {
	if (failed <= 0 || runs <= 0) return 0;
	const exact = (failed / runs) * RING_SEGMENTS;
	const rounded = exact % 1 === 0.5 ? Math.floor(exact) : Math.round(exact);
	return Math.min(RING_SEGMENTS, Math.max(1, rounded));
}

export function CiRing({ totals }: { totals: CiTotals }) {
	const red = failedSegments(totals);
	const step = (2 * Math.PI) / RING_SEGMENTS;
	return (
		<svg
			className="cost-ci-ring"
			viewBox="0 0 18 18"
			role="img"
			aria-label={`${totals.failed} of ${totals.runs} CI runs failed`}
		>
			{range(RING_SEGMENTS).map((index) => (
				<path
					key={index}
					d={ringArc(
						index * step + RING_GAP / 2,
						(index + 1) * step - RING_GAP / 2,
					)}
					data-failed={index < red || undefined}
				/>
			))}
		</svg>
	);
}

const COLUMNS = 3;
const BOX_GAP = 2;
const MIN_ROW = 6;
const AXIS_WIDTH = 44;
const AXIS_BOTTOM = 26;

function useBox(ref: RefObject<HTMLDivElement | null>) {
	const [size, setSize] = useState({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const read = () =>
			setSize({ width: element.clientWidth, height: element.clientHeight });
		read();
		const observer = new ResizeObserver(read);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

function niceStep(max: number) {
	const raw = max / 3;
	const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
	for (const factor of [1, 2, 2.5, 5, 10])
		if (raw <= factor * power) return Math.max(1, Math.round(factor * power));
	return Math.max(1, Math.round(10 * power));
}

export function CiBoxChart({
	days,
	interval,
}: {
	days: readonly CiDay[];
	interval: ChartInterval;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const { width, height } = useBox(ref);
	const store = useHoverDateStore();
	const marked = useMarkedDate();
	const layout = useMemo(() => {
		if (width <= 0 || height <= 0 || days.length === 0) return null;
		const plotWidth = width - AXIS_WIDTH;
		const plotHeight = height - AXIS_BOTTOM;
		const column = plotWidth / days.length;
		const maxRuns = Math.max(1, ...days.map((day) => day.runs));
		const maxMerged = Math.max(1, ...days.map((day) => day.merged));
		const rowsFor = (count: number, per: number) =>
			Math.ceil(count / per / COLUMNS);
		let per = 1;
		while (
			(rowsFor(maxRuns, per) + rowsFor(maxMerged, per) + 1.2) * MIN_ROW >
			plotHeight
		)
			per += 1;
		const upRows = rowsFor(maxRuns, per);
		const downRows = rowsFor(maxMerged, per);
		const row = plotHeight / (upRows + downRows + 1.2);
		const box = Math.max(
			2,
			Math.min(row - BOX_GAP, (column - 4 - (COLUMNS - 1) * BOX_GAP) / COLUMNS),
		);
		const zero = (upRows + 0.4) * row;
		return { plotWidth, column, per, row, box, zero, maxRuns, maxMerged };
	}, [days, height, width]);
	const hovered = marked ? days.find((day) => day.date === marked) : undefined;
	const hoveredIndex = hovered ? days.indexOf(hovered) : -1;
	return (
		<div
			ref={ref}
			className="cost-ci-boxes"
			style={{ "--ci-merged": PULL_REQUEST_COLOR } as CSSProperties}
			onPointerLeave={() => store?.set(null)}
		>
			{layout ? (
				<svg width={width} height={height} aria-hidden="true">
					<g transform={`translate(${AXIS_WIDTH} 0)`}>
						{ticks(layout.maxRuns).map((value) => {
							const y =
								layout.zero - (value / layout.per / COLUMNS) * layout.row;
							return (
								<g key={`up-${value}`}>
									<line
										className="cost-ci-grid"
										x1={0}
										x2={layout.plotWidth}
										y1={y}
										y2={y}
									/>
									<text
										className="cost-ci-tick"
										x={-14}
										y={y + 4}
										textAnchor="end"
									>
										{value}
									</text>
								</g>
							);
						})}
						<line
							className="cost-ci-grid"
							x1={0}
							x2={layout.plotWidth}
							y1={layout.zero}
							y2={layout.zero}
						/>
						<text
							className="cost-ci-tick"
							x={-14}
							y={layout.zero + 4}
							textAnchor="end"
						>
							0
						</text>
						{ticks(layout.maxMerged).map((value) => {
							const y =
								layout.zero + 4 + (value / layout.per / COLUMNS) * layout.row;
							return (
								<g key={`down-${value}`}>
									<line
										className="cost-ci-grid"
										x1={0}
										x2={layout.plotWidth}
										y1={y}
										y2={y}
									/>
									<text
										className="cost-ci-tick"
										x={-14}
										y={y + 4}
										textAnchor="end"
									>
										{value}
									</text>
								</g>
							);
						})}
						{days.map((day, index) => {
							const left =
								index * layout.column +
								(layout.column -
									(COLUMNS * layout.box + (COLUMNS - 1) * BOX_GAP)) /
									2;
							const up = Math.ceil(day.runs / layout.per);
							const red =
								day.failed === 0
									? 0
									: Math.max(1, Math.round(day.failed / layout.per));
							const down = Math.ceil(day.merged / layout.per);
							const dim = hovered !== undefined && hovered !== day;
							const at = (n: number) =>
								left + (n % COLUMNS) * (layout.box + BOX_GAP);
							return (
								<g
									key={day.date}
									data-dim={dim || undefined}
									className="cost-ci-day"
								>
									{range(up).map((n) => (
										<rect
											key={`u${n}`}
											x={at(n)}
											y={
												layout.zero - (Math.floor(n / COLUMNS) + 1) * layout.row
											}
											width={layout.box}
											height={layout.box}
											rx={Math.min(2.5, layout.box / 3)}
											data-failed={n < red || undefined}
										/>
									))}
									{range(down).map((n) => (
										<rect
											key={`d${n}`}
											x={at(n)}
											y={layout.zero + 4 + Math.floor(n / COLUMNS) * layout.row}
											width={layout.box}
											height={layout.box}
											rx={Math.min(2.5, layout.box / 3)}
											data-merged=""
										/>
									))}
									<rect
										className="cost-ci-hit"
										x={index * layout.column}
										y={0}
										width={layout.column}
										height={height - AXIS_BOTTOM}
										onPointerEnter={() => store?.set(day.date)}
									/>
								</g>
							);
						})}
						{hoveredIndex >= 0 ? (
							<line
								className="cost-ci-marker"
								x1={(hoveredIndex + 0.5) * layout.column}
								x2={(hoveredIndex + 0.5) * layout.column}
								y1={0}
								y2={height - AXIS_BOTTOM}
							/>
						) : null}
						<text className="cost-ci-tick" x={0} y={height - 6}>
							{days[0] ? formatChartDate(days[0].date, interval) : ""}
						</text>
						<text
							className="cost-ci-tick"
							x={layout.plotWidth}
							y={height - 6}
							textAnchor="end"
						>
							{days.at(-1)
								? formatChartDate(days.at(-1)?.date ?? "", interval)
								: ""}
						</text>
					</g>
				</svg>
			) : null}
			{layout && hovered ? (
				<div
					className="cost-chart-tooltip cost-ci-tooltip"
					style={{
						left: Math.min(
							AXIS_WIDTH + (hoveredIndex + 1) * layout.column + 12,
							width - 196,
						),
					}}
				>
					<p>{formatChartDate(hovered.date, interval)}</p>
					<div>
						<span>
							<i data-ci="runs" />
							CI runs
						</span>
						<strong>{hovered.runs}</strong>
					</div>
					<div>
						<span>
							<i data-ci="failed" />
							Failed
						</span>
						<strong>{hovered.failed}</strong>
					</div>
					<div>
						<span>
							<i style={{ backgroundColor: PULL_REQUEST_COLOR }} />
							Merged PRs
						</span>
						<strong>{hovered.merged}</strong>
					</div>
				</div>
			) : null}
			{layout && layout.per > 1 ? (
				<span className="cost-ci-scale">1 box = {layout.per}</span>
			) : null}
		</div>
	);
}

function ticks(max: number) {
	const step = niceStep(max);
	const values: number[] = [];
	for (let value = step; value <= max; value += step) values.push(value);
	return values;
}

function range(count: number) {
	return Array.from({ length: count }, (_, index) => index);
}
