import { type Icon, IconRefresh } from "@tabler/icons-react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	type XAxisTickContentProps,
	YAxis,
} from "recharts";
import { useOptionalDateRange } from "@/features/analytics/date-range/DateRangeProvider";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { PillTabs } from "@/features/repos/pill-tabs";
import { EdgeTick, edgeTicks, useAxisHover } from "../chart-edge-axis";
import { ChartEmptyNotice } from "../chart-empty-notice";
import {
	bucketDate,
	type ChartInterval,
	chartPeriodDates,
	formatChartDate,
	groupChartTrend,
} from "../chart-interval";
import { CostDotChart, type DotTone } from "../cost-dot-chart";
import { useHoverDateStore } from "../cost-hover-date";
import {
	leftPercent,
	type PlanProvider,
	type PlanUsageReport,
	type ProviderUsage,
	type UsageBucket,
	type UsageWindow,
} from "./use-plan-usage";
import "./plan-usage.css";
import { sampleUsageWindow } from "./usage-sample";

const PROVIDER_TABS = [
	{ id: "claude", label: "Claude", icon: ClaudeModelIcon as unknown as Icon },
	{ id: "codex", label: "Codex", icon: CodexModelIcon as unknown as Icon },
] as const;
const MARGIN = { top: 12, right: 12, bottom: 0, left: 0 };
const Y_AXIS_WIDTH = 56;
const BAR_SHARE = 0.6;
const MAX_BAR_PX = 18;
const RESET_ICON_PX = 14;
const RESET_ICON_GAP_PX = 6;
const RESET_ICON_SPACE_PX = 10;
const USAGE_COLOR = "oklch(0.74 0.17 150)";
const RAN_OUT_COLOR = "oklch(0.64 0.21 27)";
const RAN_OUT_AT = 97;
const FAINTEST_DOT = 0.14;
const SEGMENT_GAP_PX = 3;
const SEGMENT_RADIUS_PX = 2;
const TICK_STYLE = { fill: "var(--cost-muted)", fontSize: 11 };
const DAY_MS = 86_400_000;

const resetTickFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
});

export function formatPoints(points: number): string {
	if (points <= 0) return "0%";
	if (points < 0.1) return `${points.toFixed(2)}%`;
	if (points < 0.95) return `${points.toFixed(1)}%`;
	return `${Math.round(points)}%`;
}

export function showsChart(window: UsageWindow): boolean {
	return window.sessions.length > 0 || window.totalPoints > 0;
}

interface Period {
	readonly x: number;
	readonly date: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly last: UsageBucket | null;
	readonly solid: number | null;
	readonly cap: number | null;
	readonly used: number | null;
	readonly usedPoints: number;
	readonly full: number | null;
	readonly peak: number | null;
	readonly ranOut: boolean;
	readonly repositoryPoints: number;
}

export function periodsOf(
	window: UsageWindow,
	interval: ChartInterval,
): Period[] {
	const hitPeriods = new Set(
		(window.limitHitsAt ?? []).map((at) =>
			bucketDate(at.slice(0, 10), interval),
		),
	);
	const groups = new Map<string, UsageBucket[]>();
	for (const bucket of window.buckets) {
		const day = bucket.at.slice(0, 10);
		const key = bucketDate(day, interval);
		const group = groups.get(key) ?? [];
		group.push(bucket);
		groups.set(key, group);
	}
	return [...groups].map(([date, buckets], x) => {
		const last =
			[...buckets].reverse().find((bucket) => bucket.usedPercent !== null) ??
			null;
		const usedPoints = buckets.reduce(
			(sum, bucket) => sum + bucket.usedPoints,
			0,
		);
		const range = last?.usedRange ?? null;
		const low = range ? leftPercent(range[1]) : null;
		const high = range ? leftPercent(range[0]) : null;
		const estimate = last?.kind === "estimate";
		return {
			x,
			date,
			startDate: buckets[0]?.at.slice(0, 10) ?? date,
			endDate: buckets.at(-1)?.at.slice(0, 10) ?? date,
			last,
			solid: estimate
				? last?.usedPercent === null || !last
					? null
					: leftPercent(last.usedPercent)
				: low,
			cap:
				!estimate && low !== null && high !== null && high > low
					? high - low
					: null,
			used:
				last?.usedPercent === null || !last
					? null
					: Math.min(
							usedPoints,
							100 -
								(estimate ? leftPercent(last.usedPercent) : (low ?? 0)) -
								(estimate ? 0 : high !== null && low !== null ? high - low : 0),
						),
			usedPoints,
			full: last?.usedPercent === null || !last ? null : 100,
			peak: buckets.reduce<number | null>(
				(top, bucket) =>
					bucket.usedPercent === null
						? top
						: Math.max(top ?? 0, bucket.usedPercent),
				null,
			),
			ranOut:
				hitPeriods.has(date) ||
				buckets.some(
					(bucket) =>
						bucket.kind !== "estimate" &&
						(bucket.usedPercent ?? 0) >= RAN_OUT_AT,
				),
			repositoryPoints: buckets.reduce(
				(sum, bucket) => sum + (bucket.repositoryPoints ?? 0),
				0,
			),
		};
	});
}

