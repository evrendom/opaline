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
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { PillTabs } from "@/features/repos/pill-tabs";
import {
	bucketDate,
	type ChartInterval,
	formatChartDate,
} from "../chart-interval";
import {
	type BucketKind,
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
const TICK_GAP_PX = 65;
const LABEL_CHAR_PX = 6.2;
const LABEL_GAP_PX = 12;
const RESET_ICON_PX = 14;
const RESET_ROW_PX = 15;
const LOW_LEFT = 10;
const USAGE_COLOR = "oklch(0.74 0.17 150)";
const LOW_COLOR = "oklch(0.64 0.21 27)";
const ESTIMATE_COLOR =
	"color-mix(in oklch, var(--cost-muted) 40%, transparent)";
const TICK_STYLE = { fill: "var(--cost-muted)", fontSize: 11 };
const DAY_MS = 86_400_000;

const timeFormat = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});
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
const periodFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
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

function ago(iso: string | null, now: number): string {
	if (!iso) return "Not checked yet";
	const minutes = Math.round((now - Date.parse(iso)) / 60_000);
	if (minutes < 1) return "Checked just now";
	if (minutes < 60) return `Checked ${minutes} min ago`;
	return `Checked ${Math.round(minutes / 60)} h ago`;
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
	readonly sessions: readonly { sessionId: string; points: number }[];
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
		const perSession = new Map<string, number>();
		let usedPoints = 0;
		for (const bucket of buckets) {
			usedPoints += bucket.usedPoints;
			for (const session of bucket.sessions)
				perSession.set(
					session.sessionId,
					(perSession.get(session.sessionId) ?? 0) + session.points,
				);
		}
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
			sessions: [...perSession]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4)
				.map(([sessionId, points]) => ({ sessionId, points })),
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

