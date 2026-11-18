import type {
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import { GITHUB_RETENTION_TOOLTIP } from "@rudel/api-routes";
import {
	createReactComponent,
	type Icon,
	IconBattery3,
	IconBattery3Filled,
	IconBolt,
	IconBoltFilled,
	IconCircleCheck,
	IconCircleCheckFilled,
	IconCoin,
	IconCoinFilled,
	IconGitCommit,
	IconGitMerge,
	IconMessages,
	IconMessagesFilled,
	IconMoodSmile,
	IconMoodSmileFilled,
	IconX,
} from "@tabler/icons-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	type XAxisTickContentProps,
	YAxis,
} from "recharts";
import { introRequested } from "@/app/first-open";
import { Skeleton } from "@/app/ui/skeleton";
import {
	Tooltip as InfoTooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/ui/tooltip";
import { ChartLoadingWave } from "@/components/ui/chart-loading-wave";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { useOptionalDateRange } from "@/features/analytics/date-range/DateRangeProvider";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { DemoTrendPreview } from "@/features/demo/demo-trend-preview";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { formatIsoDate } from "@/lib/format";
import { type AreaShape, morphAreas, readAreaShape } from "./area-morph";
import { PULL_REQUEST_COLOR, SERIES_COLORS } from "./chart-colors";
import { EdgeTick, edgeTicks, useAxisHover } from "./chart-edge-axis";
import { ChartEmptyNotice } from "./chart-empty-notice";
import {
	DASHBOARD_LOADING_LINE,
	DASHBOARD_LOADING_STEPS,
	HEARTBEAT_BASE_VALUE,
	HEARTBEAT_DOMAIN,
	LOADING_ROWS,
	LOADING_WAVE_HEIGHT,
	seriesKey,
} from "./chart-flow";
import {
	type ChartInterval,
	chartPeriodDates,
	formatChartDate,
	getChartSeriesValue,
	groupChartTrend,
	isCiHistoryAvailable,
} from "./chart-interval";
import { ChartMorph } from "./chart-morph";
import { sampleDates, sampleLevels } from "./chart-sample";
import {
	CiChart,
	CiRing,
	type CiTotals,
	ciTotals,
	useCiDays,
} from "./ci-chart";
import {
	CostDotChart,
	DotFocusContext,
	DotFocusDaysContext,
} from "./cost-dot-chart";
import {
	costLabel,
	formatChartValueTick,
	formatMetric,
	formatMetricRatio,
	formatRunDuration,
	getMetricData,
	getMetricTotal,
	METRIC_LABELS,
} from "./cost-format";
import {
	createHoverDateStore,
	HoverDateContext,
	useDotPick,
	useMarkedDate,
} from "./cost-hover-date";
import { formatPerRun, languageRates, perRunTick } from "./cost-language-rates";
import {
	deepViewOf,
	ExpandButton,
	filteredDeepViewOf,
	MetricSheet,
	useDeepSplit,
} from "./cost-metric-sheet";
import {
	MetricBreakdownContext,
	MetricEmptyContext,
	MetricLoadingContext,
	MetricOverrideContext,
} from "./cost-rail-override";
import { RollingText } from "./cost-rolling-text";
import { COST_LABELS } from "./use-cost-dashboard";
import type { MetricPreviews } from "./use-metric-previews";

// The chart's morph from its loading heartbeat into the real data.
const MORPH_MS = 800;
// Share of the chart width the loading window covers, and its fading edges.
const FLOW_WINDOW = 0.3;
const FLOW_FADE = 0.35;
// One sweep of the loading window (cost-chart-flow-window in the CSS).
const FLOW_CYCLE_MS = 2800;

type ChartPhase = "loading" | "prime" | "morph" | "idle";

const IconGitMergeFilled = createReactComponent(
	"outline",
	"git-merge-filled",
	"GitMergeFilled",
	[
		["path", { d: "M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", fill: "currentColor" }],
		["path", { d: "M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", fill: "currentColor" }],
		[
			"path",
			{ d: "M15 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", fill: "currentColor" },
		],
		["path", { d: "M7 8l0 8" }],
		["path", { d: "M7 8a4 4 0 0 0 4 4h4" }],
	],
);
const IconGitCommitFilled = createReactComponent(
	"outline",
	"git-commit-filled",
	"GitCommitFilled",
	[
		["path", { d: "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", fill: "currentColor" }],
		["path", { d: "M12 3l0 6" }],
		["path", { d: "M12 15l0 6" }],
	],
);

// Each stat card's glyph and accent, in Opaline's palette.
export const METRIC_APPEARANCE: Record<
	DashboardMetric,
	{ icon: Icon; outline: Icon; color: string }
> = {
	cost: { icon: IconCoinFilled, outline: IconCoin, color: SERIES_COLORS[3] },
	sessions: {
		icon: IconMessagesFilled,
		outline: IconMessages,
		color: SERIES_COLORS[0],
	},
	agentRuns: {
		icon: IconBoltFilled,
		outline: IconBolt,
		color: SERIES_COLORS[4],
	},
	signals: {
		icon: IconMoodSmileFilled,
		outline: IconMoodSmile,
		color: SERIES_COLORS[5],
	},
	mergedPullRequests: {
		icon: IconGitMergeFilled,
		outline: IconGitMerge,
		color: PULL_REQUEST_COLOR,
	},
	ciRuns: {
		icon: IconCircleCheckFilled,
		outline: IconCircleCheck,
		color: SERIES_COLORS[6],
	},
	ciFailuresPerPullRequest: {
		icon: IconCircleCheckFilled,
		outline: IconCircleCheck,
		color: SERIES_COLORS[1],
	},
	commits: {
		icon: IconGitCommitFilled,
		outline: IconGitCommit,
		color: SERIES_COLORS[7],
	},
};

const SIGNAL_COLORS: Record<string, string> = {
	modelApologies: SERIES_COLORS[3],
	userPositive: SERIES_COLORS[2],
	userNegative: SERIES_COLORS[1],
	positive: SERIES_COLORS[2],
	negative: SERIES_COLORS[1],
	mixed: SERIES_COLORS[3],
	none: SERIES_COLORS[0],
	noReply: SERIES_COLORS[8],
};
const CI_COLORS: Record<string, string> = {
	success: SERIES_COLORS[2],
	failure: SERIES_COLORS[1],
	timedOut: SERIES_COLORS[7],
	cancelled: SERIES_COLORS[8],
	neutral: SERIES_COLORS[8],
	skipped: SERIES_COLORS[6],
	actionRequired: SERIES_COLORS[3],
	inProgress: SERIES_COLORS[0],
};
type Props = {
	dots?: "only" | "switch";
	data: CostDashboard | undefined;
	pending: boolean;
	/** The metric the chart draws. */
	metric: DashboardMetric;
	/** The picked stat card; differs from `metric` while its chart loads. */
	selectedMetric?: DashboardMetric;
	metrics: readonly DashboardMetric[];
	/** The server has not yet said which metrics this scope offers, so cards
	 * for optional metrics may still join `metrics`. */
	metricsPending?: boolean;
	/** The active filter chips, shown in the chart's header. */
	filters?: ReactNode;
	/** Each stat card's own answer, the charted one included. */
	previews?: MetricPreviews;
	inputFor?: (metric: CostDashboardRequestedMetric) => CostDashboardInput;
	runSignals: CostDashboardInput["runSignals"];
	signalTypes: CostDashboardInput["signalTypes"];
	interval: ChartInterval;
	onMetricChange: (metric: DashboardMetric) => void;
	/** A pointer or focus on a stat card: start loading its chart. */
	onMetricIntent?: (metric: DashboardMetric) => void;
	onRefresh: () => void;
	refreshing: boolean;
	splitBy: CostDashboardInput["splitBy"];
	onResetSplit: () => void;
	usage?: UsageTab;
	held?: boolean;
};

export interface UsageTab {
	readonly value: string | undefined;
	readonly trend: number[] | undefined;
	readonly dates?: string[];
	readonly textAt?: (index: number) => string;
	readonly chip?: string;
	readonly chipAt?: (index: number) => string;
	readonly selected: boolean;
	readonly onSelect: () => void;
	readonly pending: boolean;
	readonly chart: (dots: boolean, pending: boolean) => ReactNode;
	readonly breakdowns: (pending: boolean) => ReactNode;
}

const USAGE_COLOR = "oklch(0.74 0.17 150)";

export const USAGE_APPEARANCE = {
	icon: IconBattery3Filled,
	outline: IconBattery3,
	color: USAGE_COLOR,
} as const;

export function CostChart({
	dots,
	data: dashboard,
	pending,
	splitBy,
	onResetSplit,
	metric,
	selectedMetric = metric,
	metrics,
	metricsPending = false,
	filters,
	previews,
	inputFor,
	runSignals,
	signalTypes,
	onMetricChange,
	onMetricIntent,
	onRefresh,
	refreshing,
	interval,
	usage,
	held = false,
}: Props) {
	const mergedGitHub =
		metrics.includes("mergedPullRequests") && metrics.includes("ciRuns");
	const demo = useDemoRuntime();
	const workspace = useOptionalOrganization();
	const overrides = useContext(MetricOverrideContext);
	const overridesLoading = useContext(MetricLoadingContext);
	const empty = useContext(MetricEmptyContext);
	const [kind, setKind] = useState<"dots" | "line">("line");
	const showDots = dots === "only" || (dots === "switch" && kind === "dots");
	const [showMedian, setShowMedian] = useState(true);
	const [showP95, setShowP95] = useState(true);
	const [showCiFailures, setShowCiFailures] = useState(true);
	// The chart loads as itself (chart-flow.ts). "loading" draws the heartbeat;
	// "prime" keeps it flowing after the data lands, until the browser is
	// idle; "morph" draws the real data with its areas animated from the
	// heartbeat (area-morph.ts); "idle" is the same chart, interactive.
	const perRunChart =
		metric === "signals" &&
		splitBy === "none" &&
		!overrides?.has("signals") &&
		previews !== undefined;
	const loading =
		pending || (perRunChart && previews?.languageSplit === undefined);
	const [phase, setPhase] = useState<ChartPhase>(loading ? "loading" : "idle");
	const [hoverStore] = useState(createHoverDateStore);
	const axisHover = useAxisHover();
	const metricsRef = useRef<HTMLFieldSetElement>(null);
	const [expanded, setExpanded] = useState<DashboardMetric | null>(null);
	if (expanded !== null && expanded !== selectedMetric) setExpanded(null);
	const collapse = useCallback(() => setExpanded(null), []);
	const filteredBreakdowns = useContext(MetricBreakdownContext);
	const filtered = filteredBreakdowns !== undefined;
	const members = workspace?.state.members;
	const memberOf = useCallback(
		(id: string) => {
			const user = members?.find((member) => member.userId === id)?.user;
			return user
				? { label: user.name?.trim() || user.email, image: user.image ?? null }
				: undefined;
		},
		[members],
	);
	const deepView = filtered
		? filteredDeepViewOf(selectedMetric, filteredBreakdowns, memberOf)
		: deepViewOf(
				selectedMetric,
				getMetricData(dashboard, selectedMetric),
				previews?.languageSplit,
			);
	const deepSplit = useDeepSplit(inputFor, filtered ? null : expanded);
	const [wasPending, setWasPending] = useState(loading);
	const [linesEntering, setLinesEntering] = useState(false);
	const canvasRef = useRef<HTMLDivElement>(null);
	const flowRef = useRef<HTMLDivElement>(null);
	const flowTrackRef = useRef<HTMLDivElement>(null);
	const heartbeatShapeRef = useRef<AreaShape | null>(null);
	const data = getMetricData(dashboard, metric);
	const history = data?.githubHistory;
	const availableFrom =
		metric === "ciRuns" ? history?.ciFrom : history?.pullRequestsFrom;
	const noHistory = Boolean(
		availableFrom &&
			data?.trend.at(-1)?.date &&
			(data.trend.at(-1)?.date ?? "") < availableFrom,
	);
	const ciData = dashboard?.metrics.ciFailuresPerPullRequest;
	const ciDays = useCiDays({
		inputFor,
		merged: getMetricData(
			previews ? previews.mergedPullRequests : dashboard,
			"mergedPullRequests",
		),
		interval,
		enabled: mergedGitHub,
	});
	const ciRingAt = useCallback(
		(date: string | null): CiTotals | undefined => {
			if (!ciDays) return undefined;
			if (date === null) return ciTotals(ciDays);
			return ciDays.find((day) => day.date === date);
		},
		[ciDays],
	);
	const metricLabel = METRIC_LABELS[metric];
	const ciHistoryAvailable =
		metric !== "ciRuns" ||
		isCiHistoryAvailable(history, data?.trend.at(-1)?.date ?? "");
	const unavailable = data === null || !ciHistoryAvailable;
	const unavailableLabel =
		metric === "mergedPullRequests" || metric === "ciFailuresPerPullRequest"
			? "Pull request data is unavailable"
			: metric === "ciRuns"
				? "CI history is unavailable"
				: `${metricLabel} are still being indexed`;
	const coverage = metric === "agentRuns" ? data?.coverage : undefined;
	const durationStats =
		metric === "agentRuns" || metric === "ciRuns"
			? data?.durationStats
			: undefined;
	const gradientId = useId();
	const today = formatIsoDate(new Date());
	const dateRange = useOptionalDateRange();
	const rangeStart = dateRange?.state.startDate;
	const rangeEnd = dateRange?.state.endDate;
	const sampled =
		!loading && (unavailable || noHistory || Boolean(data && !data.hasUsage));
	const ciChart =
		mergedGitHub &&
		metric === "mergedPullRequests" &&
		inputFor !== undefined &&
		!sampled &&
		!showDots;
	const ciRange = ciDays ? ciTotals(ciDays) : null;
	const dataTrend = useMemo(() => {
		// Percentiles are calculated from individual runs for the requested period.
		// Never regroup daily percentiles by summing or averaging them.
		const durations = new Map(
			durationStats?.interval === interval
				? durationStats.trend.map((point) => [point.date, point])
				: [],
		);
		const ciTrend = new Map(
			metric === "mergedPullRequests"
				? groupChartTrend(ciData?.trend ?? [], interval, "ratio").map(
						(point) => [point.date, point],
					)
				: [],
		);
		const cycle = new Map(
			data?.cycleTimeStats?.interval === interval
				? data.cycleTimeStats.trend.map((point) => [point.date, point])
				: [],
		);
		return groupChartTrend(data?.trend ?? [], interval).map((point) => ({
			...point,
			cycleMedianSeconds: cycle.get(point.date)?.medianSeconds,
			cycleP90Seconds: cycle.get(point.date)?.p90Seconds,
			ciMinutes: ciHistoryAvailable
				? data?.ciMinutes?.trend
						.filter(
							(day) => day.date >= point.startDate && day.date <= point.endDate,
						)
						.reduce((sum, day) => sum + day.minutes, 0)
				: undefined,
			ciFailureRatio:
				point.startDate > today ||
				(ciTrend.get(point.date)?.denominator ?? 0) === 0
					? null
					: (ciTrend.get(point.date)?.total ?? null),
			ciFailureDenominator: ciTrend.get(point.date)?.denominator,
			medianSeconds:
				point.startDate > today
					? null
					: (durations.get(point.date)?.medianSeconds ?? null),
			p95Seconds:
				point.startDate > today
					? null
					: (durations.get(point.date)?.p95Seconds ?? null),
		}));
	}, [
		ciData?.trend,
		ciHistoryAvailable,
		data?.trend,
		data?.cycleTimeStats,
		data?.ciMinutes,
		durationStats,
		interval,
		metric,
		today,
	]);
	const trend = useMemo(
		() =>
			!sampled || !rangeEnd
				? dataTrend
				: groupChartTrend(
						sampleDates(rangeEnd).map((date) => ({
							date,
							total: 0,
							values: {},
						})),
						"daily",
					).map((point) => ({
						...point,
						cycleMedianSeconds: undefined,
						cycleP90Seconds: undefined,
						ciMinutes: undefined,
						ciFailureRatio: null,
						ciFailureDenominator: undefined,
						medianSeconds: null,
						p95Seconds: null,
					})),
		[sampled, dataTrend, rangeEnd],
	);
	const frustration = useMemo(
		() =>
			metric === "signals" && !overrides?.has("signals")
				? languageRates(
						previews?.languageSplit,
						getMetricData(
							previews ? previews.agentRuns : dashboard,
							"agentRuns",
						),
						interval,
					)
				: undefined,
		[metric, overrides, previews, dashboard, interval],
	);
	const dotPoints = useMemo(() => {
		if (!frustration) return trend;
		const byDate = new Map(
			frustration.dates.map((date, at) => [date, frustration.swears[at] ?? 0]),
		);
		return trend.map((point) => ({
			...point,
			total: byDate.get(point.date) ?? 0,
		}));
	}, [trend, frustration]);
	const sampleDots = useMemo(() => {
		if (!sampled || !rangeStart || !rangeEnd) return dotPoints;
		const days = groupChartTrend(
			chartPeriodDates(rangeStart, rangeEnd, "daily").map((date) => ({
				date,
				total: 0,
				values: {},
			})),
			interval,
		);
		const levels = sampleLevels(days.length);
		return days.map((point, index) => ({
			...point,
			total: levels[index] ?? 0,
		}));
	}, [sampled, dotPoints, rangeStart, rangeEnd, interval]);
	const loadingDots = useMemo(
		() =>
			showDots && loading && rangeStart && rangeEnd
				? groupChartTrend(
						chartPeriodDates(rangeStart, rangeEnd, "daily").map((date) => ({
							date,
							total: 0,
							values: {},
						})),
						interval,
					)
				: null,
		[showDots, loading, rangeStart, rangeEnd, interval],
	);
	const visiblePointCount = trend.filter(
		(point) => point.startDate <= today,
	).length;
	const signalDimension = metric === "signals" ? "signalTypes" : "runSignals";
	const selectedSignals = metric === "signals" ? signalTypes : runSignals;
	const isSignalMetric = metric === "signals" || metric === "agentRuns";
	// The charted metric's accent, shared with its stat card.
	const accent = METRIC_APPEARANCE[metric].color;
	const series =
		data?.series.map((entry, index) => {
			// Series IDs follow ranking; use the breakdown's signal identity so
			// dates and filters cannot swap the semantic colors.
			const signalType =
				isSignalMetric && splitBy === signalDimension
					? data.breakdowns[signalDimension].find(
							(signal) => signal.label === entry.label,
						)?.id
					: isSignalMetric && splitBy === "none" && selectedSignals.length === 1
						? selectedSignals[0]
						: undefined;
			return {
				...entry,
				label:
					splitBy === "none" ? metricLabel : costLabel(splitBy, entry.label),
				color:
					(metric === "ciRuns" && splitBy === "ciConclusions"
						? CI_COLORS[
								data.breakdowns.ciConclusions.find(
									(conclusion) => conclusion.label === entry.label,
								)?.id ?? ""
							]
						: undefined) ??
					(signalType ? SIGNAL_COLORS[signalType] : undefined) ??
					(splitBy === "none"
						? accent
						: SERIES_COLORS[index % SERIES_COLORS.length]),
			};
		}) ?? [];
	const primaryColor = series[0]?.color ?? accent;
	if (wasPending !== loading) {
		setWasPending(loading);
		setPhase(
			loading
				? "loading"
				: series.length > 0 && trend.length > 1 && !prefersReducedMotion()
					? "prime"
					: "idle",
		);
	}
	const heartbeat = phase === "loading" || phase === "prime";
	const seriesIdKey = series.map((entry) => entry.id).join("\u0000");
	const perRun = perRunChart ? frustration : undefined;
	const seriesValues = useMemo(
		() =>
			sampled
				? [sampleLevels(trend.length).map((level) => level * 10)]
				: perRun
					? [
							trend.map((point) => {
								if (point.startDate > today) return null;
								const at = perRun.dates.indexOf(point.date);
								return at < 0 ? 0 : (perRun.swears[at] ?? 0);
							}),
						]
					: seriesIdKey
							.split("\u0000")
							.filter(Boolean)
							.map((id) =>
								trend.map((point) =>
									getChartSeriesValue(
										point,
										id,
										today,
										"sum",
										availableFrom,
										ciHistoryAvailable,
									),
								),
							),
		[
			availableFrom,
			ciHistoryAvailable,
			perRun,
			sampled,
			seriesIdKey,
			today,
			trend,
		],
	);
	const idleRows = useMemo(
		() =>
			trend.map((point, index) => {
				const row: Record<string, unknown> = { ...point, x: index };
				seriesValues.forEach((values, series) => {
					row[seriesKey(series)] = values[index] ?? null;
				});
				return row;
			}),
		[seriesValues, trend],
	);
	const rows: readonly Record<string, unknown>[] = heartbeat
		? LOADING_ROWS
		: idleRows;
	const xDomain: [number, number] = heartbeat
		? [0, 1]
		: trend.length > 1
			? [0, trend.length - 1]
			: [-1, 1];
	const endMorph = useCallback(() => {
		setPhase((current) => (current === "morph" ? "idle" : current));
		setLinesEntering(true);
	}, []);
	// Prime keeps the heartbeat flowing after the data lands, until the
	// browser is idle: the data arriving brings a burst of main-thread work
	// (and the stat cards' data with it), and Recharts' time-based animation
	// would play out unseen behind it. The flow itself runs on the compositor.
	useEffect(() => {
		if (phase !== "prime") return;
		const start = () => {
			// The heartbeat exactly as drawn: where the morph starts from.
			heartbeatShapeRef.current = canvasRef.current
				? readAreaShape(canvasRef.current)
				: null;
			setPhase((current) => (current === "prime" ? "morph" : current));
		};
		if (typeof window.requestIdleCallback === "function") {
			const handle = window.requestIdleCallback(start, { timeout: 1200 });
			return () => window.cancelIdleCallback(handle);
		}
		const timer = setTimeout(start, 120);
		return () => clearTimeout(timer);
	}, [phase]);
	// The duration lines draw in once, after the morph.
	useEffect(() => {
		if (!linesEntering) return;
		const timer = setTimeout(() => setLinesEntering(false), 700);
		return () => clearTimeout(timer);
	}, [linesEntering]);
	// The morph: the areas animate from the recorded heartbeat while the
	// loading window, frozen where the flow had got to just before the first
	// morph frame is painted, opens to the full width in step.
	useLayoutEffect(() => {
		const flow = flowRef.current;
		const track = flowTrackRef.current;
		if (!flow || !track) return;
		if (phase !== "morph") {
			if (phase !== "prime") {
				flow.removeAttribute("style");
				track.removeAttribute("style");
			}
			return;
		}
		const canvas = canvasRef.current;
		const from = heartbeatShapeRef.current;
		if (!canvas || !from) {
			endMorph();
			return;
		}
		let width = 0;
		let fade = 0;
		let start = 0;
		return morphAreas(canvas, from, MORPH_MS, {
			onStart: () => {
				width = flow.offsetWidth;
				fade = width * FLOW_WINDOW * FLOW_FADE;
				start = flowOffset(flow, width);
				setMask(flow, {
					image: `linear-gradient(to right, transparent, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent)`,
					size: `${width * FLOW_WINDOW}px 100%`,
					position: `${start}px 0`,
				});
				flow.style.animation = "none";
				flow.style.transform = "none";
				track.style.animation = "none";
				track.style.transform = "none";
			},
			onFrame: (progress) => {
				if (!width) return;
				setMask(flow, {
					size: `${width * FLOW_WINDOW + (width + 2 * fade - width * FLOW_WINDOW) * progress}px 100%`,
					position: `${start + (-fade - start) * progress}px 0`,
				});
			},
			onDone: endMorph,
		});
	}, [endMorph, phase]);
	return (
		<HoverDateContext.Provider value={hoverStore}>
			<section
				className="cost-chart-panel"
				aria-label={
					metric === "ciRuns"
						? "CI runs with median and P95 duration over time"
						: metric === "agentRuns"
							? "Agent runs with median and P95 duration over time"
							: ciChart
								? "Merged pull requests and CI runs over time"
								: metric === "mergedPullRequests"
									? "Merged pull requests with CI failures per pull request over time"
									: `${metricLabel} over time`
				}
				aria-busy={pending}
			>
				<fieldset
					ref={metricsRef}
					className="cost-metrics"
					aria-label="Chart metric"
					aria-busy={metricsPending}
				>
					{usage ? (
						<Metric
							label="Usage"
							icon={IconBattery3Filled}
							outlineIcon={IconBattery3}
							color={USAGE_COLOR}
							value={held ? undefined : usage.value}
							qualifier={undefined}
							unavailable={false}
							trend={held ? undefined : usage.trend}
							dates={usage.dates}
							textAt={usage.textAt}
							chip={usage.chip}
							chipAt={usage.chipAt}
							step
							primary={usage.selected}
							onClick={usage.onSelect}
						/>
					) : null}
					{metrics.map((value) => {
						if (value === "ciRuns" && mergedGitHub) return null;
						const githubCard = value === "mergedPullRequests" && mergedGitHub;
						// With previews, each card reads its own request's answer: the
						// charted dashboard leaves the GitHub metrics out unless one of
						// them is charted.
						const source = previews ? previews[value] : dashboard;
						const total = getMetricTotal(source, value);
						const metricData = getMetricData(source, value);
						// Only once the dashboard has answered: before that the card loads.
						const unknownCi =
							value === "ciRuns" &&
							total !== undefined &&
							!isCiHistoryAvailable(
								metricData?.githubHistory,
								metricData?.trend.at(-1)?.date ?? "",
							);
						const rates =
							value === "signals" && !overrides?.has(value)
								? languageRates(
										previews?.languageSplit,
										getMetricData(
											previews ? previews.agentRuns : dashboard,
											"agentRuns",
										),
										interval,
									)
								: undefined;
						return (
							<Metric
								key={value}
								label={
									rates
										? "Frustrations"
										: githubCard
											? "PRs & CI"
											: METRIC_LABELS[value]
								}
								icon={METRIC_APPEARANCE[value].icon}
								outlineIcon={METRIC_APPEARANCE[value].outline}
								color={METRIC_APPEARANCE[value].color}
								value={
									held || overridesLoading
										? undefined
										: rates
											? formatPerRun(rates.total.swears, true)
											: (overrides?.get(value) ??
												(total === undefined
													? undefined
													: total === null || unknownCi
														? "—"
														: formatMetricRatio(
																total,
																value,
																metricData?.denominator,
															)))
								}
								unavailable={
									!held &&
									!overrides?.has(value) &&
									(total === null || unknownCi)
								}
								qualifier={
									metricData?.githubHistory?.preview ? "preview" : undefined
								}
								primary={
									!usage?.selected &&
									(selectedMetric === value ||
										(githubCard && selectedMetric === "ciRuns"))
								}
								disabled={empty?.has(value) ?? false}
								metricKey={value}
								expanded={expanded === value}
								onToggleExpand={
									selectedMetric === value && deepView
										? () => setExpanded(expanded === value ? null : value)
										: undefined
								}
								trend={
									held
										? undefined
										: rates
											? rates.swears
											: sparklineTotals(
													previews || value === metric
														? metricData?.trend
														: undefined,
													interval,
												)
								}
								dates={
									rates
										? rates.dates
										: sparklineDates(
												previews || value === metric
													? metricData?.trend
													: undefined,
												interval,
											)
								}
								textAt={
									rates
										? (at: number) => formatPerRun(rates.swears[at] ?? 0, true)
										: undefined
								}
								format={
									overrides?.has(value)
										? undefined
										: (amount: number) => formatMetric(amount, value)
								}
								ring={githubCard ? ciRingAt : undefined}
								onClick={() => onMetricChange(value)}
								onIntent={
									onMetricIntent ? () => onMetricIntent(value) : undefined
								}
							/>
						);
					})}
					{expanded && deepView ? (
						<MetricSheet
							color={METRIC_APPEARANCE[expanded].color}
							container={metricsRef}
							interval={interval}
							split={
								filtered
									? null
									: expanded === "signals"
										? previews?.languageSplit
										: deepSplit
							}
							metric={expanded}
							view={deepView}
							onClose={collapse}
						/>
					) : null}
				</fieldset>
				{usage?.selected ? usage.chart(showDots, pending) : null}
				<div
					className="cost-chart-card"
					style={usage?.selected ? { display: "none" } : undefined}
				>
					<div className="cost-chart-key" data-fluid-menu-root="">
						<FluidMenuHover items=".cost-text-button" />
						<div className="cost-chart-key-copy">
							<h2 className="cost-chart-title">
								{ciChart ? "PRs & CI" : metricLabel} over time
							</h2>
							<div className="cost-chart-legend">
								{pending && series.length === 0 ? (
									<Skeleton
										className="h-3 rounded-[4px]"
										style={{ width: metricLabel.length * TICK_CHAR_PX + 14 }}
									/>
								) : null}
								{ciChart && ciRange ? (
									<>
										<div className="cost-legend-item">
											<i data-ci="runs" />
											CI runs
										</div>
										<div className="cost-legend-item">
											<i data-ci="failed" />
											Failed{" "}
											<strong>
												{ciRange.runs === 0
													? "—"
													: `${Math.round((ciRange.failed / ciRange.runs) * 100)}%`}
											</strong>
										</div>
										<div className="cost-legend-item">
											<i style={{ backgroundColor: PULL_REQUEST_COLOR }} />
											Merged PRs
										</div>
									</>
								) : null}
								{(ciChart ? [] : series).map((entry) => (
									<div key={entry.id} className="cost-legend-item">
										<i style={{ backgroundColor: entry.color }} />
										{entry.label}
									</div>
								))}
								{sampled ? null : metric === "agentRuns" ||
									metric === "ciRuns" ? (
									<>
										<button
											type="button"
											className="cost-legend-item cost-duration-legend"
											data-percentile="median"
											aria-label="Median duration"
											title={
												metric === "ciRuns"
													? "Duration from run start to its last update."
													: undefined
											}
											aria-pressed={showMedian}
											onClick={() => setShowMedian((visible) => !visible)}
										>
											<i aria-hidden="true" />
											Median{" "}
											<strong>
												{formatRunDuration(durationStats?.medianSeconds)}
											</strong>
										</button>
										<button
											type="button"
											className="cost-legend-item cost-duration-legend"
											data-percentile="p95"
											aria-label="P95 duration"
											title={
												metric === "ciRuns"
													? "Duration from run start to its last update."
													: undefined
											}
											aria-pressed={showP95}
											onClick={() => setShowP95((visible) => !visible)}
										>
											<i aria-hidden="true" />
											P95{" "}
											<strong>
												{formatRunDuration(durationStats?.p95Seconds)}
											</strong>
										</button>
									</>
								) : metric === "mergedPullRequests" && !ciChart ? (
									<button
										type="button"
										className="cost-legend-item cost-duration-legend"
										data-percentile="p95"
										aria-label="CI failures per PR"
										title="Failed CI attempts per merged PR, counting only PRs whose CI history is available. Re-runs count. Grouped by merge date (UTC)."
										aria-pressed={showCiFailures}
										onClick={() => setShowCiFailures((visible) => !visible)}
									>
										<i aria-hidden="true" />
										CI failures / PR{" "}
										<strong>
											{dashboard === undefined
												? "…"
												: ciData == null
													? "—"
													: formatMetricRatio(
															ciData.total,
															"ciFailuresPerPullRequest",
															ciData.denominator,
														)}
										</strong>
									</button>
								) : null}
							</div>
							{history && !sampled && !ciChart ? (
								<GitHubHistoryNotes
									history={history}
									metric={metric}
									startDate={data?.trend[0]?.date ?? ""}
									settingsUrl={
										workspace?.meta.isOrgAdmin && workspace.state.activeOrg
											? `/${workspace.state.activeOrg.slug}/settings/workspace`
											: undefined
									}
								/>
							) : null}
							{!sampled &&
							!ciChart &&
							metric === "mergedPullRequests" &&
							data?.cycleTimeStats ? (
								<output
									className="cost-chart-coverage"
									aria-label="PR cycle time"
								>
									<span title="Time from pull request creation to merge.">
										PR cycle time · Median{" "}
										{formatRunDuration(data.cycleTimeStats.medianSeconds)} · P90{" "}
										{formatRunDuration(data.cycleTimeStats.p90Seconds)}
									</span>
								</output>
							) : null}
							{!sampled && metric === "ciRuns" && data?.ciMinutes ? (
								<output className="cost-chart-coverage">
									<span title="Sum of completed run durations; billing multipliers are not included.">
										CI minutes (approximate billed Actions minutes):{" "}
										{!ciHistoryAvailable
											? "—"
											: new Intl.NumberFormat("en-US", {
													maximumFractionDigits: 1,
												}).format(data.ciMinutes.total)}
									</span>
								</output>
							) : null}
							{sampled && data !== null ? null : coverage &&
								data?.incomplete ? (
								<output className="cost-chart-coverage">
									<button
										type="button"
										className="cost-text-button cost-coverage-refresh"
										onClick={onRefresh}
										disabled={refreshing}
									>
										{refreshing ? "Refreshing…" : "Refresh"}
									</button>
								</output>
							) : unavailable ? (
								<output className="cost-chart-coverage">
									<span>{unavailableLabel}</span>
									<button
										type="button"
										className="cost-text-button cost-coverage-refresh"
										onClick={onRefresh}
										disabled={refreshing}
									>
										{refreshing ? "Refreshing…" : "Refresh"}
									</button>
								</output>
							) : null}
						</div>
						{/* The chart's split and filters, as removable tags. */}
						{splitBy !== "none" || filters ? (
							<div className="cost-chart-tags">
								{splitBy !== "none" ? (
									<span className="cost-chart-split">
										Split by
										<button
											type="button"
											className="cost-filter-chip"
											onClick={onResetSplit}
											title={`Split by ${COST_LABELS[splitBy]}`}
											aria-label={`Stop splitting by ${COST_LABELS[splitBy].toLowerCase()}`}
										>
											<span className="truncate">{COST_LABELS[splitBy]}</span>
											<IconX size={12} className="shrink-0" />
										</button>
									</span>
								) : null}
								{filters}
							</div>
						) : null}
						{mergedGitHub &&
						!ciChart &&
						(selectedMetric === "mergedPullRequests" ||
							selectedMetric === "ciRuns") ? (
							<fieldset
								className="cost-chart-kind"
								aria-label="Pull requests or CI runs"
							>
								{(["mergedPullRequests", "ciRuns"] as const).map((value) => (
									<button
										key={value}
										type="button"
										aria-pressed={selectedMetric === value}
										onClick={() => onMetricChange(value)}
										onPointerEnter={
											onMetricIntent ? () => onMetricIntent(value) : undefined
										}
									>
										{METRIC_LABELS[value]}
									</button>
								))}
							</fieldset>
						) : null}
						{dots === "switch" ? (
							<fieldset className="cost-chart-kind" aria-label="Chart style">
								{(["line", "dots"] as const).map((value) => (
									<button
										key={value}
										type="button"
										aria-pressed={kind === value}
										onClick={() => setKind(value)}
									>
										{value === "line" ? "Line" : "Dots"}
									</button>
								))}
							</fieldset>
						) : null}
					</div>
					<div
						ref={canvasRef}
						skullet-ignore=""
						className="cost-chart-canvas"
						data-phase={phase}
						data-kind={showDots ? "dots" : undefined}
						data-sample={sampled && !heartbeat ? "" : undefined}
						data-lines-entering={linesEntering || undefined}
						data-ci-chart={ciChart || undefined}
					>
						{ciChart && ciDays && phase === "idle" ? (
							<CiChart days={ciDays} interval={interval} />
						) : null}
						{showDots ? (
							<CostDotChart
								color={primaryColor}
								fit={dots === "only"}
								shown={!usage?.selected}
								format={
									frustration
										? formatPerRun
										: (value) => formatMetric(value, metric)
								}
								interval={interval}
								label={frustration ? "" : metricLabel}
								loading={loadingDots !== null}
								points={loadingDots ?? (sampled ? sampleDots : dotPoints)}
							/>
						) : null}
						{demo && data ? (
							<DemoTrendPreview
								trend={trend}
								color={primaryColor}
								metric={metric}
								interval={interval}
							/>
						) : null}
						{phase === "idle" ? null : (
							<ChartSkeleton
								interval={interval}
								label={`Loading ${metricLabel.toLowerCase()}`}
								leaving={phase !== "loading"}
							/>
						)}
						<div className="cost-chart-flow" ref={flowRef}>
							<div className="cost-chart-flow-track" ref={flowTrackRef}>
								<ResponsiveContainer width="100%" height="100%" minWidth={0}>
									<ComposedChart
										data={rows}
										margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
										accessibilityLayer
										onMouseMove={(state) => {
											axisHover.onMouseMove(state);
											const point = state.isTooltipActive
												? trend[Number(state.activeTooltipIndex)]
												: undefined;
											hoverStore.set(point?.date ?? null);
										}}
										onMouseLeave={() => {
											axisHover.onMouseLeave();
											hoverStore.set(null);
										}}
									>
										<defs>
											<linearGradient
												id={gradientId}
												className="cost-chart-gradient"
												x1="0"
												y1="0"
												x2="0"
												y2="1"
											>
												{/* The heartbeat's fill while loading, easing into the chart's
										    (or into nothing when several series share the chart). */}
												<stop
													offset="0%"
													style={{
														stopColor: heartbeat ? accent : primaryColor,
														stopOpacity: heartbeat
															? 0.16
															: series.length === 1
																? "var(--cost-chart-fill-opacity)"
																: 0,
													}}
												/>
												<stop
													offset="100%"
													style={{
														stopColor: heartbeat ? accent : primaryColor,
														stopOpacity: heartbeat ? 0.015 : 0,
													}}
												/>
											</linearGradient>
										</defs>
										{heartbeat ? null : (
											<CartesianGrid
												yAxisId="count"
												vertical={false}
												stroke="var(--cost-border)"
												strokeDasharray="3 4"
											/>
										)}
										<XAxis
											type="number"
											dataKey="x"
											domain={xDomain}
											ticks={
												heartbeat
													? []
													: edgeTicks(trend.length, axisHover.hover)
											}
											interval={0}
											allowDecimals={false}
											axisLine={false}
											tickLine={false}
											tickMargin={14}
											height={40}
											tick={
												heartbeat
													? false
													: (props: XAxisTickContentProps) => (
															<EdgeTick
																tick={props}
																count={trend.length}
																hover={axisHover.hover}
																label={(index) =>
																	formatChartDate(
																		trend[index]?.date ?? "",
																		interval,
																	)
																}
															/>
														)
											}
										/>
										<YAxis
											yAxisId="count"
											tickFormatter={(value) =>
												perRun
													? perRunTick(Number(value))
													: formatChartValueTick(Number(value), metric)
											}
											domain={heartbeat ? HEARTBEAT_DOMAIN : [0, "auto"]}
											axisLine={false}
											tickLine={false}
											tickCount={4}
											allowDecimals={metric === "cost" || perRun !== undefined}
											tickMargin={10}
											width={56}
											tick={
												heartbeat
													? false
													: { fill: "var(--cost-muted)", fontSize: 11 }
											}
										/>
										{metric === "agentRuns" || metric === "ciRuns" ? (
											<YAxis
												yAxisId="duration"
												hide={sampled || (!showMedian && !showP95)}
												orientation="right"
												tickFormatter={(value) =>
													formatRunDuration(Number(value))
												}
												domain={[0, "auto"]}
												axisLine={false}
												tickLine={false}
												tickCount={4}
												tickMargin={10}
												width={68}
												tick={
													phase === "idle" && durationStats?.sampleCount
														? { fill: "var(--cost-muted)", fontSize: 11 }
														: false
												}
											/>
										) : metric === "mergedPullRequests" ? (
											<YAxis
												yAxisId="ci"
												hide={sampled || !showCiFailures || ciData === null}
												orientation="right"
												tickFormatter={(value) =>
													formatMetricRatio(
														Number(value),
														"ciFailuresPerPullRequest",
														1,
													)
												}
												domain={[0, "auto"]}
												axisLine={false}
												tickLine={false}
												tickCount={4}
												tickMargin={10}
												width={56}
												tick={
													phase === "idle"
														? { fill: "var(--cost-muted)", fontSize: 11 }
														: false
												}
											/>
										) : null}
										<Tooltip
											active={phase === "idle" ? undefined : false}
											// Follows the pointer across, but holds one height near the
											// top of the plot instead of tracking the pointer's height.
											position={{ y: 48 }}
											// Appear in place rather than slide in from the last spot.
											isAnimationActive={false}
											cursor={{
												stroke: "var(--cost-muted)",
												strokeDasharray: "3 4",
											}}
											content={({ active, payload, label }) => {
												const point = trend[Number(label)];
												return active &&
													payload?.length &&
													(metric === "mergedPullRequests" ||
														metric === "ciRuns") ? (
													<div className="cost-chart-tooltip">
														{payload.map((item) => (
															<div key={String(item.name)}>
																<span>
																	<i style={{ backgroundColor: item.color }} />
																	{item.name}
																</span>
																<strong>
																	{item.dataKey === "medianSeconds" ||
																	item.dataKey === "p95Seconds"
																		? formatRunDuration(Number(item.value))
																		: perRun
																			? formatPerRun(Number(item.value))
																			: item.dataKey === "ciFailureRatio"
																				? formatMetricRatio(
																						Number(item.value),
																						"ciFailuresPerPullRequest",
																						point?.ciFailureDenominator,
																					)
																				: formatMetricRatio(
																						Number(item.value),
																						metric,
																						point?.denominator,
																					)}
																</strong>
															</div>
														))}
														{availableFrom &&
														point &&
														point.startDate < availableFrom &&
														point.endDate >= availableFrom ? (
															<p>
																CI history from {historyDate(availableFrom)}
															</p>
														) : null}
														{point?.cycleMedianSeconds !== undefined ? (
															<p>
																PR cycle time · Median{" "}
																{formatRunDuration(point.cycleMedianSeconds)} ·
																P90 {formatRunDuration(point.cycleP90Seconds)}
															</p>
														) : null}
														{point?.ciMinutes !== undefined ? (
															<p>
																{point.ciMinutes.toFixed(1)} CI minutes
																(approximate billed Actions minutes)
															</p>
														) : null}
													</div>
												) : null;
											}}
										/>
										{(heartbeat || sampled ? [null] : series).map(
											(entry, index) => (
												<Area
													yAxisId="count"
													// By position: the heartbeat and the series it becomes are
													// one Area, whose paths the morph animates.
													key={seriesKey(index)}
													dataKey={seriesKey(index)}
													name={entry?.label ?? metricLabel}
													type="linear"
													stroke={heartbeat ? accent : (entry?.color ?? accent)}
													strokeWidth={2}
													strokeLinecap="round"
													strokeLinejoin="round"
													fill={
														index === 0 &&
														(sampled || series.length === 1 || phase !== "idle")
															? `url(#${gradientId})`
															: "transparent"
													}
													baseValue={heartbeat ? HEARTBEAT_BASE_VALUE : 0}
													dot={
														phase === "idle" && visiblePointCount === 1
															? { r: 3 }
															: false
													}
													activeDot={{
														r: 4,
														stroke: "var(--cost-surface)",
														strokeWidth: 2,
													}}
													isAnimationActive={false}
												/>
											),
										)}
										{phase !== "idle" ? null : metric === "agentRuns" ||
											metric === "ciRuns" ? (
											<>
												<Line
													yAxisId="duration"
													hide={!showMedian}
													dataKey="medianSeconds"
													name="Median duration"
													type="linear"
													stroke="var(--cost-foreground)"
													strokeWidth={2}
													dot={{
														r: 2,
														strokeWidth: 0,
														fill: "var(--cost-foreground)",
													}}
													activeDot={{
														r: 4,
														stroke: "var(--cost-surface)",
														strokeWidth: 2,
													}}
													connectNulls={false}
													isAnimationActive={false}
												/>
												<Line
													yAxisId="duration"
													hide={!showP95}
													dataKey="p95Seconds"
													name="P95 duration"
													type="linear"
													stroke="var(--cost-duration-p95)"
													strokeWidth={2}
													strokeDasharray="6 4"
													dot={{
														r: 2,
														strokeWidth: 0,
														fill: "var(--cost-duration-p95)",
													}}
													activeDot={{
														r: 4,
														stroke: "var(--cost-surface)",
														strokeWidth: 2,
													}}
													connectNulls={false}
													isAnimationActive={false}
												/>
											</>
										) : metric === "mergedPullRequests" ? (
											<Line
												yAxisId="ci"
												hide={sampled || !showCiFailures || ciData === null}
												dataKey="ciFailureRatio"
												name="CI failures / PR"
												type="linear"
												stroke="var(--cost-duration-p95)"
												strokeWidth={2}
												strokeDasharray="6 4"
												dot={{
													r: 2,
													strokeWidth: 0,
													fill: "var(--cost-duration-p95)",
												}}
												activeDot={{
													r: 4,
													stroke: "var(--cost-surface)",
													strokeWidth: 2,
												}}
												connectNulls={false}
												isAnimationActive={false}
											/>
										) : null}
									</ComposedChart>
								</ResponsiveContainer>
							</div>
						</div>
						{!heartbeat && sampled ? (
							<ChartEmptyNotice
								title={
									noHistory
										? "No GitHub history for these dates"
										: unavailable
											? unavailableLabel
											: metric === "agentRuns" &&
													((coverage?.indexingSessions ?? 0) > 0 ||
														(coverage?.unavailableSessions ?? 0) > 0)
												? "No indexed agent runs match yet"
												: metric === "mergedPullRequests"
													? "No merged pull requests"
													: metric === "ciRuns"
														? "No CI runs"
														: `No ${metric === "cost" ? "usage" : metricLabel.toLowerCase()}`
								}
							/>
						) : null}
					</div>
				</div>
			</section>
		</HoverDateContext.Provider>
	);
}
function historyDate(value: string | null | undefined) {
	return value
		? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "UTC",
			})
		: "unavailable";
}
export function GitHubHistoryNotes({
	history,
	metric,
	startDate,
	settingsUrl,
}: {
	history: NonNullable<
		NonNullable<CostDashboard["metrics"]["ciRuns"]>["githubHistory"]
	>;
	metric: DashboardMetric;
	startDate: string;
	settingsUrl?: string;
}) {
	return (
		<output className="cost-chart-coverage" aria-live="polite">
			{history.preview ? (
				<span>
					Preview: GitHub history is still syncing, so totals may be incomplete.
				</span>
			) : null}
			{history.pullRequestsFrom && startDate < history.pullRequestsFrom ? (
				<span>PR history from {historyDate(history.pullRequestsFrom)}</span>
			) : null}
			{history.ciUnavailablePullRequests > 0 ||
			(metric === "ciRuns" && history.ciFrom && startDate < history.ciFrom) ? (
				<InfoTooltip>
					<TooltipTrigger className="cost-text-button">
						CI history{" "}
						{history.ciFrom
							? `from ${historyDate(history.ciFrom)}`
							: "unavailable"}
						{history.ciUnavailablePullRequests > 0
							? ` · ${history.ciUnavailablePullRequests} ${history.ciUnavailablePullRequests === 1 ? "PR" : "PRs"} excluded`
							: ""}
					</TooltipTrigger>
					<TooltipContent>{GITHUB_RETENTION_TOOLTIP}</TooltipContent>
				</InfoTooltip>
			) : null}
			{history.syncingRepositories > 0 ? (
				<span>
					{history.syncingRepositories}{" "}
					{history.syncingRepositories === 1
						? "repository is"
						: "repositories are"}{" "}
					still syncing and{" "}
					{history.syncingRepositories === 1 ? "isn't" : "aren't"} included yet.
				</span>
			) : null}
			{history.unavailableRepositories > 0 ? (
				<span>
					{history.unavailableRepositories}{" "}
					{history.unavailableRepositories === 1
						? "repository couldn't"
						: "repositories couldn't"}{" "}
					be read from GitHub.
					{settingsUrl ? (
						<>
							{" "}
							<a href={settingsUrl}>Check GitHub access</a>
						</>
					) : null}
				</span>
			) : null}
			{history.lastSyncedAt &&
			Date.now() - Date.parse(history.lastSyncedAt) > 48 * 3600000 ? (
				<span>Last synced with GitHub {historyDate(history.lastSyncedAt)}</span>
			) : null}
		</output>
	);
}
function Metric({
	label,
	icon: FilledIcon,
	outlineIcon: OutlineIcon,
	color,
	value,
	qualifier,
	primary = false,
	disabled = false,
	metricKey,
	expanded = false,
	onToggleExpand,
	unavailable,
	trend,
	secondary,
	dates,
	format,
	textAt,
	chip,
	chipAt,
	ring,
	step = false,
	onClick,
	onIntent,
}: {
	label: string;
	icon: Icon;
	outlineIcon: Icon;
	/** The card's accent: its glyph and sparkline. */
	color: string;
	value: string | undefined;
	qualifier: string | undefined;
	primary?: boolean;
	disabled?: boolean;
	metricKey?: DashboardMetric;
	expanded?: boolean;
	onToggleExpand?: () => void;
	unavailable: boolean;
	/** Per-period totals for the card's sparkline; undefined while loading. */
	trend: number[] | undefined;
	secondary?: number[];
	dates?: string[];
	format?: (value: number) => string;
	textAt?: (index: number) => string;
	chip?: string;
	chipAt?: (index: number) => string;
	ring?: (date: string | null) => CiTotals | undefined;
	step?: boolean;
	onClick: () => void;
	onIntent?: () => void;
}) {
	// Like the big chart: when the trend lands, the card's loading wave morphs
	// into its sparkline instead of the two swapping.
	const loading = !unavailable && trend === undefined;
	const MetricIcon = primary ? FilledIcon : OutlineIcon;
	const markedDate = useMarkedDate();
	const pinnedDate = useDotPick()?.picked?.date ?? null;
	const focusDate = useContext(DotFocusContext);
	const focusDays = useContext(DotFocusDaysContext);
	const focusIndexes = useMemo(() => {
		if (!dates || dates[0] === undefined) return NO_FOCUS;
		const first = dates[0];
		const bucketOf = (day: string) =>
			day >= first ? dates.filter((date) => date <= day).length - 1 : -1;
		const days = focusDate ? [focusDate] : focusDays ? [...focusDays] : [];
		const indexes = new Set(days.map(bucketOf).filter((index) => index >= 0));
		return indexes.size > 0 ? [...indexes].sort((a, b) => a - b) : NO_FOCUS;
	}, [dates, focusDate, focusDays]);
	const markedIndex = markedDate && dates ? dates.indexOf(markedDate) : -1;
	const pinnedIndex = pinnedDate && dates ? dates.indexOf(pinnedDate) : -1;
	const markedValue = markedIndex >= 0 ? trend?.[markedIndex] : undefined;
	const shown =
		markedIndex >= 0 && textAt
			? textAt(markedIndex)
			: markedValue !== undefined && format
				? format(markedValue)
				: value;
	const shownChip = markedIndex >= 0 && chipAt ? chipAt(markedIndex) : chip;
	const ringTotals = ring?.(markedIndex >= 0 ? markedDate : null);
	const [roll, setRoll] = useState({ at: markedIndex, direction: 1 as 1 | -1 });
	if (roll.at !== markedIndex)
		setRoll({ at: markedIndex, direction: markedIndex >= roll.at ? 1 : -1 });
	const [wasLoading, setWasLoading] = useState(loading);
	const [revealing, setRevealing] = useState(false);
	if (wasLoading !== loading) {
		setWasLoading(loading);
		setRevealing(!loading && !unavailable);
	}
	return (
		<div
			className="cost-metric"
			data-metric={metricKey}
			data-expanded={expanded || undefined}
			data-primary={primary}
			data-disabled={disabled || undefined}
			data-unavailable={unavailable}
			data-revealing={revealing || undefined}
			style={{ "--metric-color": color } as CSSProperties}
		>
			{introRequested() ? (
				<span aria-hidden="true" className="cost-metric-intro-anchor" />
			) : null}
			{/* StatCard: glyph + label on the left, value on the right,
			    the sparkline flush with the card's bottom edge. */}
			<div className="cost-metric-header">
				<div className="cost-metric-label">
					<MetricIcon className="cost-metric-icon" aria-hidden="true" />
					<button
						type="button"
						className="cost-metric-select"
						aria-pressed={primary}
						aria-label={label}
						disabled={disabled}
						onClick={onClick}
						onPointerEnter={onIntent}
						onFocus={onIntent}
					>
						{label}
					</button>
				</div>
				{value === undefined ? (
					<Skeleton className="cost-metric-skeleton rounded-[4px]" />
				) : (
					<span className="cost-metric-value">
						{qualifier ? (
							<small className="cost-metric-qualifier">{qualifier}</small>
						) : null}
						{unavailable || shown === undefined ? (
							value
						) : (
							<RollingText text={shown} direction={roll.direction} />
						)}
						{ringTotals && !unavailable ? <CiRing totals={ringTotals} /> : null}
						{shownChip && !unavailable ? (
							<span className="cost-metric-chip">
								<RollingText text={shownChip} direction={roll.direction} />
							</span>
						) : null}
					</span>
				)}
			</div>
			{loading || revealing ? (
				// Loading: the big chart's own loading wave, drawn like the card's
				// sparkline (see .cost-metric-wave).
				<ChartLoadingWave
					className="cost-metric-sparkline cost-metric-wave"
					viewBoxHeight={LOADING_WAVE_HEIGHT}
					color={color}
					linePath={step ? DASHBOARD_LOADING_STEPS : DASHBOARD_LOADING_LINE}
					strokeWidth={1.2}
					guides={false}
				/>
			) : null}
			{unavailable || loading ? null : (
				<MetricSparkline
					values={trend}
					step={step}
					secondary={secondary}
					marked={markedIndex}
					pinned={pinnedIndex}
					focus={focusIndexes}
				/>
			)}
			{onToggleExpand ? (
				<ExpandButton expanded={expanded} onToggle={onToggleExpand} />
			) : null}
			{revealing ? (
				<ChartMorph
					wave=".cost-metric-wave"
					lines="[data-sparkline-line]"
					fill="[data-sparkline-fill]"
					onDone={() => setRevealing(false)}
				/>
			) : null}
		</div>
	);
}

