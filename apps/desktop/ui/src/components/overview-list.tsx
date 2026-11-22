import { IconUser } from "@tabler/icons-react";
import { type ReactNode, useRef, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import { FluidHoverHighlight } from "@/app/ui/fluid-hover-highlight";
import { Popover, PopoverTitle, PopoverTrigger } from "@/app/ui/popover";
import { FilterTriggerLabel } from "@/components/filter-trigger-label";
import { SessionMenuPopoverContent } from "@/features/sessions/components/session-menu-popover-content";
import { SessionMenuFlyoutSurface } from "@/features/sessions/components/sessions-overview-linear-filter-flyout";
import { LinearFilterList } from "@/features/sessions/components/sessions-overview-linear-filter-menu";
import { SessionOverviewRangeFilterPanel } from "@/features/sessions/components/sessions-overview-range-filter-menu";
import type { SessionOverviewRangeFilter } from "@/features/sessions/components/sessions-overview-table-utils";
import { useSessionOverviewFilterWheelContainment } from "@/features/sessions/components/use-session-overview-filter-wheel-containment";
import {
	type UseFluidHoverReturn,
	useFluidHover,
} from "@/hooks/use-fluid-hover";
import { cn } from "@/lib/utils";

// The two-line overview rows shared by Repos and Skills: a name over who uses
// it, with the metrics trailing in fixed tracks so they line up without
// column headers.
export const OVERVIEW_ROW_LEAD_CELL_CLASS_NAME =
	"flex min-w-0 items-center gap-l pr-l pl-[calc(var(--space-xl)+var(--space-xs))]";
export const OVERVIEW_METRIC_CELL_CLASS_NAME =
	"flex min-w-0 items-center justify-end px-l text-right text-body-m whitespace-nowrap tabular-nums text-ink-2";
export const OVERVIEW_METRIC_UNIT_CLASS_NAME = "text-ink-3";
export const OVERVIEW_ROW_CLASS_NAME =
	"grid h-16 w-full text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

export const compactNumber = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export type RangeBound = { minimum: number; maximum: number; step: number };

export type OverviewRangeFilter<TKey extends string> = {
	group: "identity" | "usage" | "activity";
	icon: Parameters<typeof LinearFilterList>[0]["filters"][number]["icon"];
	key: TKey;
	label: string;
};

/** A list whose rows share one hover highlight, as on the sessions page. */
export function OverviewList({
	label,
	minWidthClassName,
	children,
}: {
	label: string;
	minWidthClassName: string;
	children: (hover: UseFluidHoverReturn) => ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(containerRef, {
		axis: "y",
		gapClick: false,
		reflectActiveState: false,
	});
	return (
		<div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-none">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates hover and focus from the native row controls. */}
			<div
				ref={containerRef}
				className={cn("relative isolate", minWidthClassName)}
				{...hover.handlers}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget))
						hover.setActiveIndex(null);
				}}
			>
				<FluidHoverHighlight
					hover={hover}
					className="z-0 corner-zero bg-hover"
				/>
				{/* biome-ignore lint/a11y/useSemanticElements: An explicit role preserves this list in Safari with list-style none. */}
				<ul
					// biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari with list-style none.
					role="list"
					aria-label={label}
					className="relative list-none"
				>
					{children(hover)}
				</ul>
			</div>
		</div>
	);
}

/** The row's second line: the top members' avatars and names, "+N" for the
 * rest; a member count when none of them is known here. */
export function OverviewMembers({
	avatarMap,
	topUserIds,
	userCount,
	userMap,
}: {
	avatarMap: Record<string, string>;
	topUserIds: readonly string[];
	userCount: number;
	userMap: Record<string, string>;
}) {
	const names = topUserIds
		.map((userId) => userMap[userId])
		.filter((name): name is string => !!name);
	const hiddenCount = Math.max(0, userCount - names.length);
	return (
		<>
			<span className="flex shrink-0 -space-x-xs">
				{(topUserIds.length > 0 ? topUserIds : [""]).map((userId) => (
					<MemberAvatar key={userId} avatarUrl={avatarMap[userId]} />
				))}
			</span>
			<span className="min-w-0 truncate">
				{names.length > 0
					? `${names.join(", ")}${hiddenCount > 0 ? ` +${hiddenCount.toLocaleString()}` : ""}`
					: formatCount(userCount, "member", "members")}
			</span>
		</>
	);
}

function MemberAvatar({ avatarUrl }: { avatarUrl: string | undefined }) {
	return (
		<Avatar className="size-4 bg-canvas ring-1 ring-canvas after:border-line">
			{avatarUrl ? (
				<AvatarImage alt="" src={avatarUrl} decoding="async" loading="lazy" />
			) : null}
			<AvatarFallback className="bg-hover">
				<IconUser
					aria-hidden="true"
					className="size-2.5 shrink-0 text-ink-2"
				/>
			</AvatarFallback>
		</Avatar>
	);
}