function resetX(periods: readonly Period[], at: string): number | null {
	const time = Date.parse(at);
	for (const period of periods) {
		const start = Date.parse(`${period.startDate}T00:00:00Z`);
		const end = Date.parse(`${period.endDate}T00:00:00Z`) + DAY_MS;
		if (time >= start && time < end)
			return period.x - 0.5 + (time - start) / (end - start);
	}
	return null;
}

function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = () => setWidth(element.getBoundingClientRect().width);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
}

export function PlanUsageChart({
	report,
	provider,
	onProviderChange,
	interval,
	pending,
	failed,
	dots = false,
	repository = false,
}: {
	report: PlanUsageReport | null | undefined;
	provider: PlanProvider;
	onProviderChange: (provider: PlanProvider) => void;
	interval: ChartInterval;
	pending: boolean;
	failed: boolean;
	dots?: boolean;
	/** Shade by the repository's own points instead of the plan's. */
	repository?: boolean;
}) {
	const usage = report?.providers.find((entry) => entry.provider === provider);
	const window = usage?.window ?? null;
	const showChart = window !== null && showsChart(window);
	const range = useOptionalDateRange()?.state;
	const sample =
		!pending && !showChart && range
			? sampleUsageWindow(
					range.endDate,
					dots || repository ? range.startDate : undefined,
				)
			: null;
	const shown = sample ?? window;
	const morph = useRef<readonly BarSpan[] | null>(null);
	const [wasPending, setWasPending] = useState(pending);
	const [morphIn, setMorphIn] = useState(false);
	if (wasPending !== pending) {
		setWasPending(pending);
		setMorphIn(!pending);
	}
	return (
		<div className="cost-chart-card">
			<div className="cost-chart-key">
				<div className="cost-chart-key-copy">
					<h2 className="cost-chart-title">Usage over time</h2>
				</div>
				<PillTabs
					className="h-8 shrink-0 bg-transparent"
					label="Provider"
					pillClassName="bg-card shadow-(--custom-shadow) dark:bg-muted-foreground/10"
					onChange={onProviderChange}
					tabs={PROVIDER_TABS}
					value={provider}
				/>
			</div>
			{pending && (dots || repository) ? (
				<UsageDots window={null} interval={interval} repository={repository} />
			) : pending ? (
				<UsageLoadingCanvas
					interval={interval}
					onLeave={(spans) => {
						morph.current = spans;
					}}
					count={
						range
							? chartPeriodDates(range.startDate, range.endDate, interval)
									.length
							: 30
					}
				/>
			) : (
				<div className="plan-usage-frame" data-sample={sample ? "" : undefined}>
					{dots || repository ? (
						<UsageDots
							window={shown}
							interval={interval}
							repository={repository}
						/>
					) : shown ? (
						<UsageCanvas
							window={shown}
							interval={interval}
							morph={morphIn ? morph : undefined}
						/>
					) : (
						<div className="cost-chart-canvas" />
					)}
					{showChart ? null : (
						<ChartEmptyNotice title={emptyTitle(usage, failed)} />
					)}
				</div>
			)}
		</div>
	);
}

