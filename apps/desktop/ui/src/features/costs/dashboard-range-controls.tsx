import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { CHART_INTERVALS, type ChartInterval } from "./chart-interval";
import { ChartIntervalPicker } from "./chart-interval-picker";
import { useChartInterval } from "./use-chart-interval";

/** The dashboard's date range picker, with the chart interval beside its calendar. */
export function DashboardRangeControls({
	interval,
	onIntervalChange,
	inHeader,
	compact = false,
}: {
	interval: ChartInterval;
	onIntervalChange: (interval: ChartInterval) => void;
	inHeader: boolean;
	compact?: boolean;
}) {
	return (
		<div
			className="cost-range-controls"
			data-fluid-menu-root=""
			data-in-header={inHeader ? "" : undefined}
		>
			<FluidMenuHover items="button" />
			<DashboardDateControls
				compact={compact}
				triggerSuffix={
					CHART_INTERVALS.find((option) => option.value === interval)?.label
				}
				calendarControls={
					<ChartIntervalPicker value={interval} onChange={onIntervalChange} />
				}
			/>
		</div>
	);
}

/** The workspace dashboard's controls, as the shell header renders them. */
export function ShellDashboardRangeControls() {
	const [interval, setInterval] = useChartInterval();
	return (
		<DashboardRangeControls
			interval={interval}
			onIntervalChange={setInterval}
			inHeader
		/>
	);
}
