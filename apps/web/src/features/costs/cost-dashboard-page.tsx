import {
	type DashboardMetric,
	GITHUB_INACTIVE_FILTER_TOOLTIP,
} from "@rudel/api-routes";
import { IconAlertTriangle, IconRefresh, IconX } from "@tabler/icons-react";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { Button } from "@/components/dashboard/button";
import { EmptyState } from "@/components/dashboard/page-parts";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { CostBreakdown } from "./cost-breakdown";
import { CostChart } from "./cost-chart";
import { costLabel, getMetricData, METRIC_LABELS } from "./cost-format";
import { RangeLeadContext } from "./cost-rail-override";
import { DashboardRangeControls } from "./dashboard-range-controls";
import {
	PERSON_DIMENSIONS,
	useDeferredPersonRows,
} from "./deferred-person-rows";
import {
	COST_LABELS,
	type CostDashboardController,
	useCostDashboard,
} from "./use-cost-dashboard";
import {
	type MetricPreviews,
	useMetricPreviews,
	usePrefetchDashboardMetric,
} from "./use-metric-previews";
import "./cost-dashboard.css";
import "./cost-dashboard-variants.css";

export type DashboardVariant =
	| "rail"
	| "rail-card"
	| "dot-rail"
	| "chat"
	| "rail-chat"
	| "side"
	| "tabs"
	| "compact"
	| "one-card";

export function CostDashboardPage() {
	const dashboard = useCostDashboard();
	const previews = useMetricPreviews(
		dashboard.inputFor,
		dashboard.metrics,
		dashboard.input,
	);
	const prefetchMetric = usePrefetchDashboardMetric(dashboard.inputFor);
	return (
		<CostDashboardView
			dashboard={dashboard}
			previews={previews}
			onMetricIntent={prefetchMetric}
			rangeControlsInShellHeader
		/>
	);
}

