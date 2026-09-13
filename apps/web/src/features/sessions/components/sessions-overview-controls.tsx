import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { SessionsOverviewFiltersMenu } from "./sessions-overview-filters-menu";
import { SessionsOverviewSortMenu } from "./sessions-overview-sort-menu";
import type { useSessionsOverviewTableState } from "./use-sessions-overview-table-state";

export function SessionsOverviewControls({
	tableState,
	inert = false,
}: {
	tableState: ReturnType<typeof useSessionsOverviewTableState>;
	inert?: boolean;
}) {
	return (
		<div
			inert={inert}
			data-slot="sessions-overview-controls"
			className="pointer-events-auto flex shrink-0 items-center gap-1"
		>
			<DashboardDateControls
				className="h-7 shrink-0 gap-1.5 rounded-md border-0 bg-(--session-overview-surface) py-1 pr-2 pl-1.5 text-base font-medium tracking-[-0.01em] text-(--session-overview-text) shadow-[0_0_0_0.5px_transparent_inset,0_0_0_0.5px_#0000000f,0_1px_1px_-1px_#0000001a,0_1px_2px_0_#0000000d] outline-none hover:bg-(--session-overview-hover) focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--session-overview-accent) has-data-[icon=inline-start]:pl-1.5 aria-expanded:bg-(--session-overview-hover) sm:h-7 sm:text-sm dark:bg-(--session-overview-surface) dark:shadow-[0_0_0_0.5px_#ffffff12_inset,0_0_0_0.5px_transparent,0_1px_1px_-1px_transparent,0_1px_2px_0_transparent] dark:hover:bg-(--session-overview-hover) [&_svg]:size-4 [&_svg]:h-lh [&_svg]:text-[#5d5d5d] dark:[&_svg]:text-[#acaeb2]"
				sourceComponent="sessions_date_picker"
			/>
			<SessionsOverviewSortMenu
				activeSortLabel={tableState.activeSortLabel}
				onSortChange={tableState.changeSort}
				sort={tableState.sort}
			/>
			<SessionsOverviewFiltersMenu
				variant="linear"
				excludedFilterValues={tableState.excludedFilterValues}
				filterOptions={tableState.filterOptions}
				onClearAll={tableState.clearAllFilters}
				onClearFilter={tableState.clearFilter}
				onClearRangeFilter={tableState.clearRangeFilter}
				onFilterOptionChecked={tableState.setFilterOptionChecked}
				onRangeFilterChange={tableState.setRangeFilter}
				rangeFilterBounds={tableState.rangeFilterBounds}
				rangeFilterValues={tableState.rangeFilterValues}
			/>
		</div>
	);
}
