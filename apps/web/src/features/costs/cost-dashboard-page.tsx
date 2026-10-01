import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { GITHUB_INACTIVE_FILTER_TOOLTIP } from "@rudel/api-routes";
import { type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/app/ui/tooltip";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { CHART_INTERVALS } from "./chart-interval";
import { ChartIntervalPicker } from "./chart-interval-picker";
import { CostBreakdown } from "./cost-breakdown";
import { CostChart } from "./cost-chart";
import { costLabel, getMetricData, METRIC_LABELS } from "./cost-format";
import {
	COST_LABELS,
	type CostDashboardController,
	useCostDashboard,
} from "./use-cost-dashboard";
import "./cost-dashboard.css";

export function CostDashboardPage() {
	return <CostDashboardView dashboard={useCostDashboard()} />;
}

export function CostDashboardView({
	dashboard,
	toolbarStart,
}: {
	dashboard: CostDashboardController;
	toolbarStart?: ReactNode;
}) {
	const {
		input,
		query,
		metric,
		metrics,
		interval,
		setInterval,
		dimensions,
		toggle,
		clear,
		setSplit,
		setMetric,
	} = dashboard;
	const { data, isPending, isError } = query;
	const workspace = useOptionalOrganization();
	const [focusedFilter, setFocusedFilter] = useState<string | null>(null);
	const selectedData = getMetricData(data, metric);
	const isPullRequestMetric = metric === "mergedPullRequests";
	const isGitHubMetric = isPullRequestMetric || metric === "ciRuns";
	const chipDimensions = isGitHubMetric
		? ([...dimensions, "members", "models"] as const)
		: dimensions;
	const filtered = chipDimensions.some(
		(dimension) => input[dimension].length > 0,
	);
	return (
		<div
			className="cost-page isolate antialiased"
			aria-busy={query.isFetching}
			data-updating={query.isFetching && !isPending}
		>
			<section
				className="cost-page-toolbar"
				aria-label="Dashboard controls"
				data-fluid-menu-root=""
			>
				<FluidMenuHover items="button" />
				{toolbarStart}
				<DashboardDateControls
					className="h-7 shrink-0 gap-1.5 rounded-md border-0 bg-(--cost-surface) py-1 pr-2 pl-1.5 text-base font-medium tracking-[-0.01em] text-(--cost-foreground) shadow-[0_0_0_0.5px_transparent_inset,0_0_0_0.5px_#0000000f,0_1px_1px_-1px_#0000001a,0_1px_2px_0_#0000000d] outline-none hover:bg-(--cost-hover) focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--cost-blue) has-data-[icon=inline-start]:pl-1.5 aria-expanded:bg-(--cost-hover) sm:h-7 sm:text-sm dark:bg-(--cost-surface) dark:shadow-[0_0_0_0.5px_#ffffff12_inset,0_0_0_0.5px_transparent,0_1px_1px_-1px_transparent,0_1px_2px_0_transparent] dark:hover:bg-(--cost-hover) [&_svg]:size-4 [&_svg]:h-lh [&_svg]:text-[#5d5d5d] dark:[&_svg]:text-[#acaeb2]"
					sourceComponent="cost_dashboard_date_picker"
					triggerSuffix={
						CHART_INTERVALS.find((option) => option.value === interval)?.label
					}
					calendarControls={
						<ChartIntervalPicker value={interval} onChange={setInterval} />
					}
				/>
				{filtered ? (
					<section
						className="cost-active-filters"
						aria-label="Active dashboard filters"
					>
						{chipDimensions.flatMap((dimension) =>
							input[dimension].map((id) => {
								const member =
									dimension === "members"
										? workspace?.state.members?.find(
												(entry) => entry.user.id === id,
											)
										: undefined;
								const label =
									(selectedData ?? data?.metrics.cost)?.breakdowns[
										dimension
									].find((entry) => entry.id === id)?.label ??
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
											inactive
												? focusedFilter === `${dimension}:${id}`
												: undefined
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
												<HugeiconsIcon
													icon={Cancel01Icon}
													size={12}
													className="shrink-0"
												/>
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
						<button
							type="button"
							className="cost-text-button"
							onClick={() => clear()}
						>
							Clear all
						</button>
					</section>
				) : null}
			</section>
			<div className="cost-page-scroll" tabIndex={-1}>
				<div className="cost-page-content">
					{isError ? (
						<div className="cost-error" role="alert">
							<div>
								<h2>Couldn’t load dashboard</h2>
								<p>{query.error.message || "Please try again in a moment."}</p>
							</div>
							<button
								type="button"
								className="cost-secondary-button"
								onClick={() => query.refetch()}
							>
								Try again
							</button>
						</div>
					) : (
						<CostChart
							data={data}
							metric={metric}
							metrics={metrics}
							runSignals={input.runSignals}
							signalTypes={input.signalTypes}
							interval={interval}
							onMetricChange={setMetric}
							onRefresh={() => query.refetch()}
							refreshing={query.isFetching && !isPending}
							pending={isPending}
							splitBy={data?.splitBy ?? input.splitBy}
							onResetSplit={() => setSplit("none")}
						/>
					)}
					<div className="cost-breakdowns-container" hidden={isError}>
						<div
							className="cost-breakdowns"
							data-signals={metric === "signals"}
							data-pull-requests={isPullRequestMetric}
							data-ci-runs={metric === "ciRuns"}
						>
							{dimensions.map((dimension) => (
								<CostBreakdown
									key={dimension}
									dimension={dimension}
									entries={selectedData?.breakdowns[dimension] ?? []}
									metric={metric}
									valueLabel={METRIC_LABELS[metric]}
									unavailable={selectedData === null}
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