export function CostDashboardView({
	dashboard,
	toolbarStart,
	rangeControlsInShellHeader = false,
	previews,
	onMetricIntent,
	scope = "workspace",
	breakdownLayout = "grid",
	variant,
	waiting = false,
}: {
	dashboard: CostDashboardController;
	toolbarStart?: ReactNode;
	/** The shell header renders the range controls (the workspace dashboard). */
	rangeControlsInShellHeader?: boolean;
	/** Each stat card's own answer, the charted one included. */
	previews?: MetricPreviews;
	/** A pointer or focus on a stat card, to start loading its chart. */
	onMetricIntent?: (metric: DashboardMetric) => void;
	/** `repository` lays the breakdowns out without a Repositories card. */
	scope?: "workspace" | "repository";
	/** `row` sets the breakdown cards two to a row, for a narrow pane;
	 * `grid` wraps them three to a row. */
	breakdownLayout?: "grid" | "row";
	variant?: DashboardVariant;
	waiting?: boolean;
}) {
	const {
		input,
		query,
		metric,
		metrics,
		metricsPending,
		interval,
		setInterval,
		dimensions,
		toggle,
		clear,
		setSplit,
		setMetric,
	} = dashboard;
	const isPending = query.isPending || waiting;
	const data = waiting ? undefined : query.data;
	const isError = !waiting && query.isError;
	const workspace = useOptionalOrganization();
	const demo = useDemoRuntime();
	// The last chart that finished loading, per workspace and date range. While
	// a newly picked metric loads without a cached answer, keep drawing this one
	// (dimmed) instead of swapping the chart for a skeleton; the picked card's
	// ring moves at once. A new date range plays the loading animation, as the
	// stat cards do, since the old chart no longer describes it.
	const orgId = workspace?.state.activeOrg?.id;
	const range = `${input.startDate}/${input.endDate}`;
	const [settled, setSettled] = useState<{
		data: NonNullable<typeof data>;
		metric: DashboardMetric;
		orgId: string | undefined;
		range: string;
	} | null>(null);
	if (
		data &&
		!isPending &&
		(settled?.data !== data ||
			settled.metric !== metric ||
			settled.orgId !== orgId ||
			settled.range !== range)
	)
		setSettled({ data, metric, orgId, range });
	const showSettled =
		isPending &&
		settled !== null &&
		settled.orgId === orgId &&
		settled.range === range;
	const [focusedFilter, setFocusedFilter] = useState<string | null>(null);
	const tabbed = variant === "tabs" || variant === "one-card";
	const [breakdownTab, setBreakdownTab] = useState<string | null>(null);
	const activeTab =
		dimensions.find((dimension) => dimension === breakdownTab) ?? dimensions[0];
	const shownDimensions = tabbed && activeTab ? [activeTab] : dimensions;
	const selectedData = getMetricData(data, metric);
	const loadPersonRows = useDeferredPersonRows(data);
	const isPullRequestMetric = metric === "mergedPullRequests";
	const isGitHubMetric = isPullRequestMetric || metric === "ciRuns";
	const chipDimensions = isGitHubMetric
		? ([...dimensions, "members", "models"] as const)
		: dimensions;
	const filtered = chipDimensions.some(
		(dimension) => input[dimension].length > 0,
	);
	// The range controls sit on the page title row. The shell header renders
	// the workspace dashboard's itself; other views portal theirs into it, and
	// without a shell header (embeds, tests) they stay in the toolbar.
	const headerPortal = useShellHeaderPortal();
	const lead = useContext(RangeLeadContext);
	const rangeControls = rangeControlsInShellHeader ? null : (
		<DashboardRangeControls
			interval={interval}
			onIntervalChange={setInterval}
			inHeader={!!headerPortal}
			compact={Boolean(lead)}
		/>
	);
	// The active filters sit in the chart card's header, as chips that each
	// remove their own filter.
	const activeFilters = filtered ? (
		<section
			className="cost-active-filters"
			aria-label="Active dashboard filters"
		>
			{chipDimensions.flatMap((dimension) =>
				input[dimension].map((id) => {
					const member =
						dimension === "members"
							? workspace?.state.members?.find((entry) => entry.user.id === id)
							: undefined;
					const label =
						(selectedData ?? data?.metrics.cost)?.breakdowns[dimension].find(
							(entry) => entry.id === id,
						)?.label ??
						member?.user.name ??
						id;
					const inactive =
						isGitHubMetric &&
						(dimension === "members" || dimension === "models");
					return (
						<Tooltip
							key={`${dimension}:${id}`}
							triggerId={
								inactive
									? `cost-filter-${dimension}-${encodeURIComponent(id)}`
									: undefined
							}
							open={
								inactive ? focusedFilter === `${dimension}:${id}` : undefined
							}
							onOpenChange={(open) => {
								if (inactive)
									setFocusedFilter(open ? `${dimension}:${id}` : null);
							}}
						>
							<TooltipTrigger
								asChild
								id={`cost-filter-${dimension}-${encodeURIComponent(id)}`}
								onFocus={() => {
									if (inactive) setFocusedFilter(`${dimension}:${id}`);
								}}
								onBlur={() => setFocusedFilter(null)}
							>
								<button
									type="button"
									key={`${dimension}:${id}`}
									className="cost-filter-chip"
									data-inactive={inactive}
									aria-describedby={
										inactive
											? `cost-filter-description-${dimension}-${encodeURIComponent(id)}`
											: undefined
									}
									onClick={() => toggle(dimension, id)}
									title={`${COST_LABELS[dimension]}: ${costLabel(dimension, label) || "Unattributed"}`}
									aria-label={`Remove ${dimension === "members" ? "member" : dimension === "models" ? "model" : COST_LABELS[dimension].toLowerCase()} filter ${costLabel(dimension, label)}${inactive ? ` (not applied to ${METRIC_LABELS[metric]})` : ""}`}
								>
									<span className="cost-filter-dimension">
										{COST_LABELS[dimension]}
									</span>
									<span className="truncate">
										{costLabel(dimension, label) || "Unattributed"}
									</span>
									<IconX size={12} className="shrink-0" />
								</button>
							</TooltipTrigger>
							{inactive ? (
								<TooltipContent
									role="tooltip"
									id={`cost-filter-description-${dimension}-${encodeURIComponent(id)}`}
								>
									{GITHUB_INACTIVE_FILTER_TOOLTIP}
								</TooltipContent>
							) : null}
						</Tooltip>
					);
				}),
			)}
		</section>
	) : null;
	const rangeInContent = variant === "rail-chat" && !headerPortal;
	const showToolbar =
		toolbarStart !== undefined ||
		(!headerPortal && !rangeInContent && rangeControls !== null);
	const breakdownsRef = useRef<HTMLDivElement>(null);
	const breakdownRowHeight = useBreakdownRowHeight(breakdownsRef);
	return (
		<div
			className="cost-page isolate antialiased"
			data-variant={variant}
			aria-busy={query.isFetching}
			data-updating={(query.isFetching && !isPending) || showSettled}
		>
			{headerPortal && rangeControls
				? createPortal(rangeControls, headerPortal)
				: null}
			{showToolbar ? (
				<section
					className="cost-page-toolbar"
					aria-label="Dashboard controls"
					data-fluid-menu-root=""
				>
					<FluidMenuHover items="button" />
					{toolbarStart}
					{headerPortal ? null : rangeControls}
				</section>
			) : null}
			{/* Focusable only for the demo, which focuses it on entry so the
			    keyboard scrolls it; in the app a click must not focus it. */}
			<div className="cost-page-scroll" tabIndex={demo ? -1 : undefined}>
				<div className="cost-page-content">
					{rangeInContent ? (
						lead ? (
							<div className="cost-range-controls cost-range-lead">
								{rangeControls}
								{lead}
							</div>
						) : (
							rangeControls
						)
					) : null}
					{isError ? (
						<div className="cost-error-state" role="alert">
							<EmptyState
								icon={IconAlertTriangle}
								title="The dashboard couldn’t load"
								description={dashboardErrorText(query.error)}
							>
								<Button
									variant="outline"
									className="mx-auto mt-2"
									onClick={() => {
										void query.refetch();
									}}
								>
									<IconRefresh />
									Try again
								</Button>
							</EmptyState>
						</div>
					) : (
						<CostChart
							dots={
								variant === "rail-card"
									? "switch"
									: variant === "dot-rail" || variant === "rail-chat"
										? "only"
										: undefined
							}
							data={showSettled ? settled.data : data}
							metric={showSettled ? settled.metric : metric}
							selectedMetric={metric}
							metrics={metrics}
							metricsPending={metricsPending}
							filters={activeFilters}
							previews={previews}
							inputFor={dashboard.inputFor}
							runSignals={input.runSignals}
							signalTypes={input.signalTypes}
							interval={interval}
							onMetricChange={setMetric}
							onMetricIntent={onMetricIntent}
							onRefresh={() => query.refetch()}
							refreshing={query.isFetching && !isPending}
							pending={isPending && !showSettled}
							splitBy={
								showSettled
									? settled.data.splitBy
									: (data?.splitBy ?? input.splitBy)
							}
							onResetSplit={() => setSplit("none")}
						/>
					)}
					<div className="cost-breakdowns-container" hidden={isError}>
						{tabbed ? (
							<div className="cost-breakdown-tabs" role="tablist">
								{dimensions.map((dimension) => (
									<button
										key={dimension}
										type="button"
										role="tab"
										aria-selected={dimension === activeTab}
										onClick={() => setBreakdownTab(dimension)}
									>
										{COST_LABELS[dimension]}
									</button>
								))}
							</div>
						) : null}
						<div
							ref={breakdownsRef}
							className="cost-breakdowns"
							// Every row is as tall as the space left under the chart: one row
							// fits the page exactly, more rows keep that height and scroll.
							data-sized={breakdownRowHeight ? "" : undefined}
							style={
								breakdownRowHeight
									? ({
											"--breakdown-row-height": `${breakdownRowHeight}px`,
										} as CSSProperties)
									: undefined
							}
							data-scope={scope}
							data-layout={breakdownLayout}
							data-signals={metric === "signals"}
							data-pull-requests={isPullRequestMetric}
							data-ci-runs={metric === "ciRuns"}
						>
							{shownDimensions.map((dimension) => (
								<CostBreakdown
									key={dimension}
									dimension={dimension}
									entries={selectedData?.breakdowns[dimension] ?? []}
									metric={metric}
									valueLabel={METRIC_LABELS[metric]}
									unavailable={selectedData === null}
									onLoadDeferred={
										PERSON_DIMENSIONS.has(dimension)
											? (loadPersonRows ?? undefined)
											: undefined
									}
									selected={input[dimension]}
									pending={isPending}
									split={input.splitBy === dimension}
									onToggle={(id) => toggle(dimension, id)}
									onClear={() => clear(dimension)}
									onSplit={() =>
										setSplit(input.splitBy === dimension ? "none" : dimension)
									}
								/>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// The shortest a breakdown row gets before the page scrolls instead.
const MIN_BREAKDOWN_ROW_HEIGHT = 205;

/**
 * The height left for a breakdown row under the chart: from the grid's top to
 * the bottom of the scroll viewport, less the page's bottom padding. Tracks the
 * viewport and the content above (the chart's notes vary by metric).
 */
function useBreakdownRowHeight(ref: RefObject<HTMLElement | null>) {
	const [height, setHeight] = useState<number | null>(null);
	useLayoutEffect(() => {
		const grid = ref.current;
		const scroll = grid?.closest<HTMLElement>(".cost-page-scroll");
		const content = grid?.closest<HTMLElement>(".cost-page-content");
		if (!grid || !scroll || !content || typeof ResizeObserver === "undefined")
			return;
		const measure = () => {
			const top =
				grid.getBoundingClientRect().top -
				scroll.getBoundingClientRect().top +
				scroll.scrollTop;
			const bottom = Number.parseFloat(getComputedStyle(content).paddingBottom);
			setHeight(
				Math.max(
					MIN_BREAKDOWN_ROW_HEIGHT,
					Math.floor(scroll.clientHeight - top - bottom),
				),
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(scroll);
		for (const child of content.children) {
			if (!child.contains(grid)) observer.observe(child);
		}
		return () => observer.disconnect();
	}, [ref]);
	return height;
}

function dashboardErrorText(error: unknown): string {
	const code = (error as { code?: string } | null)?.code;
	if (code === "SERVICE_UNAVAILABLE")
		return "Opaline’s session data isn’t answering right now. Try again in a moment.";
	const message = (error as { message?: string } | null)?.message;
	return message || "Try loading this view again.";
}