// The card's trend in the chart's interval, so the sparklines follow the
// Daily/Weekly/Monthly picker like the big chart does.
function sparklineDates(
	trend: DashboardMetricData["trend"] | undefined,
	interval: ChartInterval,
): string[] | undefined {
	return trend && groupChartTrend(trend, interval).map((point) => point.date);
}

function sparklineTotals(
	trend: DashboardMetricData["trend"] | undefined,
	interval: ChartInterval,
): number[] | undefined {
	return trend && groupChartTrend(trend, interval).map((point) => point.total);
}

// Stat card sparkline (CardSparkline), in the card's accent: a
// soft gradient area under a hairline. A trend with fewer than two points
// shows a faint sample curve, so the card reads as "trend goes here".
const NO_FOCUS: readonly number[] = [];

const SAMPLE_SPARKLINE = [0.3, 0.45, 0.38, 0.55, 0.48, 0.66, 0.58, 0.75];

export function MetricSparkline({
	values,
	step = false,
	secondary,
	marked = -1,
	pinned = -1,
	focus = NO_FOCUS,
}: {
	values: number[] | undefined;
	step?: boolean;
	secondary?: number[];
	marked?: number;
	pinned?: number;
	focus?: readonly number[];
}) {
	const gradientId = useId().replace(/[^\w-]/g, "");
	const points = values?.filter((value) => Number.isFinite(value)) ?? [];
	const placeholder = points.length < 2;
	const second =
		!placeholder &&
		secondary?.length === points.length &&
		secondary.every((value) => Number.isFinite(value))
			? secondary
			: undefined;
	const peak = Math.max(...points, ...(second ?? []), 0) || 1;
	const series = placeholder
		? SAMPLE_SPARKLINE
		: points.map((value) => value / peak);
	// CardSparkline insets: 3 units of headroom, 2 for the sample.
	const inset = placeholder ? 2 : 3;
	const flat = step && !placeholder;
	const xAt = (index: number, count: number) =>
		flat ? ((index + 0.5) / count) * 100 : (index / (count - 1)) * 100;
	const pathOf = (line: number[]) =>
		flat
			? line
					.map((value, index) => {
						const from = ((index / line.length) * 100).toFixed(2);
						const to = (((index + 1) / line.length) * 100).toFixed(2);
						const y = (32 - inset - value * (32 - inset)).toFixed(2);
						return `${index === 0 ? "M" : "L"}${from} ${y} L${to} ${y}`;
					})
					.join(" ")
			: line
					.map((value, index) => {
						const x = (index / (line.length - 1)) * 100;
						const y = 32 - inset - value * (32 - inset);
						return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
					})
					.join(" ");
	const path = pathOf(series);
	return (
		<svg
			aria-hidden="true"
			skullet-own=""
			className="cost-metric-sparkline cost-metric-trend"
			data-placeholder={placeholder || undefined}
			viewBox="0 0 100 32"
			preserveAspectRatio="none"
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
					<stop
						offset="0%"
						stopColor="currentColor"
						stopOpacity={placeholder ? 0.03 : 0.4}
					/>
					<stop
						offset="100%"
						stopColor="currentColor"
						stopOpacity={placeholder ? 0 : 0.1}
					/>
				</linearGradient>
			</defs>
			<path
				data-sparkline-fill=""
				d={`${path} L100 32 L0 32 Z`}
				fill={`url(#${gradientId})`}
			/>
			{second ? (
				<path
					d={pathOf(second.map((value) => value / peak))}
					fill="none"
					className="cost-metric-trend-line cost-metric-trend-secondary"
					strokeWidth={1.2}
					strokeLinecap="round"
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
			<path
				data-sparkline-line=""
				d={path}
				fill="none"
				className="cost-metric-trend-line"
				strokeWidth={1.2}
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
			{!placeholder && points.length === values?.length
				? [
						{ at: pinned, tone: "pinned" },
						{ at: marked === pinned ? -1 : marked, tone: "hover" },
					]
						.filter((mark) => mark.at >= 0)
						.map((mark) => (
							<line
								key={mark.tone}
								className="cost-metric-marker"
								data-tone={mark.tone}
								x1={xAt(mark.at, series.length)}
								x2={xAt(mark.at, series.length)}
								y1={0}
								y2={32}
								vectorEffect="non-scaling-stroke"
							/>
						))
				: null}
			{!placeholder && points.length === values?.length
				? focus
						.filter((at) => at < series.length)
						.map((at) => (
							<line
								key={at}
								className="cost-metric-focus"
								x1={xAt(at, series.length)}
								x2={xAt(at, series.length)}
								y1={32 - inset - (series[at] ?? 0) * (32 - inset)}
								y2={32 - inset - (series[at] ?? 0) * (32 - inset)}
								strokeLinecap="round"
								vectorEffect="non-scaling-stroke"
							/>
						))
				: null}
		</svg>
	);
}

const TICK_GAP_PX = 65;
const TICK_CHAR_PX = 6;

function useChartDateTicks(interval: ChartInterval) {
	const range = useOptionalDateRange();
	const [width, setWidth] = useState(0);
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setWidth(element.offsetWidth));
		observer.observe(element);
		setWidth(element.offsetWidth);
		return () => observer.disconnect();
	}, []);
	const ticks = useMemo(() => {
		if (!range || width === 0) return [];
		const today = formatIsoDate(new Date());
		const labels = chartPeriodDates(
			range.state.startDate,
			range.state.endDate,
			interval,
		)
			.filter((date) => date <= today)
			.map((date) => formatChartDate(date, interval));
		const step = labels.length > 1 ? width / (labels.length - 1) : 0;
		const kept: { label: string; left: number }[] = [];
		for (let index = labels.length - 1; index >= 0; index--) {
			const label = labels[index] ?? "";
			const left = labels.length > 1 ? index * step : width / 2;
			const half = (label.length * TICK_CHAR_PX) / 2;
			const previous = kept.at(-1);
			if (
				previous &&
				previous.left -
					(previous.label.length * TICK_CHAR_PX) / 2 -
					(left + half) <
					TICK_GAP_PX
			)
				continue;
			kept.push({ label, left });
		}
		return kept.reverse();
	}, [interval, range, width]);
	return { ref, ticks };
}