const WAVE_BARS = 12;
const WAVE_MS = 1600;
const BONE_HEIGHT = 8;
const Y_TICKS = [0, 25, 50, 75, 100];

function barGeometry(width: number, count: number) {
	const ratio =
		typeof globalThis.devicePixelRatio === "number"
			? Math.max(1, globalThis.devicePixelRatio)
			: 1;
	const plot = Math.max(0, width - Y_AXIS_WIDTH - MARGIN.left - MARGIN.right);
	const pitch = Math.max(1 / ratio, Math.floor((plot / count) * ratio) / ratio);
	const bar = Math.min(
		MAX_BAR_PX,
		Math.max(2 / ratio, Math.round(pitch * BAR_SHARE * ratio) / ratio),
	);
	return {
		pitch,
		spare: Math.max(0, plot - pitch * count),
		bar,
		snap: (value: number) => Math.round(value * ratio) / ratio,
	};
}

function Bone({ x, y, width }: { x: number; y: number; width: number }) {
	return (
		<rect
			className="plan-usage-bone"
			x={x}
			y={y - BONE_HEIGHT / 2}
			width={width}
			height={BONE_HEIGHT}
			rx={2}
		/>
	);
}

const LOADING_SOLID_SHARE = 0.68;
const MORPH_MS = 520;
const MORPH_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type BarSpan = { readonly bottom: number; readonly height: number };

function LoadingSplitBar({
	x,
	y,
	width,
	height,
	phase,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
	phase: number;
}) {
	const usable = Math.max(0, height - SEGMENT_GAP_PX);
	const solid = usable * LOADING_SOLID_SHARE;
	const corner = Math.min(SEGMENT_RADIUS_PX, width / 2);
	return (
		<g
			className="plan-usage-loading-bar"
			style={{ animationDelay: `${(-phase * WAVE_MS) / WAVE_BARS}ms` }}
		>
			<rect
				className="plan-usage-loading-used"
				x={x}
				y={y}
				width={width}
				height={Math.max(0, usable - solid)}
				rx={corner}
			/>
			<rect
				className="plan-usage-loading-solid"
				x={x}
				y={y + height - solid}
				width={width}
				height={solid}
				rx={corner}
			/>
		</g>
	);
}

