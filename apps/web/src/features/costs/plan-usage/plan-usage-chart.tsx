import { type Icon, IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/app/ui/skeleton";
import { EmptyState } from "@/components/dashboard/page-parts";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import { PillTabs } from "@/features/repos/pill-tabs";
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

const LOW_LEFT = 10;
const PROVIDER_NAMES: Record<PlanProvider, string> = {
	claude: "Claude",
	codex: "Codex",
};
const PROVIDER_TABS = [
	{ id: "claude", label: "Claude", icon: ClaudeModelIcon as unknown as Icon },
	{ id: "codex", label: "Codex", icon: CodexModelIcon as unknown as Icon },
] as const;
const MAX_TICKS = 9;

const timeFormat = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});
const resetFormat = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
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
	if (!iso) return "not checked yet";
	const minutes = Math.round((now - Date.parse(iso)) / 60_000);
	if (minutes < 1) return "checked just now";
	if (minutes < 60) return `checked ${minutes} min ago`;
	return `checked ${Math.round(minutes / 60)} h ago`;
}

function limitName(window: UsageWindow): string {
	return window.label.toLowerCase();
}

export function showsChart(window: UsageWindow): boolean {
	return window.sessions.length > 0 || window.totalPoints > 0;
}

export function PlanUsageChart({
	report,
	provider,
	onProviderChange,
	pending,
	failed,
	refreshing,
	onRefresh,
}: {
	report: PlanUsageReport | null | undefined;
	provider: PlanProvider;
	onProviderChange: (provider: PlanProvider) => void;
	pending: boolean;
	failed: boolean;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const now = Date.now();
	const usage = report?.providers.find((entry) => entry.provider === provider);
	const window = usage?.window ?? null;
	const showChart = window !== null && showsChart(window);
	return (
		<div className="cost-chart-card plan-usage-card">
			<div className="cost-chart-key">
				<div className="cost-chart-key-copy">
					<h2 className="cost-chart-title">Plan usage</h2>
					<div className="cost-chart-legend">
						{showChart ? <KindLegend buckets={window.buckets} /> : null}
						<button
							type="button"
							className="cost-legend-item plan-usage-refresh"
							onClick={onRefresh}
							disabled={refreshing}
						>
							<IconRefresh size={12} aria-hidden="true" />
							{refreshing ? "Checking…" : ago(report?.checkedAt ?? null, now)}
						</button>
					</div>
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
				<div className="plan-usage-empty">
					<Skeleton className="h-[220px] w-full rounded-[8px]" />
				</div>
			) : showChart ? (
				<UsageBars window={window} titles={report?.titles ?? {}} />
			) : (
				<div className="plan-usage-empty">
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
		return `${planName(provider, usage?.plan ?? null)} has ${left}% of its ${limitName(window)} limit left${resets}.`;
	}
	if (usage?.error) return `${usage.error}.`;
	return `Opaline asks ${PROVIDER_NAMES[provider]} for its limits every few minutes while the app is open.`;
}

const HOUR_STEPS = [1, 2, 3, 4, 6, 12];

function ticksOf(buckets: readonly UsageBucket[], bucketMinutes: number) {
	const hourly = bucketMinutes < 60;
	const starts = buckets.flatMap((bucket, index) => {
		const at = new Date(bucket.at);
		if (at.getMinutes() !== 0) return [];
		if (!hourly && at.getHours() !== 0) return [];
		return [{ index, at }];
	});
	if (hourly) {
		const step =
			HOUR_STEPS.find((hours) => starts.length / hours <= MAX_TICKS) ?? 12;
		return starts
			.filter((tick) => tick.at.getHours() % step === 0)
			.map((tick) => ({
				index: tick.index,
				label: hourFormat.format(tick.at).replace(" ", "").replace("M", ""),
			}));
	}
	const step = Math.max(1, Math.ceil(starts.length / MAX_TICKS));
	return starts
		.filter((_, position) => position % step === 0)
		.map((tick) => ({ index: tick.index, label: dayFormat.format(tick.at) }));
}

const KIND_LABELS: Record<BucketKind, string> = {
	reading: "Read from the provider",
	between: "Between two readings",
	estimate: "Estimated from session cost",
};

function KindLegend({ buckets }: { buckets: readonly UsageBucket[] }) {
	const kinds = (["reading", "between", "estimate"] as const).filter((kind) =>
		buckets.some(
			(bucket) =>
				bucket.kind === kind &&
				(kind !== "between" ||
					(bucket.usedRange !== null &&
						bucket.usedRange[0] !== bucket.usedRange[1])),
		),
	);
	return kinds.map((kind) => (
		<div key={kind} className="cost-legend-item plan-usage-muted">
			<i className="plan-usage-swatch" data-kind={kind} aria-hidden="true" />
			{KIND_LABELS[kind]}
		</div>
	));
}

const MAX_BAR_PX = 10;
const LABEL_GAP_PX = 12;
const LABEL_CHAR_PX = 6.6;

function labelWidth(label: string): number {
	return label.length * LABEL_CHAR_PX + 4;
}

interface BarLayout {
	readonly pitch: number;
	readonly bar: number;
	readonly offset: number;
}

function barLayout(
	width: number,
	count: number,
	ratio: number,
): BarLayout | null {
	if (width <= 0 || count <= 0) return null;
	const pitch = Math.max(
		1 / ratio,
		Math.floor((width / count) * ratio) / ratio,
	);
	const bar = Math.min(
		MAX_BAR_PX,
		Math.max(1 / ratio, Math.round(pitch * 0.72 * ratio) / ratio),
	);
	const offset = Math.floor(((width - pitch * count) / 2) * ratio) / ratio;
	return { pitch, bar, offset };
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

function UsageBars({
	window,
	titles,
}: {
	window: UsageWindow;
	titles: Readonly<Record<string, string>>;
}) {
	const [hovered, setHovered] = useState<number | null>(null);
	const [plotRef, width] = useWidth<HTMLDivElement>();
	const count = window.buckets.length;
	const ratio =
		typeof globalThis.devicePixelRatio === "number"
			? Math.max(1, globalThis.devicePixelRatio)
			: 1;
	const layout = barLayout(width, count, ratio);
	const bucket = hovered === null ? undefined : window.buckets[hovered];
	const from = Date.parse(window.buckets[0]?.at ?? "");
	const span = count * window.bucketMinutes * 60_000;
	const xOf = (time: number) =>
		layout ? layout.offset + ((time - from) / span) * layout.pitch * count : 0;
	const resets = window.resets.map((at) => {
		const label = `Reset ${resetLabel(at)}`;
		return {
			at,
			label,
			x: xOf(Date.parse(at)),
			end: xOf(Date.parse(at)) + labelWidth(label),
		};
	});
	const nextReset =
		window.resetsAt && Date.parse(window.resetsAt) >= from + span
			? window.resetsAt
			: null;
	const ticks = ticksOf(window.buckets, window.bucketMinutes)
		.map((tick) => ({
			...tick,
			x: layout ? layout.offset + tick.index * layout.pitch : 0,
		}))
		.filter(
			(tick) =>
				resets.every(
					(reset) =>
						tick.x + labelWidth(tick.label) < reset.x - LABEL_GAP_PX ||
						tick.x > reset.end + LABEL_GAP_PX,
				) &&
				(!nextReset ||
					tick.x + labelWidth(tick.label) <
						width -
							labelWidth(`Next reset ${resetLabel(nextReset)}`) -
							LABEL_GAP_PX),
		);

	return (
		<div className="plan-usage-chart">
			<div
				ref={plotRef}
				className="plan-usage-plot"
				onPointerLeave={() => setHovered(null)}
			>
				<div className="plan-usage-grid" aria-hidden="true">
					<i />
					<i />
					<i />
				</div>
				{layout ? (
					<div
						className="plan-usage-bars"
						role="img"
						aria-label={`${Math.round(leftPercent(window.usedPercent))}% of the ${window.label.toLowerCase()} limit left`}
					>
						{resets.map((reset) => (
							<i
								key={reset.at}
								className="plan-usage-reset-line"
								style={{ left: reset.x }}
								aria-hidden="true"
							/>
						))}
						{window.buckets.map((entry, index) => (
							<div
								key={entry.at}
								className="plan-usage-slot"
								data-hovered={hovered === index || undefined}
								onPointerEnter={() => setHovered(index)}
								style={
									{
										left: layout.offset + index * layout.pitch,
										width: layout.pitch,
										"--bar-width": `${layout.bar}px`,
									} as CSSProperties
								}
							>
								<UsageBar bucket={entry} />
							</div>
						))}
					</div>
				) : null}
				{bucket && layout ? (
					<BucketTip
						bucket={bucket}
						minutes={window.bucketMinutes}
						titles={titles}
						side={hovered !== null && hovered > count / 2 ? "left" : "right"}
						x={layout.offset + ((hovered ?? 0) + 0.5) * layout.pitch}
					/>
				) : null}
			</div>
			<div className="plan-usage-axis" aria-hidden="true">
				<span>100%</span>
				<span>50%</span>
				<span>0%</span>
			</div>
			<div className="plan-usage-ticks" aria-hidden="true">
				{ticks.map((tick) => (
					<span key={tick.index} style={{ left: tick.x }}>
						{tick.label}
					</span>
				))}
				{resets.map((reset) => (
					<span
						key={reset.at}
						className="plan-usage-reset-tick"
						style={{ left: reset.x }}
					>
						{reset.label}
					</span>
				))}
				{nextReset ? (
					<span className="plan-usage-next-reset">
						Next reset {resetLabel(nextReset)}
					</span>
				) : null}
			</div>
		</div>
	);
}

const resetTickFormat = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
});