export function ChartSkeleton({
	interval,
	label,
	leaving,
}: {
	interval: ChartInterval;
	label: string;
	/** Data has landed: the placeholder axes fade as the real ones arrive. */
	leaving: boolean;
}) {
	const dates = useChartDateTicks(interval);
	return (
		<output
			className="cost-chart-skeleton"
			aria-label={leaving ? undefined : label}
			aria-hidden={leaving || undefined}
			data-leaving={leaving || undefined}
		>
			<svg
				className="cost-chart-loading-guides"
				aria-hidden="true"
				preserveAspectRatio="none"
				viewBox={`0 0 1000 ${LOADING_WAVE_HEIGHT}`}
			>
				{[16, 27, 39].map((y) => (
					<path
						key={y}
						d={`M 10 ${y} H 990`}
						vectorEffect="non-scaling-stroke"
					/>
				))}
			</svg>
			<div className="cost-chart-loading-axis" aria-hidden="true">
				{[0, 1, 2, 3].map((index) => (
					<Skeleton key={index} />
				))}
			</div>
			<div
				ref={dates.ref}
				className="cost-chart-loading-dates"
				aria-hidden="true"
			>
				{dates.ticks.map((tick) => (
					<Skeleton
						key={tick.label}
						style={{
							left: tick.left,
							position: "absolute",
							transform: "translateX(-50%)",
							width: tick.label.length * TICK_CHAR_PX,
						}}
					/>
				))}
			</div>
		</output>
	);
}

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Where the loading window is right now, in pixels. Worked out from the flow
 * animation's start and the clock rather than read back as a computed style:
 * the compositor keeps moving it through a long task, while the main thread's
 * animation time stays where that task began.
 */