function UsageLoadingCanvas({
	count,
	interval,
	onLeave,
}: {
	count: number;
	interval: ChartInterval;
	onLeave: (spans: readonly BarSpan[]) => void;
}) {
	const [canvasRef, width] = useWidth<HTMLOutputElement>();
	const leave = useRef(onLeave);
	leave.current = onLeave;
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		return () => {
			if (!canvas) return;
			leave.current(
				[...canvas.querySelectorAll(".plan-usage-loading-bar")].map((bar) => {
					const box = bar.getBoundingClientRect();
					return { bottom: box.bottom, height: box.height };
				}),
			);
		};
	}, [canvasRef]);
	const bars = Math.max(1, count);
	const { spare, bar } = barGeometry(width, bars);
	const data = Array.from({ length: bars }, (_, x) => ({ x, full: 100 }));
	return (
		<output
			ref={canvasRef}
			className="cost-chart-canvas plan-usage-loading"
			aria-label="Loading usage"
			style={{ "--usage-color": USAGE_COLOR } as CSSProperties}
		>
			{width > 0 ? (
				<ResponsiveContainer width="100%" height="100%" minWidth={0}>
					<ComposedChart
						data={data}
						margin={{
							...MARGIN,
							top:
								interval === "daily"
									? RESET_ICON_PX + RESET_ICON_GAP_PX + 4
									: MARGIN.top,
							right: MARGIN.right + spare,
						}}
					>
						<CartesianGrid
							vertical={false}
							stroke="var(--cost-border)"
							strokeDasharray="3 4"
						/>
						<XAxis
							type="number"
							dataKey="x"
							domain={[-0.5, bars - 0.5]}
							ticks={edgeTicks(bars, null)}
							interval={0}
							axisLine={false}
							tickLine={false}
							tickMargin={14}
							height={40}
							tick={(props: XAxisTickContentProps) => {
								const first = Number(props.payload?.value) === 0;
								const x = Number(props.x ?? 0);
								const y = Number(props.y ?? 0) + BONE_HEIGHT / 2 + 2;
								const boneWidth = 36;
								return (
									<Bone
										x={
											bars === 1
												? x - boneWidth / 2
												: first
													? x - bar / 2
													: x + bar / 2 - boneWidth
										}
										y={y}
										width={boneWidth}
									/>
								);
							}}
						/>
						<YAxis
							domain={[0, 100]}
							ticks={Y_TICKS}
							axisLine={false}
							tickLine={false}
							tickMargin={10}
							width={Y_AXIS_WIDTH}
							tick={(props: {
								x?: number | string;
								y?: number | string;
								payload?: { value?: number };
							}) => {
								const label = `${props.payload?.value ?? 0}%`;
								const boneWidth = label.length * 6.5;
								return (
									<Bone
										x={Number(props.x ?? 0) - boneWidth}
										y={Number(props.y ?? 0)}
										width={boneWidth}
									/>
								);
							}}
						/>
						<Bar
							dataKey="full"
							barSize={bar}
							isAnimationActive={false}
							shape={(props: BarShapeProps) => (
								<LoadingSplitBar
									x={Number(props.x ?? 0)}
									y={Number(props.y ?? 0)}
									width={Number(props.width ?? 0)}
									height={Math.max(0, Number(props.height ?? 0))}
									phase={bars - 1 - (props.payload?.x ?? 0)}
								/>
							)}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			) : null}
		</output>
	);
}

function emptyTitle(usage: ProviderUsage | undefined, failed: boolean) {
	if (failed) return "Usage couldn’t load";
	if (usage?.window) return "No use";
	return "No plan limits yet";
}