function resetLabel(at: string): string {
	return resetTickFormat.format(new Date(at));
}

function UsageBar({ bucket }: { bucket: UsageBucket }) {
	if (bucket.kind === null || bucket.usedPercent === null || !bucket.usedRange)
		return null;
	if (bucket.kind === "estimate") {
		const left = leftPercent(bucket.usedPercent);
		return (
			<span
				className="plan-usage-bar"
				data-kind="estimate"
				style={{ height: `${Math.max(left, 1.5)}%` }}
			/>
		);
	}
	const low = leftPercent(bucket.usedRange[1]);
	const high = leftPercent(bucket.usedRange[0]);
	return (
		<>
			<span
				className="plan-usage-bar"
				data-kind="reading"
				data-low={low < LOW_LEFT || undefined}
				style={{ height: `${Math.max(low, 1.5)}%` }}
			/>
			{high - low > 0 ? (
				<span
					className="plan-usage-bar"
					data-kind="between"
					style={{ bottom: `${low}%`, height: `${high - low}%` }}
				/>
			) : null}
		</>
	);
}

function bucketValue(bucket: UsageBucket): string {
	if (bucket.usedPercent === null || !bucket.usedRange || !bucket.kind)
		return "Not recorded (app closed)";
	if (bucket.kind === "estimate")
		return `About ${Math.round(leftPercent(bucket.usedPercent))}% left`;
	const low = Math.round(leftPercent(bucket.usedRange[1]));
	const high = Math.round(leftPercent(bucket.usedRange[0]));
	return low === high ? `${low}% left` : `${low}–${high}% left`;
}

