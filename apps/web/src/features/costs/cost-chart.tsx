import type {
	CostDashboard,
	CostDashboardInput,
	DashboardMetric,
} from "@rudel/api-routes";
import { GITHUB_RETENTION_TOOLTIP } from "@rudel/api-routes";
import {
	type Icon,
	IconBoltFilled,
	IconCircleCheckFilled,
	IconCoinFilled,
	IconGitCommit,
	IconGitMerge,
	IconMessagesFilled,
	IconMoodSmileFilled,
	IconX,
} from "@tabler/icons-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
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
	YAxis,
} from "recharts";
import {
	Tooltip as InfoTooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/app/ui/tooltip";
import { ChartLoadingWave } from "@/components/ui/chart-loading-wave";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { DemoTrendPreview } from "@/features/demo/demo-trend-preview";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { formatIsoDate } from "@/lib/format";
import { type AreaShape, morphAreas, readAreaShape } from "./area-morph";
import { SERIES_COLORS } from "./chart-colors";
import {
	DASHBOARD_LOADING_LINE,
	HEARTBEAT_BASE_VALUE,
	HEARTBEAT_DOMAIN,
	LOADING_ROWS,
	LOADING_WAVE_HEIGHT,
	seriesKey,
} from "./chart-flow";
import {
	type ChartInterval,
	formatChartDate,
	formatChartPeriod,
	getChartSeriesValue,
	groupChartTrend,
	isCiHistoryAvailable,
} from "./chart-interval";
import { ChartMorph } from "./chart-morph";
import {
	costLabel,
	formatMetricRatio,
	formatRunDuration,
	getMetricData,
	getMetricTotal,
	METRIC_LABELS,
} from "./cost-format";
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

// Each stat card's glyph and accent, in Opaline's palette.
// Filled glyphs; Tabler has no filled git glyphs, so those stay outline.
const METRIC_APPEARANCE: Record<
	DashboardMetric,
	{ icon: Icon; color: string }
> = {
	cost: { icon: IconCoinFilled, color: SERIES_COLORS[3] },
	sessions: { icon: IconMessagesFilled, color: SERIES_COLORS[0] },
	agentRuns: { icon: IconBoltFilled, color: SERIES_COLORS[4] },
	signals: { icon: IconMoodSmileFilled, color: SERIES_COLORS[5] },
	mergedPullRequests: { icon: IconGitMerge, color: SERIES_COLORS[2] },
	ciRuns: { icon: IconCircleCheckFilled, color: SERIES_COLORS[6] },
	ciFailuresPerPullRequest: {
		icon: IconCircleCheckFilled,
		color: SERIES_COLORS[1],
	},
	commits: { icon: IconGitCommit, color: SERIES_COLORS[7] },
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
	data: CostDashboard | undefined;
	pending: boolean;
	/** The metric the chart draws. */
	metric: DashboardMetric;
	/** The picked stat card; differs from `metric` while its chart loads. */
	selectedMetric?: DashboardMetric;
	metrics: readonly DashboardMetric[];
	/** The server has not yet said which metrics this scope offers. */
	metricsPending?: boolean;
	/** The active filter chips, shown in the chart's header. */
	filters?: ReactNode;
	/** Sparkline trends for the stat cards other than the charted one. */
	previews?: MetricPreviews;
	runSignals: CostDashboardInput["runSignals"];
	signalTypes: CostDashboardInput["signalTypes"];
	interval: ChartInterval;
	onMetricChange: (metric: DashboardMetric) => void;
	onRefresh: () => void;
	refreshing: boolean;
	splitBy: CostDashboardInput["splitBy"];
	onResetSplit: () => void;
};

export function CostChart({
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
	runSignals,
	signalTypes,
	onMetricChange,
	onRefresh,
	refreshing,
	interval,
}: Props) {
	const demo = useDemoRuntime();
	const workspace = useOptionalOrganization();
	const [showMedian, setShowMedian] = useState(true);
	const [showP95, setShowP95] = useState(true);
	const [showCiFailures, setShowCiFailures] = useState(true);
	// The chart loads as itself (chart-flow.ts). "loading" draws the heartbeat;
	// "prime" keeps it flowing after the data lands, until the browser is
	// idle; "morph" draws the real data with its areas animated from the
	// heartbeat (area-morph.ts); "idle" is the same chart, interactive.
	const [phase, setPhase] = useState<ChartPhase>(pending ? "loading" : "idle");
	const [wasPending, setWasPending] = useState(pending);
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
	const trend = useMemo(() => {
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
	if (wasPending !== pending) {
		setWasPending(pending);
		setPhase(
			pending
				? "loading"
				: series.length > 0 && trend.length > 1 && !prefersReducedMotion()
					? "prime"
					: "idle",
		);
	}
	const heartbeat = phase === "loading" || phase === "prime";
	const seriesIdKey = series.map((entry) => entry.id).join("\u0000");
	const seriesValues = useMemo(
		() =>
			seriesIdKey
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
		[availableFrom, ciHistoryAvailable, seriesIdKey, today, trend],
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
		<section
			className="cost-chart-panel"
			aria-label={
				metric === "ciRuns"
					? "CI runs with median and P95 duration over time"
					: metric === "agentRuns"
						? "Agent runs with median and P95 duration over time"
						: metric === "mergedPullRequests"
							? "Merged pull requests with CI failures per pull request over time"
							: `${metricLabel} over time`
			}
			aria-busy={pending}
		>
			<fieldset
				className="cost-metrics"
				aria-label="Chart metric"
				aria-busy={metricsPending}
			>
				{metrics.map((value) => {
					const total = getMetricTotal(dashboard, value);
					const metricData = getMetricData(dashboard, value);
					// Only once the dashboard has answered: before that the card loads.
					const unknownCi =
						value === "ciRuns" &&
						total !== undefined &&
						!isCiHistoryAvailable(
							metricData?.githubHistory,
							metricData?.trend.at(-1)?.date ?? "",
						);
					return (
						<Metric
							key={value}
							label={METRIC_LABELS[value]}
							icon={METRIC_APPEARANCE[value].icon}
							color={METRIC_APPEARANCE[value].color}
							value={
								total === undefined
									? undefined
									: total === null || unknownCi
										? "—"
										: formatMetricRatio(total, value, metricData?.denominator)
							}
							unavailable={total === null || unknownCi}
							qualifier={
								metricData?.githubHistory?.preview
									? "preview"
									: value === "agentRuns" && metricData?.incomplete
										? "indexed"
										: undefined
							}
							primary={selectedMetric === value}
							trend={sparklineTotals(
								previews?.[value] ??
									(value === metric ? metricData?.trend : undefined),
								interval,
							)}
							onClick={() => onMetricChange(value)}
						/>
					);
				})}
			</fieldset>
			<div className="cost-chart-card">
				<div className="cost-chart-key" data-fluid-menu-root="">
					<FluidMenuHover items=".cost-text-button" />
					<div className="cost-chart-key-copy">
						<h2 className="cost-chart-title">{metricLabel} over time</h2>
						<div className="cost-chart-legend">
							{series.map((entry) => (
								<div key={entry.id} className="cost-legend-item">
									<i style={{ backgroundColor: entry.color }} />
									{entry.label}
								</div>
							))}
							{metric === "agentRuns" || metric === "ciRuns" ? (
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
							) : metric === "mergedPullRequests" ? (
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
						{history ? (
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
						{metric === "mergedPullRequests" && data?.cycleTimeStats ? (
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
						{metric === "ciRuns" && data?.ciMinutes ? (
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
						{coverage && data?.incomplete ? (
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
				</div>
				<div
					ref={canvasRef}
					className="cost-chart-canvas"
					data-phase={phase}
					data-lines-entering={linesEntering || undefined}
				>
					{demo && data ? (
						<DemoTrendPreview trend={trend} color={primaryColor} />
					) : null}
					{phase === "idle" ? null : (
						<ChartSkeleton
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
										ticks={heartbeat ? [] : trend.map((_, index) => index)}
										allowDecimals={false}
										tickFormatter={(value) =>
											formatChartDate(
												trend[Number(value)]?.date ?? "",
												interval,
											)
										}
										axisLine={false}
										tickLine={false}
										minTickGap={65}
										tickMargin={14}
										height={40}
										tick={
											heartbeat
												? false
												: { fill: "var(--cost-muted)", fontSize: 11 }
										}
									/>
									<YAxis
										yAxisId="count"
										tickFormatter={(value) =>
											`${metric === "cost" ? "$" : ""}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))}`
										}
										domain={heartbeat ? HEARTBEAT_DOMAIN : [0, "auto"]}
										axisLine={false}
										tickLine={false}
										tickCount={4}
										allowDecimals={metric === "cost"}
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
											hide={!showMedian && !showP95}
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
											hide={!showCiFailures || ciData === null}
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
											return active && payload?.length ? (
												<div className="cost-chart-tooltip">
													<p>{point ? formatChartPeriod(point) : null}</p>
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
														<p>CI history from {historyDate(availableFrom)}</p>
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
									{(heartbeat ? [null] : series).map((entry, index) => (
										<Area
											yAxisId="count"
											// By position: the heartbeat and the series it becomes are
											// one Area, whose paths the morph animates.
											key={seriesKey(index)}
											dataKey={seriesKey(index)}
											name={entry?.label ?? metricLabel}
											type="linear"
											stroke={heartbeat ? accent : entry?.color}
											strokeWidth={2}
											strokeLinecap="round"
											strokeLinejoin="round"
											fill={
												index === 0 && (series.length === 1 || phase !== "idle")
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
									))}
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
											hide={!showCiFailures || ciData === null}
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
					{!heartbeat &&
					(unavailable || noHistory || (data && !data.hasUsage)) ? (
						<div className="cost-chart-empty">
							<p>
								{noHistory
									? "No GitHub history for these dates"
									: unavailable
										? unavailableLabel
										: metric === "agentRuns" &&
												((coverage?.indexingSessions ?? 0) > 0 ||
													(coverage?.unavailableSessions ?? 0) > 0)
											? "No indexed agent runs match yet"
											: metric === "mergedPullRequests"
												? "No merged pull requests in this selection"
												: metric === "ciRuns"
													? "No CI runs in this selection"
													: `No ${metric === "cost" ? "usage" : metricLabel.toLowerCase()} in this selection`}
							</p>
							{noHistory ? (
								<p>
									{metric === "ciRuns"
										? `CI history starts ${historyDate(availableFrom)}. GitHub had already deleted older runs when this workspace connected.`
										: `PR history starts ${historyDate(availableFrom)}.`}
								</p>
							) : !unavailable &&
								metric === "agentRuns" &&
								coverage?.indexingSessions ? (
								<p>Some sessions are still being indexed.</p>
							) : !unavailable ? (
								<p>Try a different date range or clear your filters.</p>
							) : null}
						</div>
					) : null}
				</div>
			</div>
		</section>
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
	icon: MetricIcon,
	color,
	value,
	qualifier,
	primary = false,
	unavailable,
	trend,
	onClick,
}: {
	label: string;
	icon: Icon;
	/** The card's accent: its glyph and sparkline. */
	color: string;
	value: string | undefined;
	qualifier: string | undefined;
	primary?: boolean;
	unavailable: boolean;
	/** Per-period totals for the card's sparkline; undefined while loading. */
	trend: number[] | undefined;
	onClick: () => void;
}) {
	// Like the big chart: when the trend lands, the card's loading wave morphs
	// into its sparkline instead of the two swapping.
	const loading = !unavailable && trend === undefined;
	const [wasLoading, setWasLoading] = useState(loading);
	const [revealing, setRevealing] = useState(false);
	if (wasLoading !== loading) {
		setWasLoading(loading);
		setRevealing(!loading && !unavailable);
	}
	return (
		<div
			className="cost-metric"
			data-primary={primary}
			data-unavailable={unavailable}
			data-revealing={revealing || undefined}
			style={{ "--metric-color": color } as CSSProperties}
		>
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
						onClick={onClick}
					>
						{label}
					</button>
				</div>
				{value === undefined ? (
					<div className="cost-skeleton cost-metric-skeleton" />
				) : (
					<span className="cost-metric-value">
						{qualifier ? (
							<small className="cost-metric-qualifier">{qualifier}</small>
						) : null}
						{value}
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
					linePath={DASHBOARD_LOADING_LINE}
					strokeWidth={1.2}
					guides={false}
				/>
			) : null}
			{unavailable || loading ? null : <MetricSparkline values={trend} />}
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
function sparklineTotals(
	trend: MetricPreviews[DashboardMetric],
	interval: ChartInterval,
): number[] | undefined {
	return trend && groupChartTrend(trend, interval).map((point) => point.total);
}

// Stat card sparkline (CardSparkline), in the card's accent: a
// soft gradient area under a hairline. A trend with fewer than two points
// shows a faint sample curve, so the card reads as "trend goes here".
const SAMPLE_SPARKLINE = [0.3, 0.45, 0.38, 0.55, 0.48, 0.66, 0.58, 0.75];

function MetricSparkline({ values }: { values: number[] | undefined }) {
	const gradientId = useId().replace(/[^\w-]/g, "");
	const points = values?.filter((value) => Number.isFinite(value)) ?? [];
	const placeholder = points.length < 2;
	const peak = Math.max(...points, 0) || 1;
	const series = placeholder
		? SAMPLE_SPARKLINE
		: points.map((value) => value / peak);
	// CardSparkline insets: 3 units of headroom, 2 for the sample.
	const inset = placeholder ? 2 : 3;
	const path = series
		.map((value, index) => {
			const x = (index / (series.length - 1)) * 100;
			const y = 32 - inset - value * (32 - inset);
			return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
		})
		.join(" ");
	return (
		<svg
			aria-hidden="true"
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
		</svg>
	);
}

function ChartSkeleton({
	label,
	leaving,
}: {
	label: string;
	/** Data has landed: the placeholder axes fade as the real ones arrive. */
	leaving: boolean;
}) {
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
					<span key={index} />
				))}
			</div>
			<div className="cost-chart-loading-dates" aria-hidden="true">
				{[0, 1, 2, 3].map((index) => (
					<span key={index} />
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
