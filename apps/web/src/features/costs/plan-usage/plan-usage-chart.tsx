import { type Icon, IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	type XAxisTickContentProps,
	YAxis,
} from "recharts";
import { Skeleton } from "@/app/ui/skeleton";
import { EmptyState } from "@/components/dashboard/page-parts";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { PillTabs } from "@/features/repos/pill-tabs";
import { EdgeTick, edgeTicks, useAxisHover } from "../chart-edge-axis";
import {
	bucketDate,
	type ChartInterval,
	formatChartDate,
} from "../chart-interval";
import {
	leftPercent,
	type PlanProvider,
	type PlanUsageReport,
	type ProviderUsage,
	planLabel,
	type UsageBucket,
	type UsageWindow,
} from "./use-plan-usage";
import "./plan-usage.css";

const PROVIDER_NAMES: Record<PlanProvider, string> = {
	claude: "Claude",
	codex: "Codex",
};
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
const LOW_LEFT = 10;
const USAGE_COLOR = "oklch(0.74 0.17 150)";
const LOW_COLOR = "oklch(0.64 0.21 27)";
const ESTIMATE_COLOR =
	"color-mix(in oklch, var(--cost-muted) 40%, transparent)";
const TICK_STYLE = { fill: "var(--cost-muted)", fontSize: 11 };
const DAY_MS = 86_400_000;

const resetFormat = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});
const resetTickFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
});

export function formatPoints(points: number): string {
	if (points <= 0) return "0%";
	if (points < 1) return "<1%";
	return `${Math.round(points)}%`;
}

function planName(provider: PlanProvider, plan: string | null): string {
	const label = planLabel(plan);
	return label
		? `${PROVIDER_NAMES[provider]} ${label}`
		: PROVIDER_NAMES[provider];
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
	readonly usedPoints: number;
	readonly solid: number | null;
	readonly cap: number | null;
}

function periodsOf(window: UsageWindow, interval: ChartInterval): Period[] {
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
			usedPoints,
			solid: estimate
				? last?.usedPercent === null || !last
					? null
					: leftPercent(last.usedPercent)
				: low,
			cap:
				!estimate && low !== null && high !== null && high > low
					? high - low
					: null,
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
}: {
	report: PlanUsageReport | null | undefined;
	provider: PlanProvider;
	onProviderChange: (provider: PlanProvider) => void;
	interval: ChartInterval;
	pending: boolean;
	failed: boolean;
}) {
	const usage = report?.providers.find((entry) => entry.provider === provider);
	const window = usage?.window ?? null;
	const showChart = window !== null && showsChart(window);
	const estimated = window?.buckets.some(
		(bucket) => bucket.kind === "estimate",
	);
	return (
		<div className="cost-chart-card">
			<div className="cost-chart-key">
				<div className="cost-chart-key-copy">
					<h2 className="cost-chart-title">Usage over time</h2>
					{showChart ? (
						<div className="cost-chart-legend">
							<div className="cost-legend-item">
								<i style={{ backgroundColor: USAGE_COLOR }} />
								Left, read from {PROVIDER_NAMES[provider]}
							</div>
							{estimated ? (
								<div className="cost-legend-item">
									<i style={{ backgroundColor: ESTIMATE_COLOR }} />
									Estimated from session cost
								</div>
							) : null}
						</div>
					) : null}
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
			{pending ? (
				<div className="cost-chart-canvas">
					<Skeleton className="size-full rounded-[8px]" />
				</div>
			) : showChart ? (
				<UsageCanvas window={window} provider={usage} interval={interval} />
			) : (
				<div className="cost-chart-canvas plan-usage-empty">
					<EmptyState
						icon={IconAlertTriangle}
						title={emptyTitle(provider, usage, failed)}
						description={emptyText(provider, usage, failed)}
					/>
				</div>
			)}
		</div>
	);
}

function emptyTitle(
	provider: PlanProvider,
	usage: ProviderUsage | undefined,
	failed: boolean,
): string {
	if (failed) return "Plan usage couldn’t load";
	if (usage?.window) return `No ${PROVIDER_NAMES[provider]} use in this period`;
	return `No ${PROVIDER_NAMES[provider]} plan limits yet`;
}

function emptyText(
	provider: PlanProvider,
	usage: ProviderUsage | undefined,
	failed: boolean,
): string {
	if (failed) return "Try again in a moment.";
	const window = usage?.window;
	if (window) {
		const left = Math.round(leftPercent(window.usedPercent));
		const resets = window.resetsAt
			? `, resetting ${resetFormat.format(new Date(window.resetsAt))}`
			: "";
		return `${planName(provider, usage?.plan ?? null)} has ${left}% of its ${window.label.toLowerCase()} limit left${resets}.`;
	}
	if (usage?.error) return `${usage.error}.`;
	return `Opaline asks ${PROVIDER_NAMES[provider]} for its limits every few minutes while the app is open.`;
}

