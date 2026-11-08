import type {
	CostBreakdownEntry,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import { AGENT_RUN_DURATIONS } from "@rudel/api-routes";
import {
	IconArrowsDiagonal,
	IconArrowsDiagonalMinimize2,
} from "@tabler/icons-react";
import {
	type CSSProperties,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { orpc } from "@/lib/orpc";
import { type ChartInterval, groupChartTrend } from "./chart-interval";
import { formatMetric } from "./cost-format";
import { useMarkedDate } from "./cost-hover-date";
import type { MetricBreakdowns } from "./cost-rail-override";
import { RollingText } from "./cost-rolling-text";

const BARS = 5;
const SHEET_PAD = 6;
const DEEP_HEAD_PX = 44;
const DEEP_ROW_PX = 25;

type DeepView = {
	title: string;
	entries: CostBreakdownEntry[];
	format: (value: number) => string;
	ordered?: boolean;
};

const DEEP_DIMENSION: Partial<
	Record<
		DashboardMetric,
		{
			title: string;
			dimension: keyof DashboardMetricData["breakdowns"];
			ordered?: boolean;
		}
	>
> = {
	cost: { title: "By model", dimension: "models" },
	sessions: { title: "By member", dimension: "members" },
	agentRuns: {
		title: "How long runs take",
		dimension: "durations",
		ordered: true,
	},
	ciRuns: { title: "By outcome", dimension: "ciConclusions" },
};

const LANGUAGE: { id: string; label: string }[] = [
	{ id: "userNegative", label: "Swearwords" },
	{ id: "modelApologies", label: "Apologies" },
];

function languageView(types: readonly { id: string; value: number }[]) {
	const entries = LANGUAGE.map(({ id, label }) => ({
		id,
		label,
		value: types.find((entry) => entry.id === id)?.value ?? 0,
		incomplete: false,
		image: null,
	}));
	if (entries.every((entry) => entry.value === 0)) return null;
	return {
		title: "Swearwords vs apologies",
		entries,
		format: (value: number) => formatMetric(value, "sessions"),
		ordered: true,
	};
}

export function deepDimensionOf(metric: DashboardMetric | null) {
	return metric ? (DEEP_DIMENSION[metric]?.dimension ?? null) : null;
}

export function deepViewAt(
	view: DeepView,
	metric: DashboardMetric,
	split: DashboardMetricData | null | undefined,
	date: string | null,
	interval: ChartInterval,
): DeepView {
	if (!date || !split) return view;
	const point = groupChartTrend(split.trend, interval).find(
		(each) => each.date === date,
	);
	if (!point) return view;
	const valueFor = (label: string) => {
		const series = split.series.find((each) => each.label === label);
		return series ? (point.values[series.id] ?? 0) : 0;
	};
	if (metric === "signals")
		return {
			...view,
			entries: view.entries.map((entry) => ({
				...entry,
				value: valueFor(
					entry.id === "userNegative" ? "Negative user" : "Model apologies",
				),
			})),
		};
	const pretty = deepDimensionOf(metric) === "models";
	const entries = split.series
		.filter((series) => series.id !== "other")
		.map((series) => ({
			id: series.id,
			label: pretty ? formatModelDisplayLabel(series.label) : series.label,
			value: point.values[series.id] ?? 0,
			incomplete: false,
			image: null,
		}));
	const ranked = (
		view.ordered ? entries : entries.sort((a, b) => b.value - a.value)
	)
		.filter((entry) => entry.value > 0)
		.slice(0, BARS);
	return { ...view, entries: ranked };
}

export function deepViewOf(
	metric: DashboardMetric,
	data: DashboardMetricData | null | undefined,
	languageSplit?: DashboardMetricData | null,
): DeepView | null {
	if (metric === "signals")
		return languageView(languageSplit?.breakdowns.signalTypes ?? []);
	const pick = DEEP_DIMENSION[metric];
	if (!pick || !data) return null;
	return rankedView(metric, data.breakdowns[pick.dimension] ?? []);
}

type MemberLabel = { label: string; image: string | null };

export function filteredDeepViewOf(
	metric: DashboardMetric,
	breakdowns: MetricBreakdowns | null,
	memberOf: (id: string) => MemberLabel | undefined,
): DeepView | null {
	if (!breakdowns) return null;
	if (metric === "signals") return languageView(breakdowns.signalTypes);
	const entry = (
		id: string,
		value: number,
		label = id,
		image: string | null = null,
	): CostBreakdownEntry => ({ id, label, value, incomplete: false, image });
	if (metric === "cost")
		return rankedView(
			metric,
			breakdowns.models.map((each) => entry(each.id, each.value)),
		);
	if (metric === "sessions")
		return rankedView(
			metric,
			breakdowns.members.map((each) => {
				const member = memberOf(each.id);
				return entry(
					each.id,
					each.value,
					member?.label ?? "Former member",
					member?.image ?? null,
				);
			}),
		);
	if (metric === "agentRuns")
		return rankedView(
			metric,
			AGENT_RUN_DURATIONS.map((bucket) =>
				entry(
					bucket.id,
					breakdowns.durations.find((each) => each.id === bucket.id)?.value ??
						0,
					bucket.label,
				),
			),
		);
	return null;
}

function rankedView(
	metric: DashboardMetric,
	all: readonly CostBreakdownEntry[],
): DeepView | null {
	const pick = DEEP_DIMENSION[metric];
	if (!pick) return null;
	const entries = (
		pick.ordered ? all : [...all].sort((a, b) => b.value - a.value)
	)
		.filter((entry) => entry.value > 0)
		.slice(0, BARS)
		.map((entry) =>
			pick.dimension === "models"
				? { ...entry, label: formatModelDisplayLabel(entry.label) }
				: entry,
		);
	if (entries.length === 0) return null;
	return {
		title: pick.title,
		entries,
		format: (value) => formatMetric(value, metric),
		ordered: pick.ordered,
	};
}

function DeepTile({ view }: { view: DeepView }) {
	const peak = Math.max(...view.entries.map((entry) => entry.value), 1);
	return (
		<section className="cost-metric-deep" aria-label={view.title}>
			<h3>{view.title}</h3>
			<ul>
				{view.entries.map((entry) => (
					<li key={entry.id}>
						<span className="cost-metric-deep-label" title={entry.label}>
							{entry.label}
						</span>
						<span
							className="cost-metric-deep-bar"
							style={
								{
									"--deep-share": `${(entry.value / peak) * 100}%`,
								} as CSSProperties
							}
						>
							<span className="cost-metric-deep-value">
								<RollingText text={view.format(entry.value)} />
							</span>
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

export function ExpandButton({
	expanded,
	onToggle,
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	const Icon = expanded ? IconArrowsDiagonalMinimize2 : IconArrowsDiagonal;
	return (
		<button
			type="button"
			className="cost-metric-expand"
			aria-expanded={expanded}
			aria-label={expanded ? "Collapse details" : "Expand details"}
			onClick={onToggle}
		>
			<Icon aria-hidden="true" />
		</button>
	);
}

type Anchor = { top: number; left: number; width: number; height: number };

export function MetricSheet({
	color,
	container,
	interval,
	metric,
	split,
	view: totals,
	onClose,
}: {
	color: string;
	container: RefObject<HTMLElement | null>;
	interval: ChartInterval;
	metric: DashboardMetric;
	split: DashboardMetricData | null | undefined;
	view: DeepView;
	onClose: () => void;
}) {
	const marked = useMarkedDate();
	const view = deepViewAt(totals, metric, split, marked, interval);
	const [anchor, setAnchor] = useState<
		(Anchor & { upward: boolean; space: number }) | null
	>(null);
	const deep = DEEP_HEAD_PX + totals.entries.length * DEEP_ROW_PX;
	useLayoutEffect(() => {
		const host = container.current;
		const card = host?.querySelector<HTMLElement>(
			`.cost-metric[data-metric="${metric}"]`,
		);
		if (!host || !card) return;
		const read = () => {
			const below = host.clientHeight - (card.offsetTop + card.offsetHeight);
			setAnchor({
				top: card.offsetTop,
				left: card.offsetLeft,
				width: card.offsetWidth,
				height: card.offsetHeight,
				upward: below < deep + SHEET_PAD && card.offsetTop > below,
				space: host.clientHeight,
			});
		};
		read();
		const observer = new ResizeObserver(read);
		observer.observe(host);
		observer.observe(card);
		return () => observer.disconnect();
	}, [container, metric, deep]);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		const onPointer = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target?.closest(".cost-metric-sheet") ||
				target?.closest(".cost-chart-card") ||
				target?.closest(`.cost-metric[data-metric="${metric}"]`)
			)
				return;
			onClose();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onPointer);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onPointer);
		};
	}, [metric, onClose]);
	if (!anchor) return null;
	return (
		<div
			className="cost-metric-sheet corner-squircle"
			data-upward={anchor.upward || undefined}
			style={
				{
					"--metric-color": color,
					top: anchor.upward ? undefined : anchor.top - SHEET_PAD,
					bottom: anchor.upward
						? anchor.space - (anchor.top + anchor.height) - SHEET_PAD
						: undefined,
					left: anchor.left - SHEET_PAD,
					width: anchor.width + 2 * SHEET_PAD,
					"--sheet-card": `${anchor.height + 2 * SHEET_PAD}px`,
				} as CSSProperties
			}
		>
			<DeepTile view={view} />
		</div>
	);
}

export function useDeepSplit(
	inputFor:
		| ((metric: CostDashboardRequestedMetric) => CostDashboardInput)
		| undefined,
	metric: DashboardMetric | null,
) {
	const dimension = deepDimensionOf(metric);
	const ready = Boolean(inputFor && metric && dimension);
	const input = ready
		? {
				...(
					inputFor as (m: CostDashboardRequestedMetric) => CostDashboardInput
				)(metric as CostDashboardRequestedMetric),
				splitBy: dimension as CostDashboardInput["splitBy"],
			}
		: ({} as CostDashboardInput);
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		enabled: ready,
		staleTime: 60_000,
	});
	return ready && metric ? query.data?.metrics[metric] : undefined;
}