function UsageCanvas({
	window,
	interval,
	morph,
}: {
	window: UsageWindow;
	interval: ChartInterval;
	morph?: { current: readonly BarSpan[] | null };
}) {
	const [canvasRef, width] = useWidth<HTMLDivElement>();
	const [morphing] = useState(morph !== undefined);
	const started = useRef(false);
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!morphing || started.current || !canvas) return;
		const from = morph?.current;
		if (!from) {
			started.current = true;
			canvas.removeAttribute("data-morphing");
			return;
		}
		let frame = 0;
		let tries = 0;
		const start = () => {
			const bars = [...canvas.querySelectorAll(".recharts-bar-rectangle")];
			if (bars.length === 0 && tries++ < 30) {
				frame = requestAnimationFrame(start);
				return;
			}
			started.current = true;
			if (morph) morph.current = null;
			bars.forEach((bar, index) => {
				const span = from[index];
				const rects = [...bar.querySelectorAll("rect")];
				const box = bar.getBoundingClientRect();
				const ratio =
					span && box.height > 0
						? Math.min(4, Math.max(0.05, span.height / box.height))
						: 0.2;
				const bottom = Math.max(
					...rects.map(
						(rect) =>
							Number(rect.getAttribute("y")) +
							Number(rect.getAttribute("height")),
					),
				);
				for (const rect of rects) {
					rect.style.transformBox = "view-box";
					rect.style.transformOrigin = `0 ${bottom}px`;
					rect.animate(
						[
							{ transform: `scaleY(${ratio})`, opacity: 0.45 },
							{ transform: "scaleY(1)", opacity: 1 },
						],
						{ duration: MORPH_MS, easing: MORPH_EASE, fill: "backwards" },
					);
				}
				for (const icon of bar.querySelectorAll("svg"))
					icon.animate([{ opacity: 0 }, { opacity: 1 }], {
						duration: MORPH_MS,
						easing: MORPH_EASE,
						fill: "backwards",
					});
			});
			for (const ticks of canvas.querySelectorAll(
				".recharts-cartesian-axis-ticks",
			))
				ticks.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: MORPH_MS,
					easing: MORPH_EASE,
					fill: "backwards",
				});
			canvas.removeAttribute("data-morphing");
		};
		frame = requestAnimationFrame(start);
		return () => cancelAnimationFrame(frame);
	}, [canvasRef, morph, morphing, width]);
	const periods = periodsOf(window, interval);
	const count = Math.max(1, periods.length);
	const { pitch, spare, bar, snap } = barGeometry(width, count);
	const resetDays = new Map<number, string>();
	let lastReset = Number.NEGATIVE_INFINITY;
	if (interval === "daily")
		for (const at of window.resets) {
			const x = resetX(periods, at);
			if (x === null) continue;
			const day = Math.round(x);
			if ((day - lastReset) * pitch < RESET_ICON_PX + RESET_ICON_SPACE_PX)
				continue;
			lastReset = day;
			resetDays.set(day, `Limit reset ${resetTickFormat.format(new Date(at))}`);
		}
	const axisHover = useAxisHover();
	const hoverDates = useHoverDateStore();
	return (
		<div
			ref={canvasRef}
			className="cost-chart-canvas"
			data-morphing={morphing || undefined}
			skullet-ignore=""
		>
			{width > 0 ? (
				<ResponsiveContainer width="100%" height="100%" minWidth={0}>
					<ComposedChart
						data={periods}
						margin={{
							...MARGIN,
							top:
								resetDays.size > 0
									? RESET_ICON_PX + RESET_ICON_GAP_PX + 4
									: MARGIN.top,
							right: MARGIN.right + spare,
						}}
						accessibilityLayer
						onMouseMove={(state) => {
							axisHover.onMouseMove(state);
							const period = state.isTooltipActive
								? periods[Number(state.activeTooltipIndex)]
								: undefined;
							hoverDates?.set(period?.date ?? null);
						}}
						onMouseLeave={() => {
							axisHover.onMouseLeave();
							hoverDates?.set(null);
						}}
					>
						<CartesianGrid
							vertical={false}
							stroke="var(--cost-border)"
							strokeDasharray="3 4"
						/>
						<XAxis
							type="number"
							dataKey="x"
							domain={[-0.5, count - 0.5]}
							ticks={edgeTicks(periods.length, axisHover.hover)}
							interval={0}
							axisLine={false}
							tickLine={false}
							tickMargin={14}
							height={40}
							tick={(props: XAxisTickContentProps) => (
								<EdgeTick
									tick={props}
									count={periods.length}
									hover={axisHover.hover}
									inset={bar / 2}
									bars
									label={(index) => {
										const period = periods[index];
										return period ? formatChartDate(period.date, interval) : "";
									}}
								/>
							)}
						/>
						<YAxis
							domain={[0, 100]}
							ticks={[0, 25, 50, 75, 100]}
							tickFormatter={(value) => `${value}%`}
							axisLine={false}
							tickLine={false}
							tickMargin={10}
							width={Y_AXIS_WIDTH}
							tick={TICK_STYLE}
						/>
						<Tooltip
							isAnimationActive={false}
							cursor={{ fill: "var(--cost-hover)", opacity: 0.5 }}
							content={() => null}
						/>
						<Bar
							dataKey="full"
							barSize={bar}
							isAnimationActive={false}
							shape={(props: BarShapeProps) => (
								<SplitBar
									{...props}
									snap={snap}
									reset={resetDays.get(props.payload?.x ?? -1)}
								/>
							)}
						/>
					</ComposedChart>
				</ResponsiveContainer>
			) : null}
		</div>
	);
}

