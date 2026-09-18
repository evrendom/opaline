import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
	CostDashboard,
	CostDashboardInput,
	DashboardMetric,
} from "@rudel/api-routes";
import { useId, useMemo } from "react";
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
import { formatIsoDate } from "@/lib/format";
import {
	CHART_INTERVALS,
	type ChartInterval,
	formatChartDate,
	formatChartPeriod,
	getChartSeriesValue,
	groupChartTrend,
} from "./chart-interval";
import {
	costLabel,
	DASHBOARD_METRICS,
	formatMetric,
	formatRunDuration,
	getMetricData,
	getMetricTotal,
	METRIC_LABELS,
} from "./cost-format";

// Normalized from the recorded annual cost profile: clustered daily peaks and
// quiet intervals, with the empty lead-in trimmed. Decorative geometry only;
// loading never waits for a data request or displays historical amounts.
const DASHBOARD_LOADING_LINE = [
	"M 10 48 L 15.1 47 L 20.3 46.4 L 25.4 47 L 30.5 48 L 40.8 48 L 45.9 45.7 L 51 44.2",
	"L 56.2 44.2 L 61.3 46.4 L 66.4 48 L 71.6 47.8 L 76.7 47.3 L 81.8 41.2 L 87 45.8 L 92.1 47.1",
	"L 97.2 47.9 L 102.4 46.1 L 107.5 48 L 112.6 44.5 L 117.7 48 L 122.9 40.5 L 128 41.5 L 133.1 46.5",
	"L 138.3 45.2 L 143.4 44.7 L 148.5 44.3 L 153.7 37.7 L 158.8 32.1 L 163.9 46.1 L 169.1 44.7 L 174.2 47.2",
	"L 179.3 48 L 184.5 47.9 L 189.6 45.1 L 194.7 48 L 199.8 47.1 L 205 44.4 L 210.1 43 L 215.2 43.8",
	"L 220.4 41.3 L 225.5 37.2 L 230.6 41.2 L 235.8 33.7 L 240.9 37.4 L 246 24.1 L 251.2 32.7 L 256.3 40.5",
	"L 261.4 9.5 L 266.5 32.9 L 271.7 44.4 L 276.8 47.6 L 281.9 31.2 L 287.1 27.4 L 292.2 28.9 L 297.3 41.6",
	"L 302.5 45.3 L 307.6 40.2 L 312.7 47.2 L 317.9 36.5 L 323 40.8 L 328.1 43 L 333.2 43 L 338.4 48",
	"L 343.5 47.9 L 348.6 47.8 L 353.8 47.1 L 358.9 47.9 L 364 47.3 L 369.2 48 L 374.3 47.9 L 379.4 47.4",
	"L 384.6 48 L 425.6 48 L 430.7 47.1 L 435.9 48 L 466.6 48 L 471.8 47.9 L 476.9 48 L 482 48",
	"L 487.2 47.9 L 492.3 48 L 507.7 48 L 512.8 47 L 518 48 L 697.5 48 L 702.7 39 L 707.8 42",
	"L 712.9 44.9 L 718.1 43.1 L 723.2 44.9 L 728.3 33.4 L 733.5 31.8 L 738.6 29 L 743.7 22.7 L 748.8 35.6",
	"L 754 38.1 L 759.1 35.2 L 764.2 34 L 769.4 31.2 L 774.5 39.9 L 779.6 28.1 L 784.8 48 L 789.9 47.2",
	"L 795 27.6 L 800.2 37.2 L 805.3 29 L 810.4 30.4 L 815.5 31 L 820.7 31.3 L 825.8 20.4 L 830.9 18.9",
	"L 836.1 24.5 L 841.2 16 L 846.3 6 L 851.5 15.2 L 856.6 37.9 L 861.7 48 L 866.9 30.4 L 872 8",
	"L 877.1 10.2 L 882.3 33 L 887.4 14.3 L 892.5 31.5 L 897.6 48 L 928.4 48 L 933.6 43.5 L 938.7 48",
	"L 954.1 48 L 959.2 39.8 L 964.3 14.9 L 969.5 10.1 L 974.6 35.7 L 979.7 19 L 984.9 39.2 L 990 48",
].join(" ");

