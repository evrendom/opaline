import type { ReactNode } from "react";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { SessionsFocusedDayTag } from "./sessions-focused-day-tag";
import { SessionsOverviewFiltersMenu } from "./sessions-overview-filters-menu";
import { SessionsOverviewSortMenu } from "./sessions-overview-sort-menu";
import type { useSessionsOverviewTableState } from "./use-sessions-overview-table-state";

export function SessionsOverviewControls({
	tableState,
	inert = false,
	showDateControl = true,
	toolbarStart,
}: {
	tableState: ReturnType<typeof useSessionsOverviewTableState>;
	inert?: boolean;
	showDateControl?: boolean;
	/** Leads the toolbar, before sorting, such as a search field. */
	toolbarStart?: ReactNode;
}) {
	return (
		<div
			inert={inert}
			data-slot="sessions-overview-controls"
			className="pointer-events-none flex min-w-0 flex-1 items-center gap-2 *:pointer-events-auto"
		>
			{toolbarStart}
			<SessionsOverviewSortMenu
				activeSortLabel={tableState.activeSortLabel}
				onSortChange={tableState.changeSort}
				sort={tableState.sort}
			/>
			{tableState.filterCatalogError && !tableState.filterCatalogPending ? (
				<button
					type="button"
					onClick={tableState.onRetryFilterCatalog}
					className="rounded-md px-2 py-1 text-sm hover:bg-(--session-overview-hover)"
				>
					Retry filters
				</button>
			) : (
				<SessionsOverviewFiltersMenu
					variant="linear"
					isLoading={tableState.filterCatalogPending}
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
			)}
			<SessionsFocusedDayTag />
			{/* The range control trails at the toolbar's right. */}
			{showDateControl ? (
				<div className="ml-auto in-data-rail-beside:hidden">
					<DashboardDateControls sourceComponent="sessions_date_picker" />
				</div>
			) : null}
		</div>
	);
}