function UsageDots({
	window,
	interval,
	repository = false,
}: {
	window: UsageWindow | null;
	interval: ChartInterval;
	repository?: boolean;
}) {
	const range = useOptionalDateRange()?.state;
	const periods = window ? periodsOf(window, interval) : [];
	const byDate = new Map(periods.map((period) => [period.date, period]));
	const points = window
		? periods.map((period) => ({
				date: period.date,
				startDate: period.startDate,
				endDate: period.endDate,
				total: repository ? period.repositoryPoints : (period.peak ?? 0),
				values: {},
			}))
		: range
			? groupChartTrend(
					chartPeriodDates(range.startDate, range.endDate, "daily").map(
						(date) => ({ date, total: 0, values: {} }),
					),
					interval,
				)
			: [];
	const busiest = Math.max(
		0,
		...periods.map((period) => period.repositoryPoints),
	);
	const tone = (point: { date: string }): DotTone => {
		const period = byDate.get(point.date);
		if (repository) {
			const points = period?.repositoryPoints ?? 0;
			const share = busiest > 0 ? points / busiest : 0;
			return {
				strength: share > 0 ? FAINTEST_DOT + (1 - FAINTEST_DOT) * share : 0,
				text:
					points > 0
						? `${formatPoints(points)} of the limit used here`
						: "not used here",
			};
		}
		if (!period || period.peak === null)
			return { strength: 0, text: "no reading" };
		if (period.ranOut)
			return { strength: 1, color: RAN_OUT_COLOR, text: "limit ran out" };
		const share = Math.min(1, Math.max(0, period.peak / 100));
		return {
			strength: share > 0 ? FAINTEST_DOT + (1 - FAINTEST_DOT) * share : 0,
			text: `${formatPoints(period.peak)} of the limit used`,
		};
	};
	return (
		<div className="cost-chart-canvas" data-kind="dots" skullet-ignore="">
			<CostDotChart
				color={USAGE_COLOR}
				fit
				format={formatPoints}
				interval={interval}
				label="Usage"
				loading={window === null}
				points={points}
				tone={tone}
			/>
		</div>
	);
}

function solidColor(period: Period): string {
	return period.ranOut ? RAN_OUT_COLOR : USAGE_COLOR;
}

function usedColor(period: Period): string {
	return `color-mix(in srgb, ${solidColor(period)} 38%, var(--cost-surface))`;
}

interface BarShapeProps {
	readonly x?: number;
	readonly y?: number;
	readonly width?: number;
	readonly height?: number;
	readonly fill?: string;
	readonly payload?: Period;
}

function SplitBar({
	x = 0,
	y = 0,
	width = 0,
	height = 0,
	payload,
	snap,
	reset,
}: BarShapeProps & {
	snap: (value: number) => number;
	reset?: string;
}) {
	if (!payload || payload.solid === null || !(height > 0) || !(width > 0))
		return null;
	const parts = [
		{ key: "left", size: payload.solid, fill: solidColor(payload) },
		{
			key: "used",
			size: payload.used ?? 0,
			fill: usedColor(payload),
		},
	].filter((part) => part.size > 0.05);
	const scale = Math.max(0, height - (parts.length - 1) * SEGMENT_GAP_PX) / 100;
	const left = snap(x);
	const size = snap(width);
	let bottom = y + height;
	const segments = parts.map((part) => {
		const top = bottom - part.size * scale;
		const from = snap(top);
		const tall = Math.max(1, snap(bottom) - from);
		bottom = top - SEGMENT_GAP_PX;
		const corner = Math.min(SEGMENT_RADIUS_PX, size / 2, tall / 2);
		return part.fill ? (
			<rect
				key={part.key}
				x={left}
				y={from}
				width={size}
				height={tall}
				rx={corner}
				fill={part.fill}
			/>
		) : (
			<rect
				key={part.key}
				x={left + 0.5}
				y={from + 0.5}
				width={Math.max(0, size - 1)}
				height={Math.max(0, tall - 1)}
				rx={corner}
				fill="none"
				stroke={USAGE_COLOR}
				strokeWidth={1}
			/>
		);
	});
	return (
		<g>
			{segments}
			{reset ? (
				<IconRefresh
					x={left + size / 2 - RESET_ICON_PX / 2}
					y={snap(y) - RESET_ICON_PX - RESET_ICON_GAP_PX}
					size={RESET_ICON_PX}
					stroke={1.75}
					color="var(--cost-muted)"
					title={reset}
					aria-label={reset}
				/>
			) : null}
		</g>
	);
}