function periodLabel(period: Period): string {
	return period.startDate === period.endDate
		? periodFormat.format(new Date(`${period.startDate}T00:00:00Z`))
		: periodFormat.formatRange(
				new Date(`${period.startDate}T00:00:00Z`),
				new Date(`${period.endDate}T00:00:00Z`),
			);
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

function labelWidth(label: string): number {
	return label.length * LABEL_CHAR_PX + 8;
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
	refreshing,
	onRefresh,
}: {
	report: PlanUsageReport | null | undefined;
	provider: PlanProvider;
	onProviderChange: (provider: PlanProvider) => void;
	interval: ChartInterval;
	pending: boolean;
	failed: boolean;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const now = Date.now();
	const usage = report?.providers.find((entry) => entry.provider === provider);
	const window = usage?.window ?? null;
	const showChart = window !== null && showsChart(window);
	const estimated = window?.buckets.some(
		(bucket) => bucket.kind === "estimate",
	);
	const nextReset =
		window?.resetsAt && Date.parse(window.resetsAt) > now
			? window.resetsAt
			: null;
	return (
		<div className="cost-chart-card">
			<div className="cost-chart-key" data-fluid-menu-root="">
				<FluidMenuHover items=".cost-text-button" />
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
							{nextReset ? (
								<div className="cost-legend-item">
									Next reset{" "}
									<strong>{resetFormat.format(new Date(nextReset))}</strong>
								</div>
							) : null}
						</div>
					) : null}
					<output className="cost-chart-coverage">
						<span>{ago(report?.checkedAt ?? null, now)}</span>
						<button
							type="button"
							className="cost-text-button cost-coverage-refresh"
							onClick={onRefresh}
							disabled={refreshing}
						>
							{refreshing ? "Checking…" : "Check now"}
						</button>
					</output>
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
				<UsageCanvas
					window={window}
					provider={usage}
					interval={interval}
					titles={report?.titles ?? {}}
				/>
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
	titles,
}: {
	window: UsageWindow;
	provider: ProviderUsage | undefined;
	interval: ChartInterval;
	titles: Readonly<Record<string, string>>;
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
	const resets = window.resets.flatMap((at) => {
		const x = resetX(periods, at);
		return x === null
			? []
			: [
					{
						at,
						x,
						label: `Limit reset ${resetTickFormat.format(new Date(at))}`,
					},
				];
	});
	const step = Math.max(1, Math.ceil(TICK_GAP_PX / Math.max(pitch, 1)));
	const rows: { from: number; to: number }[][] = [[], []];
	const place = (x: number, size: number, row: number) => {
		const center = (x + 0.5) * pitch;
		const span = { from: center - size / 2, to: center + size / 2 };
		const taken = rows[row] ?? [];
		if (
			taken.some(
				(other) =>
					span.from < other.to + LABEL_GAP_PX &&
					span.to > other.from - LABEL_GAP_PX,
			)
		)
			return false;
		taken.push(span);
		return true;
	};
	const ticks = periods
		.filter((period) => period.x % step === 0)
		.filter((period) =>
			place(period.x, labelWidth(formatChartDate(period.date, interval)), 0),
		)
		.map((period) => period.x);
	const resetRow = new Map<number, number>();
	for (const reset of resets) {
		if (place(reset.x, RESET_ICON_PX, 0)) resetRow.set(reset.x, 0);
		else if (place(reset.x, RESET_ICON_PX, 1)) resetRow.set(reset.x, 1);
	}
	return (
		<div ref={canvasRef} className="cost-chart-canvas" skullet-ignore="">
			{width > 0 ? (
				<ResponsiveContainer width="100%" height="100%" minWidth={0}>
					<ComposedChart
						data={periods}
						margin={{ ...MARGIN, right: MARGIN.right + spare }}
						accessibilityLayer
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
							ticks={[...ticks, ...resetRow.keys()]}
							interval={0}
							allowDecimals
							axisLine={false}
							tickLine={false}
							tickMargin={14}
							height={
								resetRow.size > 0 && [...resetRow.values()].includes(1)
									? 54
									: 40
							}
							tick={(props: XAxisTickContentProps) => {
								const x = Number(props.x ?? 0);
								const y = Number(props.y ?? 0);
								const value = Number(props.payload?.value);
								const reset = resets.find((entry) => entry.x === value);
								if (reset)
									return (
										<IconRefresh
											x={x - RESET_ICON_PX / 2}
											y={y - 1 + (resetRow.get(value) ?? 0) * RESET_ROW_PX}
											size={RESET_ICON_PX}
											stroke={1.75}
											color="var(--cost-muted)"
											title={reset.label}
											aria-label={reset.label}
										/>
									);
								const period = periods[Number(value)];
								return (
									<text
										x={x}
										y={y}
										dy="0.71em"
										textAnchor="middle"
										fill={TICK_STYLE.fill}
										fontSize={TICK_STYLE.fontSize}
									>
										{period ? formatChartDate(period.date, interval) : ""}
									</text>
								);
							}}
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
									<PeriodTip
										period={period}
										provider={provider}
										titles={titles}
									/>
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
								<SnappedBar {...props} snap={snap} radius={2} outline />
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
}: BarShapeProps & {
	snap: (value: number) => number;
	radius: number;
	outline?: boolean;
}) {
	if (!(height > 0) || !(width > 0)) return null;
	const left = snap(x);
	const top = snap(y);
	const size = snap(width);
	const tall = snap(y + height) - top;
	const corner = Math.min(radius, size / 2, tall);
	const path = `M${left},${top + tall}V${top + corner}Q${left},${top} ${left + corner},${top}H${left + size - corner}Q${left + size},${top} ${left + size},${top + corner}V${top + tall}`;
	return outline ? (
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
}

const KIND_TEXT: Record<BucketKind, string> = {
	reading: "Read from the provider",
	between: "Between two readings",
	estimate: "Estimated from session cost",
};

function PeriodTip({
	period,
	provider,
	titles,
}: {
	period: Period;
	provider: ProviderUsage | undefined;
	titles: Readonly<Record<string, string>>;
}) {
	const last = period.last;
	const range = last?.usedRange ?? null;
	const low = range ? Math.round(leftPercent(range[1])) : null;
	const high = range ? Math.round(leftPercent(range[0])) : null;
	const estimate = last?.kind === "estimate";
	return (
		<div className="cost-chart-tooltip">
			<p>{periodLabel(period)}</p>
			<div>
				<span>
					<i
						style={{
							backgroundColor: last ? solidColor(period) : "transparent",
						}}
					/>
					Left at the end
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
				<span>Used in this period</span>
				<strong>
					{estimate && period.usedPoints >= 1 ? "~" : ""}
					{formatPoints(period.usedPoints)}
				</strong>
			</div>
			{last?.kind ? (
				<p>
					{last.kind === "reading" && last.readAt
						? `Read at ${timeFormat.format(new Date(last.readAt))}`
						: KIND_TEXT[last.kind]}
					{last.plan
						? ` · ${planName(provider?.provider ?? "claude", last.plan)}${estimate ? " (at the first reading)" : ""}`
						: ""}
				</p>
			) : null}
			{period.sessions.map((session) => (
				<div key={session.sessionId}>
					<span className="plan-usage-tip-session">
						{titles[session.sessionId] ?? session.sessionId.slice(0, 8)}
					</span>
					<strong>
						{estimate && session.points >= 1 ? "~" : ""}
						{formatPoints(session.points)}
					</strong>
				</div>
			))}
		</div>
	);
}
