import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Button } from "@/app/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@/app/ui/popover";
import { TouchTarget } from "@/app/ui/touch-target";
import { FilterTriggerLabel } from "@/components/filter-trigger-label";
import { SessionOverviewFilterOptionsPanel } from "@/features/sessions/components/sessions-overview-filter-menu";
import {
	formatSessionOverviewRangeValue,
	getToolbarFilterSummary,
	isToolbarFilterActive,
} from "@/features/sessions/components/sessions-overview-filter-state";
import { SessionOverviewLinearFilterFlyout } from "@/features/sessions/components/sessions-overview-linear-filter-flyout";
import {
	LinearActiveFiltersButton,
	LinearFilterList,
} from "@/features/sessions/components/sessions-overview-linear-filter-menu";
import {
	SessionOverviewRangeFilterPanel,
	SessionOverviewTokenRangeFilterPanel,
} from "@/features/sessions/components/sessions-overview-range-filter-menu";
import type {
	SessionOverviewExcludedFilterValues,
	SessionOverviewFilterKey,
	SessionOverviewFilterOption,
	SessionOverviewRangeBounds,
	SessionOverviewRangeFilter,
	SessionOverviewRangeFilterKey,
	SessionOverviewRangeFilterValues,
} from "@/features/sessions/components/sessions-overview-table-utils";
import { SESSION_OVERVIEW_TOOLBAR_FILTERS } from "@/features/sessions/components/sessions-overview-toolbar-filters";
import { useSessionOverviewFilterWheelContainment } from "@/features/sessions/components/use-session-overview-filter-wheel-containment";
import { cn } from "@/lib/utils";
import { SessionMenuPopoverContent } from "./session-menu-popover-content";

type SelectedFilterKey =
	| SessionOverviewFilterKey
	| SessionOverviewRangeFilterKey
	| "tokens"
	| null;