/** The sessions toolbar's Filter menu with min/max ranges only. */
export function OverviewRangeFiltersMenu<TKey extends string>({
	bounds,
	disabled,
	filters,
	formatValue,
	noun,
	values,
	onChange,
	onClearAll,
}: {
	bounds: Record<TKey, RangeBound>;
	disabled: boolean;
	filters: readonly OverviewRangeFilter<TKey>[];
	formatValue: (key: TKey, value: number) => string;
	noun: string;
	values: Record<TKey, SessionOverviewRangeFilter>;
	onChange: (key: TKey, value: SessionOverviewRangeFilter) => void;
	onClearAll: () => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [selectedKey, setSelectedKey] = useState<TKey | null>(null);
	const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
	const { menuRef, setMenuElement } =
		useSessionOverviewFilterWheelContainment();
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rangeInteractionRef = useRef(false);
	const selectedFilter = filters.find((filter) => filter.key === selectedKey);
	const activeFilterCount = filters.filter((filter) =>
		isRangeFilterActive(values[filter.key]),
	).length;
	const triggerLabel =
		activeFilterCount > 0
			? `Filter ${noun}, ${activeFilterCount} active`
			: `Filter ${noun}`;

	function cancelClose() {
		if (closeTimerRef.current !== null) {
			clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	}

	function scheduleClose() {
		cancelClose();
		if (rangeInteractionRef.current) return;
		closeTimerRef.current = setTimeout(() => {
			setSelectedKey(null);
			closeTimerRef.current = null;
		}, 250);
	}

	useMountEffect(() => cancelClose);

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
					cancelClose();
					setSelectedKey(null);
				}
			}}
		>
			<PopoverTrigger
				type="button"
				disabled={disabled}
				aria-label={triggerLabel}
				title={triggerLabel}
				data-active={activeFilterCount > 0 || undefined}
				render={<Button variant="toolbar" />}
			>
				<FilterTriggerLabel activeCount={activeFilterCount} />
			</PopoverTrigger>
			<SessionMenuPopoverContent
				align="start"
				sideOffset={6}
				initialFocus={() => menuRef.current?.parentElement}
				onMouseEnter={cancelClose}
				onMouseLeave={(event) => {
					if (event.buttons === 0 && !rangeInteractionRef.current)
						scheduleClose();
				}}
				className="menu-popover gap-zero"
			>
				<PopoverTitle className="sr-only">{`Filter ${noun}`}</PopoverTitle>
				<div ref={setMenuElement} className="menu-surface menu-parent">
					<LinearFilterList
						activeFilterKey={selectedKey}
						filters={filters}
						getFilterSummary={(filter) =>
							isRangeFilterActive(values[filter.key])
								? `${formatValue(filter.key, values[filter.key].minimum ?? bounds[filter.key].minimum)}–${formatValue(filter.key, values[filter.key].maximum ?? bounds[filter.key].maximum)}`
								: null
						}
						isFilterActive={(filter) => isRangeFilterActive(values[filter.key])}
						onActivate={(filterKey, row) => {
							if (rangeInteractionRef.current) return;
							setSelectedKey(filterKey);
							setAnchor(row);
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
						<SessionMenuFlyoutSurface
							key={selectedFilter.key}
							anchor={anchor}
							kind="range"
							label={selectedFilter.label}
							onMouseEnter={cancelClose}
						>
							<SessionOverviewRangeFilterPanel
								bounds={bounds[selectedFilter.key]}
								formatValue={(value) => formatValue(selectedFilter.key, value)}
								label={selectedFilter.label}
								onChange={(value) => onChange(selectedFilter.key, value)}
								onInteractionEnd={() => {
									rangeInteractionRef.current = false;
								}}
								onInteractionStart={() => {
									rangeInteractionRef.current = true;
									cancelClose();
								}}
								value={values[selectedFilter.key]}
								variant="linear"
							/>
						</SessionMenuFlyoutSurface>
					) : null}
				</div>
			</SessionMenuPopoverContent>
		</Popover>
	);
}

export function buildRangeBound(
	values: readonly (number | null)[],
	step: number,
): RangeBound {
	const known = values.filter((value): value is number => value !== null);
	if (known.length === 0) return { minimum: 0, maximum: 0, step };
	return {
		minimum: Math.floor(Math.min(...known) / step) * step,
		maximum: Math.ceil(Math.max(...known) / step) * step,
		step,
	};
}

export function isRangeFilterActive(range: SessionOverviewRangeFilter) {
	return range.minimum !== null || range.maximum !== null;
}

export function matchesRangeFilter(
	value: number | null,
	range: SessionOverviewRangeFilter,
) {
	if (value === null) return !isRangeFilterActive(range);
	return (
		(range.minimum === null || value >= range.minimum) &&
		(range.maximum === null || value <= range.maximum)
	);
}

export function formatCount(count: number, singular: string, plural: string) {
	return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