// Pulse's default series palette, converted to OKLCH.
// https://github.com/benjitaylor/pulse/blob/main/src/theme.ts
// Duration splits keep all eight fixed ranges plus Unknown duration.
const SERIES_COLORS = [
	"oklch(0.623 0.188 259.815)", // Blue
	"oklch(0.637 0.208 25.331)", // Red
	"oklch(0.723 0.192 149.579)", // Green
	"oklch(0.769 0.165 70.08)", // Amber
	"oklch(0.606 0.219 292.717)", // Violet
	"oklch(0.656 0.212 354.308)", // Pink
	"oklch(0.715 0.126 215.221)", // Cyan
	"oklch(0.705 0.187 47.604)", // Orange
	"oklch(0.60 0.02 260)", // Unknown duration
];
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
type Props = {
	data: CostDashboard | undefined;
	pending: boolean;
	metric: DashboardMetric;
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
	runSignals,
	signalTypes,
	onMetricChange,
	onRefresh,
	refreshing,
	interval,
}: Props) {
	const data = getMetricData(dashboard, metric);
	const metricLabel = METRIC_LABELS[metric];
	const unavailable = data === null;
	const coverage = metric === "agentRuns" ? data?.coverage : undefined;
	const durationStats =
		metric === "agentRuns" ? data?.durationStats : undefined;
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
		return groupChartTrend(data?.trend ?? [], interval).map((point) => ({
			...point,
			medianSeconds:
				point.startDate > today
					? null
					: (durations.get(point.date)?.medianSeconds ?? null),
			p95Seconds:
				point.startDate > today
					? null
					: (durations.get(point.date)?.p95Seconds ?? null),
		}));
	}, [data?.trend, durationStats, interval, today]);
	const visiblePointCount = trend.filter(
		(point) => point.startDate <= today,
	).length;
	const intervalLabel = CHART_INTERVALS.find(
		(option) => option.value === interval,
	)?.label;
	const signalDimension = metric === "signals" ? "signalTypes" : "runSignals";
	const selectedSignals = metric === "signals" ? signalTypes : runSignals;
	const isSignalMetric = metric === "signals" || metric === "agentRuns";
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
					(signalType ? SIGNAL_COLORS[signalType] : undefined) ??
					SERIES_COLORS[index % SERIES_COLORS.length],
			};
		}) ?? [];
	const primaryColor = series[0]?.color ?? SERIES_COLORS[0];
	return (
		<section
			className="cost-chart-panel"
			aria-label={
				metric === "agentRuns"
					? "Agent runs with median and P95 duration over time"
					: `${metricLabel} over time`
			}
			aria-busy={pending}
		>
			<fieldset
				className="cost-metrics"
				aria-label="Chart metric"
				data-fluid-menu-root=""
			>
				<FluidMenuHover items=".cost-metric" />
				{DASHBOARD_METRICS.map((value) => {
					const total = getMetricTotal(dashboard, value);
					const metricData = getMetricData(dashboard, value);
					return (
						<Metric
							key={value}
							label={METRIC_LABELS[value]}
							description={
								value === "cost"
									? "Estimated cost of this usage at API rates. This does not reflect actual subscription charges."
									: undefined
							}
							value={
								total === undefined
									? undefined
									: total === null
										? "—"
										: formatMetric(total, value)
							}
							unavailable={total === null}
							qualifier={
								value === "agentRuns" && metricData?.incomplete
									? "indexed"
									: undefined
							}
							primary={metric === value}
							onClick={() => onMetricChange(value)}
						/>
					);
				})}
			</fieldset>
			<div className="cost-chart-key" data-fluid-menu-root="">
				<FluidMenuHover items=".cost-text-button" />
				<div className="cost-chart-key-copy">
					<div className="cost-chart-legend">
						{series.map((entry) => (
							<div key={entry.id} className="cost-legend-item">
								<i style={{ backgroundColor: entry.color }} />
								{entry.label}
							</div>
						))}
						{metric === "agentRuns" ? (
							<>
								<div
									className="cost-legend-item cost-duration-legend"
									data-percentile="median"
								>
									<i aria-hidden="true" />
									Median{" "}
									<strong>
										{formatRunDuration(durationStats?.medianSeconds)}
									</strong>
								</div>
								<div
									className="cost-legend-item cost-duration-legend"
									data-percentile="p95"
								>
									<i aria-hidden="true" />
									P95{" "}
									<strong>
										{formatRunDuration(durationStats?.p95Seconds)}
									</strong>
								</div>
							</>
						) : null}
					</div>
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
							<span>{metricLabel} are still being indexed</span>
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
				{splitBy !== "none" ? (
					<button
						type="button"
						className="cost-text-button"
						onClick={onResetSplit}
					>
						Show total
					</button>
				) : (
					<div className="cost-chart-frequency">{intervalLabel} · UTC</div>
				)}
			</div>
			<div className="cost-chart-canvas">
				{pending ? (
					<ChartSkeleton
						label={`Loading ${metricLabel.toLowerCase()}`}
						color={primaryColor}
					/>
				) : (
					<ResponsiveContainer width="100%" height="100%" minWidth={0}>
						<ComposedChart
							data={trend}
							margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
							accessibilityLayer
						>
							<defs>
								<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
									<stop
										offset="0%"
										stopColor={primaryColor}
										stopOpacity="var(--cost-chart-fill-opacity)"
									/>
									<stop
										offset="100%"
										stopColor={primaryColor}
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
							<CartesianGrid
								yAxisId="count"
								vertical={false}
								stroke="var(--cost-border)"
								strokeDasharray="3 4"
							/>
							<XAxis
								dataKey="date"
								tickFormatter={(value) =>
									formatChartDate(String(value), interval)
								}
								axisLine={false}
								tickLine={false}
								minTickGap={65}
								tickMargin={14}
								height={40}
								tick={{ fill: "var(--cost-muted)", fontSize: 11 }}
							/>
							<YAxis
								yAxisId="count"
								tickFormatter={(value) =>
									`${metric === "cost" ? "$" : ""}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))}`
								}
								domain={[0, "auto"]}
								axisLine={false}
								tickLine={false}
								tickCount={4}
								allowDecimals={metric === "cost"}
								tickMargin={10}
								width={56}
								tick={{ fill: "var(--cost-muted)", fontSize: 11 }}
							/>
							{metric === "agentRuns" ? (
								<YAxis
									yAxisId="duration"
									orientation="right"
									tickFormatter={(value) => formatRunDuration(Number(value))}
									domain={[0, "auto"]}
									axisLine={false}
									tickLine={false}
									tickCount={4}
									tickMargin={10}
									width={68}
									tick={
										durationStats?.sampleCount
											? { fill: "var(--cost-muted)", fontSize: 11 }
											: false
									}
								/>
							) : null}
							<Tooltip
								cursor={{ stroke: "var(--cost-muted)", strokeDasharray: "3 4" }}
								content={({ active, payload, label }) => {
									const point = trend.find((entry) => entry.date === label);
									return active && payload?.length ? (
										<div className="cost-chart-tooltip">
											<p>
												{point
													? formatChartPeriod(point)
													: formatChartDate(String(label), interval)}
											</p>
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
															: formatMetric(Number(item.value), metric)}
													</strong>
												</div>
											))}
										</div>
									) : null;
								}}
							/>
							{series.map((entry) => (
								<Area
									yAxisId="count"
									key={entry.id}
									dataKey={(point) =>
										getChartSeriesValue(point, entry.id, today)
									}
									name={entry.label}
									type="linear"
									stroke={entry.color}
									strokeWidth={2}
									strokeLinecap="round"
									strokeLinejoin="round"
									fill={
										series.length === 1 ? `url(#${gradientId})` : "transparent"
									}
									dot={visiblePointCount === 1 ? { r: 3 } : false}
									activeDot={{
										r: 4,
										stroke: "var(--cost-surface)",
										strokeWidth: 2,
									}}
									isAnimationActive={false}
								/>
							))}
							{metric === "agentRuns" ? (
								<>
									<Line
										yAxisId="duration"
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
							) : null}
						</ComposedChart>
					</ResponsiveContainer>
				)}
				{!pending && (unavailable || (data && !data.hasUsage)) ? (
					<div className="cost-chart-empty">
						<p>
							{unavailable
								? `${metricLabel} are still being indexed`
								: metric === "agentRuns" &&
										((coverage?.indexingSessions ?? 0) > 0 ||
											(coverage?.unavailableSessions ?? 0) > 0)
									? "No indexed agent runs match yet"
									: `No ${metric === "cost" ? "usage" : metricLabel.toLowerCase()} in this selection`}
						</p>
						{!unavailable &&
						metric === "agentRuns" &&
						coverage?.indexingSessions ? (
							<p>Some sessions are still being indexed.</p>
						) : !unavailable ? (
							<p>Try a different date range or clear your filters.</p>
						) : null}
					</div>
				) : null}
			</div>
		</section>
	);
}
function Metric({
	label,
	description,
	value,
	qualifier,
	primary = false,
	unavailable,
	onClick,
}: {
	label: string;
	description: string | undefined;
	value: string | undefined;
	qualifier: string | undefined;
	primary?: boolean;
	unavailable: boolean;
	onClick: () => void;
}) {
	return (
		<div
			className="cost-metric"
			data-primary={primary}
			data-unavailable={unavailable}
		>
			<div className="cost-metric-label">
				<button
					type="button"
					className="cost-metric-select"
					aria-pressed={primary}
					aria-label={label}
					onClick={onClick}
				>
					{label}
				</button>
				{description ? (
					<InfoTooltip>
						<TooltipTrigger
							className="cost-metric-info"
							aria-label={`About ${label}`}
						>
							<HugeiconsIcon
								icon={InformationCircleIcon}
								size={14}
								strokeWidth={1.5}
								aria-hidden="true"
							/>
						</TooltipTrigger>
						<TooltipContent className="max-w-64">{description}</TooltipContent>
					</InfoTooltip>
				) : null}
			</div>
			{value === undefined ? (
				<div className="cost-skeleton cost-metric-skeleton" />
			) : (
				<span className="cost-metric-value">
					{value}
					{qualifier ? (
						<small className="cost-metric-qualifier">{qualifier}</small>
					) : null}
				</span>
			)}
		</div>
	);
}

function ChartSkeleton({ label, color }: { label: string; color: string }) {
	return (
		<output className="cost-chart-skeleton" aria-label={label}>
			<ChartLoadingWave
				className="h-full w-full"
				viewBoxHeight={56}
				color={color}
				linePath={DASHBOARD_LOADING_LINE}
				strokeWidth={2}
			/>
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