function flowOffset(flow: HTMLElement, width: number) {
	const animation =
		typeof flow.getAnimations === "function"
			? flow
					.getAnimations()
					.find(
						(entry) =>
							entry instanceof CSSAnimation &&
							entry.animationName === "cost-chart-flow-window",
					)
			: undefined;
	const start = animation?.startTime;
	if (typeof start !== "number") {
		const values = getComputedStyle(flow)
			.transform.match(/^matrix\((.+)\)$/)?.[1]
			?.split(",");
		return Number.parseFloat(values?.[4] ?? "0") || 0;
	}
	const progress =
		((performance.now() - start) % FLOW_CYCLE_MS) / FLOW_CYCLE_MS;
	// cost-chart-flow-window: translateX(-30%) to translateX(100%).
	return (-FLOW_WINDOW + (1 + FLOW_WINDOW) * progress) * width;
}

function setMask(
	element: HTMLElement,
	mask: { image?: string; size: string; position: string },
) {
	for (const prefix of ["", "-webkit-"]) {
		if (mask.image)
			element.style.setProperty(`${prefix}mask-image`, mask.image);
		element.style.setProperty(`${prefix}mask-size`, mask.size);
		element.style.setProperty(`${prefix}mask-position`, mask.position);
		element.style.setProperty(`${prefix}mask-repeat`, "no-repeat");
	}
}
