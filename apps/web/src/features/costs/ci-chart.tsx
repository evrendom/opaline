import type {
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import {
	type CSSProperties,
	type RefObject,
	useId,
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

const AXIS_LEFT = 44;
const AXIS_RIGHT = 36;
const AXIS_BOTTOM = 26;
const PLOT_TOP = 12;
const SEGMENT_GAP = 2;
const MAX_BAR = 18;

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

function niceTop(max: number) {
	const raw = Math.max(1, max) / 3;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step =
		[1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(
			(factor) => raw <= factor * power,
		) ?? 10;
	return Math.max(3, Math.ceil(step * power) * 3);
}

export function CiChart({
	days,
	interval,
}: {
	days: readonly CiDay[];
	interval: ChartInterval;
}) {
	const gradient = useId().replace(/[^\w-]/g, "");
	const ref = useRef<HTMLDivElement>(null);
	const { width, height } = useBox(ref);
	const store = useHoverDateStore();
	const marked = useMarkedDate();
	const layout = useMemo(() => {
		if (width <= 0 || height <= 0 || days.length === 0) return null;
		const plotWidth = width - AXIS_LEFT - AXIS_RIGHT;
		const base = height - AXIS_BOTTOM;
		const plotHeight = base - PLOT_TOP;
		const column = plotWidth / days.length;
		const bar = Math.max(2, Math.min(MAX_BAR, column * 0.56));
		const runsTop = niceTop(Math.max(...days.map((day) => day.runs)));
		const mergedTop = niceTop(Math.max(...days.map((day) => day.merged)));
		const yRuns = (value: number) => base - (value / runsTop) * plotHeight;
		const yMerged = (value: number) => base - (value / mergedTop) * plotHeight;
		const points = days.map(
			(day, index) => [(index + 0.5) * column, yMerged(day.merged)] as const,
		);
		const line = points
			.map(
				([x, y], index) =>
					`${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`,
			)
			.join(" ");
		const first = points[0];
		const last = points.at(-1);
		const area =
			first && last
				? `${line} L${last[0].toFixed(1)} ${base} L${first[0].toFixed(1)} ${base} Z`
				: "";
		return {
			plotWidth,
			base,
			column,
			bar,
			runsTop,
			mergedTop,
			yRuns,
			yMerged,
			points,
			line,
			area,
		};
	}, [days, height, width]);
	const hovered = marked ? days.find((day) => day.date === marked) : undefined;
	const hoveredIndex = hovered ? days.indexOf(hovered) : -1;
	return (
		<div
			ref={ref}
			className="cost-ci-chart"
			style={{ "--ci-merged": PULL_REQUEST_COLOR } as CSSProperties}
			onPointerLeave={() => store?.set(null)}
		>
			{layout ? (
				<svg width={width} height={height} aria-hidden="true">
					<defs>
						<linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
							<stop
								offset="0%"
								stopColor={PULL_REQUEST_COLOR}
								stopOpacity={0.16}
							/>
							<stop
								offset="100%"
								stopColor={PULL_REQUEST_COLOR}
								stopOpacity={0}
							/>
						</linearGradient>
					</defs>
					<g transform={`translate(${AXIS_LEFT} 0)`}>
						{range(4).map((step) => {
							const y = layout.base - (step / 3) * (layout.base - PLOT_TOP);
							return (
								<g key={step}>
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
										{Math.round((layout.runsTop * step) / 3).toLocaleString(
											"en-US",
										)}
									</text>
									<text
										className="cost-ci-tick"
										data-merged=""
										x={layout.plotWidth + 14}
										y={y + 4}
									>
										{Math.round((layout.mergedTop * step) / 3)}
									</text>
								</g>
							);
						})}
						{days.map((day, index) => {
							const x = (index + 0.5) * layout.column - layout.bar / 2;
							const failedTop = layout.yRuns(day.failed);
							const runsTop = layout.yRuns(day.runs);
							const passed = day.runs - day.failed;
							const dim = hovered !== undefined && hovered !== day;
							return (
								<g
									key={day.date}
									className="cost-ci-day"
									data-dim={dim || undefined}
								>
									{passed > 0 ? (
										<rect
											x={x}
											y={runsTop}
											width={layout.bar}
											height={Math.max(
												1,
												failedTop -
													runsTop -
													(day.failed > 0 ? SEGMENT_GAP : 0),
											)}
											rx={Math.min(3, layout.bar / 3)}
										/>
									) : null}
									{day.failed > 0 ? (
										<rect
											x={x}
											y={failedTop}
											width={layout.bar}
											height={Math.max(1.5, layout.base - failedTop)}
											rx={Math.min(3, layout.bar / 3)}
											data-failed=""
										/>
									) : null}
								</g>
							);
						})}
						<path
							d={layout.area}
							fill={`url(#${gradient})`}
							className="cost-ci-area"
						/>
						<path d={layout.line} className="cost-ci-line" />
						{hoveredIndex >= 0 ? (
							<>
								<line
									className="cost-ci-marker"
									x1={(hoveredIndex + 0.5) * layout.column}
									x2={(hoveredIndex + 0.5) * layout.column}
									y1={PLOT_TOP}
									y2={layout.base}
								/>
								<circle
									className="cost-ci-dot"
									cx={layout.points[hoveredIndex]?.[0]}
									cy={layout.points[hoveredIndex]?.[1]}
									r={4}
								/>
							</>
						) : null}
						{days.map((day, index) => (
							<rect
								key={day.date}
								className="cost-ci-hit"
								x={index * layout.column}
								y={0}
								width={layout.column}
								height={layout.base}
								onPointerEnter={() => store?.set(day.date)}
							/>
						))}
						<text className="cost-ci-tick" x={0} y={height - 6}>
							{days[0] ? formatChartDate(days[0].date, interval) : ""}
						</text>
						<text
							className="cost-ci-tick"
							x={layout.plotWidth}
							y={height - 6}
							textAnchor="end"
						>
							{formatChartDate(days.at(-1)?.date ?? "", interval)}
						</text>
					</g>
				</svg>
			) : null}
			{layout && hovered ? (
				<div
					className="cost-chart-tooltip cost-ci-tooltip"
					style={{
						left: Math.min(
							AXIS_LEFT + (hoveredIndex + 1) * layout.column + 12,
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
		</div>
	);
}

function range(count: number) {
	return Array.from({ length: count }, (_, index) => index);
}