function UsageCanvas({
	window,
	provider,
	interval,
}: {
	window: UsageWindow;
	provider: ProviderUsage | undefined;
	interval: ChartInterval;
}) {
	const [canvasRef, width] = useWidth<HTMLDivElement>();
	const periods = periodsOf(window, interval);
	const count = Math.max(1, periods.length);
	const ratio =
		typeof globalThis.devicePixelRatio === "number"
			? Math.max(1, globalThis.devicePixelRatio)
			: 1;
	const plot = Math.max(0, width - Y_AXIS_WIDTH - MARGIN.left - MARGIN.right);
	const pitch = Math.max(1 / ratio, Math.floor((plot / count) * ratio) / ratio);
	const spare = Math.max(0, plot - pitch * count);
	const bar = Math.min(
		MAX_BAR_PX,
		Math.max(2 / ratio, Math.round(pitch * BAR_SHARE * ratio) / ratio),
	);
	const snap = (value: number) => Math.round(value * ratio) / ratio;
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
	return (
		<div ref={canvasRef} className="cost-chart-canvas" skullet-ignore="">
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
						onMouseMove={axisHover.onMouseMove}
						onMouseLeave={axisHover.onMouseLeave}
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
							position={{ y: 48 }}
							isAnimationActive={false}
							cursor={{ fill: "var(--cost-hover)", opacity: 0.5 }}
							content={({ active, label }) => {
								const period = periods[Number(label)];
								return active && period ? (
									<PeriodTip period={period} provider={provider} />
								) : null;
							}}
						/>
						<Bar
							dataKey="solid"
							stackId="left"
							barSize={bar}
							isAnimationActive={false}
							shape={(props: BarShapeProps) => (
								<SnappedBar
									{...props}
									snap={snap}
									radius={props.payload?.cap ? 0 : 2}
									reset={
										props.payload?.cap
											? undefined
											: resetDays.get(props.payload?.x ?? -1)
									}
								/>
							)}
						>
							{periods.map((period) => (
								<Cell key={period.date} fill={solidColor(period)} />
							))}
						</Bar>
						<Bar
							dataKey="cap"
							stackId="left"
							barSize={bar}
							isAnimationActive={false}
							shape={(props: BarShapeProps) => (
								<SnappedBar
									{...props}
									snap={snap}
									radius={2}
									outline
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

function solidColor(period: Period): string {
	if (period.last?.kind === "estimate") return ESTIMATE_COLOR;
	return period.solid !== null && period.solid < LOW_LEFT
		? LOW_COLOR
		: USAGE_COLOR;
}

interface BarShapeProps {
	readonly x?: number;
	readonly y?: number;
	readonly width?: number;
	readonly height?: number;
	readonly fill?: string;
	readonly payload?: Period;
}

function SnappedBar({
	x = 0,
	y = 0,
	width = 0,
	height = 0,
	fill,
	snap,
	radius,
	outline = false,
	reset,
}: BarShapeProps & {
	snap: (value: number) => number;
	radius: number;
	outline?: boolean;
	reset?: string;
}) {
	if (!(height > 0) || !(width > 0)) return null;
	const left = snap(x);
	const top = snap(y);
	const size = snap(width);
	const tall = snap(y + height) - top;
	const corner = Math.min(radius, size / 2, tall);
	const path = `M${left},${top + tall}V${top + corner}Q${left},${top} ${left + corner},${top}H${left + size - corner}Q${left + size},${top} ${left + size},${top + corner}V${top + tall}`;
	const shape = outline ? (
		<path
			d={path}
			fill="none"
			stroke={USAGE_COLOR}
			strokeWidth={1}
			vectorEffect="non-scaling-stroke"
		/>
	) : (
		<path d={`${path}Z`} fill={fill} />
	);
	if (!reset) return shape;
	return (
		<g>
			{shape}
			<IconRefresh
				x={left + size / 2 - RESET_ICON_PX / 2}
				y={top - RESET_ICON_PX - RESET_ICON_GAP_PX}
				size={RESET_ICON_PX}
				stroke={1.75}
				color="var(--cost-muted)"
				title={reset}
				aria-label={reset}
			/>
		</g>
	);
}

function PeriodTip({
	period,
	provider,
}: {
	period: Period;
	provider: ProviderUsage | undefined;
}) {
	const last = period.last;
	const range = last?.usedRange ?? null;
	const low = range ? Math.round(leftPercent(range[1])) : null;
	const high = range ? Math.round(leftPercent(range[0])) : null;
	const estimate = last?.kind === "estimate";
	const plan = last?.plan
		? planName(provider?.provider ?? "claude", last.plan)
		: null;
	return (
		<div className="cost-chart-tooltip">
			{plan ? <p>{plan}</p> : null}
			<div>
				<span>
					<i
						style={{
							backgroundColor: last ? solidColor(period) : "transparent",
						}}
					/>
					Left
				</span>
				<strong>
					{last?.usedPercent === null || !last
						? "—"
						: estimate
							? `~${Math.round(leftPercent(last.usedPercent))}%`
							: low === high
								? `${low}%`
								: `${low}–${high}%`}
				</strong>
			</div>
			<div>
				<span>Used</span>
				<strong>
					{estimate && period.usedPoints >= 1 ? "~" : ""}
					{formatPoints(period.usedPoints)}
				</strong>
			</div>
		</div>
	);
}