export function SessionsOverviewFiltersMenu({
	excludedFilterValues,
	filterOptions,
	iconOnly = false,
	isLoading = false,
	variant = "default",
	onClearAll,
	onClearFilter,
	onClearRangeFilter,
	onFilterOptionChecked,
	onRangeFilterChange,
	rangeFilterBounds,
	rangeFilterValues,
}: {
	excludedFilterValues: SessionOverviewExcludedFilterValues;
	filterOptions: Record<
		SessionOverviewFilterKey,
		readonly SessionOverviewFilterOption[]
	>;
	iconOnly?: boolean;
	isLoading?: boolean;
	variant?: "default" | "linear";
	onClearAll: () => void;
	onClearFilter: (filterKey: SessionOverviewFilterKey) => void;
	onClearRangeFilter: (filterKey: SessionOverviewRangeFilterKey) => void;
	onFilterOptionChecked: (
		filterKey: SessionOverviewFilterKey,
		value: string,
		checked: boolean,
	) => void;
	onRangeFilterChange: (
		filterKey: SessionOverviewRangeFilterKey,
		value: SessionOverviewRangeFilter,
	) => void;
	rangeFilterBounds: SessionOverviewRangeBounds;
	rangeFilterValues: SessionOverviewRangeFilterValues;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [selectedFilterKey, setSelectedFilterKey] =
		useState<SelectedFilterKey>(null);
	const [linearFlyoutAnchor, setLinearFlyoutAnchor] =
		useState<HTMLButtonElement | null>(null);
	const Content =
		variant === "linear" ? SessionMenuPopoverContent : PopoverContent;
	const { menuRef: linearMenuRef, setMenuElement: setLinearMenuElement } =
		useSessionOverviewFilterWheelContainment();
	const linearFlyoutCloseTimerRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const rangeInteractionRef = useRef(false);
	const keepRangeFlyoutOpenRef = useRef(false);
	const selectedFilter = SESSION_OVERVIEW_TOOLBAR_FILTERS.find(
		(filter) => filter.key === selectedFilterKey,
	);
	const activeFilterCount = SESSION_OVERVIEW_TOOLBAR_FILTERS.reduce(
		(count, filter) =>
			count +
			(isToolbarFilterActive(filter, excludedFilterValues, rangeFilterValues)
				? 1
				: 0),
		0,
	);
	const triggerLabel =
		activeFilterCount > 0
			? `Filter sessions, ${activeFilterCount} active`
			: "Filter sessions";

	function cancelLinearFlyoutClose() {
		if (linearFlyoutCloseTimerRef.current !== null) {
			clearTimeout(linearFlyoutCloseTimerRef.current);
			linearFlyoutCloseTimerRef.current = null;
		}
	}

	function scheduleLinearFlyoutClose() {
		cancelLinearFlyoutClose();
		if (rangeInteractionRef.current || keepRangeFlyoutOpenRef.current) {
			return;
		}
		linearFlyoutCloseTimerRef.current = setTimeout(() => {
			setSelectedFilterKey(null);
			linearFlyoutCloseTimerRef.current = null;
		}, 250);
	}

	function startRangeInteraction() {
		rangeInteractionRef.current = true;
		keepRangeFlyoutOpenRef.current = true;
		cancelLinearFlyoutClose();
	}

	function enterLinearMenu() {
		cancelLinearFlyoutClose();
		// After release outside, re-entering restores the usual hover-close behavior.
		if (!rangeInteractionRef.current) keepRangeFlyoutOpenRef.current = false;
	}

	function endRangeInteraction() {
		rangeInteractionRef.current = false;
	}

	useMountEffect(() => cancelLinearFlyoutClose);

	return (
		<Popover
			open={isOpen}
			onOpenChange={(nextOpen, eventDetails) => {
				if (!nextOpen && rangeInteractionRef.current) {
					eventDetails.cancel();
					return;
				}
				setIsOpen(nextOpen);
				if (!nextOpen) {
					keepRangeFlyoutOpenRef.current = false;
					cancelLinearFlyoutClose();
					setSelectedFilterKey(null);
				}
			}}
		>
			<PopoverTrigger
				type="button"
				disabled={isLoading}
				aria-busy={isLoading || undefined}
				aria-label={triggerLabel}
				title={triggerLabel}
				data-active={activeFilterCount > 0 || undefined}
				render={
					<Button variant="toolbar" size={iconOnly ? "icon" : "default"} />
				}
			>
				<FilterTriggerLabel
					activeCount={activeFilterCount}
					iconOnly={iconOnly}
				/>

				<TouchTarget />
			</PopoverTrigger>
			{variant === "linear" && iconOnly && activeFilterCount > 0 ? (
				<LinearActiveFiltersButton
					count={activeFilterCount}
					onClick={() => {
						setSelectedFilterKey(null);
						setIsOpen(true);
					}}
				/>
			) : null}
			<Content
				align="start"
				sideOffset={6}
				initialFocus={
					variant === "linear"
						? () => linearMenuRef.current?.parentElement
						: undefined
				}
				onMouseEnter={() => {
					if (variant === "linear") {
						enterLinearMenu();
					}
				}}
				onMouseLeave={(event) => {
					if (
						variant === "linear" &&
						event.buttons === 0 &&
						!rangeInteractionRef.current
					) {
						scheduleLinearFlyoutClose();
					}
				}}
				onKeyDown={(event) => {
					if (variant !== "linear" || !(event.target instanceof HTMLElement))
						return;
					const menu = linearMenuRef.current;
					if (!menu) return;
					const flyout = event.target.closest(".menu-flyout");
					if (event.key === "ArrowLeft" && flyout) {
						event.preventDefault();
						linearFlyoutAnchor?.focus();
						setSelectedFilterKey(null);
						return;
					}
					if (event.key === "ArrowRight" && !flyout && selectedFilter) {
						event.preventDefault();
						menu
							.querySelector<HTMLElement>(
								".menu-flyout input, .menu-flyout [role=slider]",
							)
							?.focus();
						return;
					}
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						// Range inputs keep their native arrow-key behavior.
						if (event.target.closest('[role="slider"]')) return;
						const items = Array.from(
							(flyout ?? menu).querySelectorAll<HTMLElement>(
								flyout ? 'input[type="checkbox"]' : ".menu-list > ul button",
							),
						);
						if (items.length === 0) return;
						event.preventDefault();
						const current = items.indexOf(event.target);
						const next =
							current < 0
								? event.key === "ArrowDown"
									? 0
									: items.length - 1
								: (current +
										(event.key === "ArrowDown" ? 1 : -1) +
										items.length) %
									items.length;
						items[next]?.focus();
						return;
					}
				}}
				className={cn(
					"gap-zero",
					variant === "linear"
						? "menu-popover"
						: cn(
								"w-80 corner-l p-zero",
								selectedFilter !== undefined &&
									selectedFilter.kind !== "options"
									? "overflow-visible"
									: "overflow-hidden",
							),
				)}
			>
				{variant === "linear" ? (
					<PopoverTitle className="sr-only">Session filters</PopoverTitle>
				) : null}
				{variant === "linear" ? (
					<div ref={setLinearMenuElement} className="menu-surface menu-parent">
						<LinearFilterList
							activeFilterKey={selectedFilterKey}
							filters={SESSION_OVERVIEW_TOOLBAR_FILTERS}
							getFilterSummary={(filter) =>
								isToolbarFilterActive(
									filter,
									excludedFilterValues,
									rangeFilterValues,
								)
									? getToolbarFilterSummary(
											filter,
											excludedFilterValues,
											rangeFilterBounds,
											rangeFilterValues,
										)
									: null
							}
							isFilterActive={(filter) =>
								isToolbarFilterActive(
									filter,
									excludedFilterValues,
									rangeFilterValues,
								)
							}
							onActivate={(filterKey, row) => {
								if (rangeInteractionRef.current) return;
								keepRangeFlyoutOpenRef.current = false;
								setSelectedFilterKey(filterKey);
								setLinearFlyoutAnchor(row);
							}}
						/>
						{activeFilterCount > 0 ? (
							<div className="menu-footer">
								<div aria-hidden="true" className="menu-separator" />
								<button
									type="button"
									aria-label="Clear all filters"
									className="menu-row"
									onClick={onClearAll}
								>
									Clear all
								</button>
							</div>
						) : null}
						{selectedFilter ? (
							<SessionOverviewLinearFilterFlyout
								key={selectedFilter.key}
								excludedFilterValues={excludedFilterValues}
								filter={selectedFilter}
								filterOptions={filterOptions}
								onFilterOptionChecked={onFilterOptionChecked}
								onInteractionEnd={endRangeInteraction}
								onInteractionStart={startRangeInteraction}
								onMouseEnter={enterLinearMenu}
								onRangeFilterChange={onRangeFilterChange}
								rangeFilterBounds={rangeFilterBounds}
								rangeFilterValues={rangeFilterValues}
								anchor={linearFlyoutAnchor}
							/>
						) : null}
					</div>
				) : (
					<>
						<div
							className={cn(
								"flex h-11 items-center justify-between gap-m",
								"edge-b-m px-l",
								"border-line/60",
							)}
						>
							<div className="flex min-w-0 items-center gap-s">
								{selectedFilter ? (
									<button
										type="button"
										aria-label="Back to all filters"
										className="relative flex size-7 shrink-0 items-center justify-center corner-s text-ink-3 outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40"
										onClick={() => setSelectedFilterKey(null)}
									>
										<IconArrowLeft aria-hidden="true" className="size-4" />
										<TouchTarget className="size-12" />
									</button>
								) : null}
								<PopoverTitle className="truncate text-body-xl font-heavy">
									{selectedFilter ? selectedFilter.label : "Filters"}
								</PopoverTitle>
							</div>
							<button
								type="button"
								aria-label={
									selectedFilter
										? `Clear ${selectedFilter.label} filter`
										: "Clear all filters"
								}
								className="shrink-0 corner-s px-s py-xs text-body-m font-medium text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus/40 disabled:pointer-events-none disabled:opacity-40"
								disabled={
									selectedFilter
										? !isToolbarFilterActive(
												selectedFilter,
												excludedFilterValues,
												rangeFilterValues,
											)
										: activeFilterCount === 0
								}
								onClick={() => {
									if (!selectedFilter) {
										onClearAll();
										return;
									}

									if (selectedFilter.kind === "options") {
										onClearFilter(selectedFilter.key);
									} else if (selectedFilter.kind === "token-ranges") {
										onClearRangeFilter("input");
										onClearRangeFilter("output");
									} else {
										onClearRangeFilter(selectedFilter.key);
									}
								}}
							>
								{selectedFilter ? "Clear" : "Clear all"}
							</button>
						</div>

						{selectedFilter ? (
							selectedFilter.kind === "options" ? (
								<SessionOverviewFilterOptionsPanel
									key={selectedFilter.key}
									excludedValues={excludedFilterValues[selectedFilter.key]}
									label={selectedFilter.label}
									onOptionChecked={(value, checked) =>
										onFilterOptionChecked(selectedFilter.key, value, checked)
									}
									options={filterOptions[selectedFilter.key]}
								/>
							) : selectedFilter.kind === "token-ranges" ? (
								<SessionOverviewTokenRangeFilterPanel
									onChange={onRangeFilterChange}
									onInteractionEnd={endRangeInteraction}
									onInteractionStart={startRangeInteraction}
									rangeFilterBounds={rangeFilterBounds}
									rangeFilterValues={rangeFilterValues}
								/>
							) : (
								<SessionOverviewRangeFilterPanel
									bounds={rangeFilterBounds[selectedFilter.key]}
									formatValue={(value) =>
										formatSessionOverviewRangeValue(selectedFilter.key, value)
									}
									label={selectedFilter.label}
									onChange={(value) =>
										onRangeFilterChange(selectedFilter.key, value)
									}
									onInteractionEnd={endRangeInteraction}
									onInteractionStart={startRangeInteraction}
									value={rangeFilterValues[selectedFilter.key]}
								/>
							)
						) : (
							<div className="max-h-96 overflow-y-auto p-s">
								{SESSION_OVERVIEW_TOOLBAR_FILTERS.map((filter) => {
									const isActive = isToolbarFilterActive(
										filter,
										excludedFilterValues,
										rangeFilterValues,
									);

									return (
										<button
											key={filter.key}
											type="button"
											aria-label={`Configure ${filter.label} filter`}
											className="flex min-h-9 w-full items-center gap-l corner-m px-l py-s text-left text-body-xl font-medium outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-focus/40"
											onClick={() => setSelectedFilterKey(filter.key)}
										>
											<span className="min-w-0 flex-1 truncate">
												{filter.label}
											</span>
											<span
												className={cn(
													"max-w-32 truncate text-body-m font-regular tabular-nums text-ink-3",
													isActive && "text-primary",
												)}
											>
												{getToolbarFilterSummary(
													filter,
													excludedFilterValues,
													rangeFilterBounds,
													rangeFilterValues,
												)}
											</span>
											<IconChevronRight
												aria-hidden="true"
												className="size-4 shrink-0 text-ink-3"
											/>
										</button>
									);
								})}
							</div>
						)}
					</>
				)}
			</Content>
		</Popover>
	);
}
