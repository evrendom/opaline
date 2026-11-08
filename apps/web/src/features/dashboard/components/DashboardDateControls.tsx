"use client";

import {
	AnalyticsDateRangePicker,
	type AnalyticsDateRangePickerProps,
} from "@/features/analytics/date-range/components/AnalyticsDateRangePicker";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";

export function DashboardDateControls({
	className,
	sourceComponent = "dashboard_date_picker",
	variant,
	calendarControls,
	triggerSuffix,
	compact,
}: {
	className?: string;
	sourceComponent?: string;
	variant?: AnalyticsDateRangePickerProps["variant"];
	calendarControls?: AnalyticsDateRangePickerProps["calendarControls"];
	triggerSuffix?: AnalyticsDateRangePickerProps["triggerSuffix"];
	compact?: boolean;
}) {
	const { state, actions, meta } = useDateRange();

	return (
		<AnalyticsDateRangePicker
			maxDays={meta.maxDays}
			startDate={state.startDate}
			endDate={state.endDate}
			onDateRangeApply={actions.setDateRange}
			align="end"
			sourceComponent={sourceComponent}
			variant={variant}
			calendarControls={calendarControls}
			triggerSuffix={triggerSuffix}
			compact={compact}
			triggerClassName={className}
		/>
	);
}
