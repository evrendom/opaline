import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { ChartIntervalPicker } from "./chart-interval-picker";
import { CostBreakdown } from "./cost-breakdown";
import { CostChart } from "./cost-chart";
import { costLabel, getMetricData, METRIC_LABELS } from "./cost-format";
import { COST_LABELS, useCostDashboard } from "./use-cost-dashboard";
import "./cost-dashboard.css";

export function CostDashboardPage() {
	const {
		input,
		query,
		metric,
		interval,
		setInterval,
		dimensions,
		toggle,
		clear,
		setSplit,
		setMetric,
	} = useCostDashboard();
	const { data, isPending, isError } = query;
	const selectedData = getMetricData(data, metric);
	const filtered = dimensions.some((dimension) => input[dimension].length > 0);
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
				<DashboardDateControls
					className="h-7 shrink-0 gap-1.5 rounded-md border-0 bg-(--cost-surface) py-1 pr-2 pl-1.5 text-base font-medium tracking-[-0.01em] text-(--cost-foreground) shadow-[0_0_0_0.5px_transparent_inset,0_0_0_0.5px_#0000000f,0_1px_1px_-1px_#0000001a,0_1px_2px_0_#0000000d] outline-none hover:bg-(--cost-hover) focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--cost-blue) has-data-[icon=inline-start]:pl-1.5 aria-expanded:bg-(--cost-hover) sm:h-7 sm:text-sm dark:bg-(--cost-surface) dark:shadow-[0_0_0_0.5px_#ffffff12_inset,0_0_0_0.5px_transparent,0_1px_1px_-1px_transparent,0_1px_2px_0_transparent] dark:hover:bg-(--cost-hover) [&_svg]:size-4 [&_svg]:h-lh [&_svg]:text-[#5d5d5d] dark:[&_svg]:text-[#acaeb2]"
					sourceComponent="cost_dashboard_date_picker"
					calendarControls={
						<ChartIntervalPicker value={interval} onChange={setInterval} />
					}
				/>
				{filtered ? (
					<section
						className="cost-active-filters"
						aria-label="Active dashboard filters"
					>
						{dimensions.flatMap((dimension) =>
							input[dimension].map((id) => {
								const label =
									(selectedData ?? data?.metrics.cost)?.breakdowns[
										dimension
									].find((entry) => entry.id === id)?.label ?? id;
								return (
									<button
										type="button"
										key={`${dimension}:${id}`}
										className="cost-filter-chip"
										onClick={() => toggle(dimension, id)}
										title={`${COST_LABELS[dimension]}: ${costLabel(dimension, label) || "Unattributed"}`}
										aria-label={`Remove ${COST_LABELS[dimension].toLowerCase()} filter ${costLabel(dimension, label)}`}
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
			<div className="cost-page-scroll">
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