function bucketSource(bucket: UsageBucket): string | null {
	if (bucket.kind === "reading" && bucket.readAt)
		return `Read at ${timeFormat.format(new Date(bucket.readAt))}`;
	if (bucket.kind === "between")
		return bucket.usedRange && bucket.usedRange[0] !== bucket.usedRange[1]
			? "Between two readings; the exact level is unknown"
			: "Same as the readings on both sides";
	if (bucket.kind === "estimate")
		return "Before recording started; spread over this Mac’s sessions by cost";
	return null;
}

function BucketTip({
	bucket,
	minutes,
	titles,
	side,
	x,
}: {
	bucket: UsageBucket;
	minutes: number;
	titles: Readonly<Record<string, string>>;
	side: "left" | "right";
	x: number;
}) {
	const start = new Date(bucket.at);
	const end = new Date(start.getTime() + minutes * 60_000);
	const source = bucketSource(bucket);
	return (
		<div className="plan-usage-tip" data-side={side} style={{ left: x }}>
			<div className="plan-usage-tip-time">
				{minutes >= 1440
					? dayFormat.format(start)
					: `${timeFormat.format(start)} – ${timeFormat.format(end)}`}
			</div>
			<div className="plan-usage-tip-value">{bucketValue(bucket)}</div>
			{bucket.plan ? (
				<div className="plan-usage-tip-plan">
					{planLabel(bucket.plan)} plan
					{bucket.kind === "estimate" ? " (at the first reading)" : ""}
				</div>
			) : null}
			{source ? <div className="plan-usage-muted">{source}</div> : null}
			{bucket.reset ? (
				<div className="plan-usage-muted">Limit reset</div>
			) : null}
			{bucket.sessions.map((session) => (
				<div key={session.sessionId} className="plan-usage-tip-row">
					<span>
						{titles[session.sessionId] ?? session.sessionId.slice(0, 8)}
					</span>
					<strong>
						{bucket.kind === "estimate" && session.points >= 1 ? "~" : ""}
						{formatPoints(session.points)}
					</strong>
				</div>
			))}
		</div>
	);
}
