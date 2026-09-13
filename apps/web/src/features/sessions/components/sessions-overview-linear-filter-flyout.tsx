import { useLayoutEffect, useRef, useState } from "react";
import { SessionOverviewFilterOptionsPanel } from "@/features/sessions/components/sessions-overview-filter-menu";
import { formatSessionOverviewRangeValue } from "@/features/sessions/components/sessions-overview-filter-state";
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

type LinearFlyoutFilter =
	| {
			key: SessionOverviewFilterKey;
			kind: "options";
			label: string;
	  }
	| {
			key: SessionOverviewRangeFilterKey;
			kind: "range";
			label: string;
	  }
	| {
			key: "tokens";
			kind: "token-ranges";
			label: string;
	  };

export function SessionOverviewLinearFilterFlyout({
	excludedFilterValues,
	filter,
	filterOptions,
	onFilterOptionChecked,
	onInteractionEnd,
	onInteractionStart,
	onMouseEnter,
	onRangeFilterChange,
	rangeFilterBounds,
	rangeFilterValues,
	anchor,
}: {
	excludedFilterValues: SessionOverviewExcludedFilterValues;
	filter: LinearFlyoutFilter;
	filterOptions: Record<
		SessionOverviewFilterKey,
		readonly SessionOverviewFilterOption[]
	>;
	onFilterOptionChecked: (
		filterKey: SessionOverviewFilterKey,
		value: string,
		checked: boolean,
	) => void;
	onInteractionEnd: () => void;
	onInteractionStart: () => void;
	onMouseEnter: () => void;
	onRangeFilterChange: (
		filterKey: SessionOverviewRangeFilterKey,
		value: SessionOverviewRangeFilter,
	) => void;
	rangeFilterBounds: SessionOverviewRangeBounds;
	rangeFilterValues: SessionOverviewRangeFilterValues;
	anchor: HTMLButtonElement | null;
}) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({
		left: "calc(100% - 2px)",
		top: 0,
	});

	useLayoutEffect(() => {
		const surface = surfaceRef.current;
		const parent = surface?.parentElement;
		if (!surface || !parent || !anchor) return;
		function updatePosition() {
			if (!surface || !parent || !anchor || parent.offsetWidth === 0) return;
			const parentBounds = parent.getBoundingClientRect();
			const scale = parentBounds.width / parent.offsetWidth || 1;
			const parentBorder = Number.parseFloat(
				getComputedStyle(parent).borderTopWidth,
			);
			const childBorder = Number.parseFloat(
				getComputedStyle(surface).borderTopWidth,
			);
			const firstRowOffset =
				childBorder + (surface.dataset.kind === "options" ? 6 : 0);
			const rowTop =
				(anchor.getBoundingClientRect().top - parentBounds.top) / scale;
			const idealTop = rowTop - parentBorder - firstRowOffset;
			const minTop = (12 - parentBounds.top) / scale;
			const maxTop =
				(window.innerHeight - 12 - parentBounds.top) / scale -
				surface.offsetHeight;
			const top = Math.max(minTop, Math.min(idealTop, maxTop));
			const rightLeft = parent.offsetWidth - parentBorder - 2;
			const fitsRight =
				parentBounds.left + (rightLeft + surface.offsetWidth) * scale <=
				window.innerWidth - 12;
			const left = Math.max(
				(12 - parentBounds.left) / scale,
				fitsRight ? rightLeft : 2 - parentBorder - surface.offsetWidth,
			);
			surface.style.setProperty(
				"--session-menu-flyout-origin",
				`${fitsRight ? "0" : "100%"} ${rowTop - top}px`,
			);
			setPosition((previous) =>
				previous.left === `${left}px` && previous.top === top
					? previous
					: { left: `${left}px`, top },
			);
		}
		updatePosition();
		const observer = new ResizeObserver(updatePosition);
		observer.observe(surface);
		observer.observe(parent);
		parent.addEventListener("scroll", updatePosition, true);
		window.addEventListener("resize", updatePosition);
		return () => {
			observer.disconnect();
			parent.removeEventListener("scroll", updatePosition, true);
			window.removeEventListener("resize", updatePosition);
		};
	}, [anchor]);

	return (
		<div
			ref={surfaceRef}
			role="dialog"
			aria-label={`${filter.label} filter`}
			className="session-menu-surface session-menu-flyout"
			data-kind={filter.kind}
			style={position}
			onMouseEnter={onMouseEnter}
		>
			{filter.kind === "options" ? (
				<SessionOverviewFilterOptionsPanel
					key={filter.key}
					excludedValues={excludedFilterValues[filter.key]}
					label={filter.label}
					onOptionChecked={(value, checked) =>
						onFilterOptionChecked(filter.key, value, checked)
					}
					options={filterOptions[filter.key]}
					variant="linear-side"
				/>
			) : filter.kind === "token-ranges" ? (
				<SessionOverviewTokenRangeFilterPanel
					onChange={onRangeFilterChange}
					onInteractionEnd={onInteractionEnd}
					onInteractionStart={onInteractionStart}
					rangeFilterBounds={rangeFilterBounds}
					rangeFilterValues={rangeFilterValues}
					variant="linear"
				/>
			) : (
				<SessionOverviewRangeFilterPanel
					bounds={rangeFilterBounds[filter.key]}
					formatValue={(value) =>
						formatSessionOverviewRangeValue(filter.key, value)
					}
					label={filter.label}
					onChange={(value) => onRangeFilterChange(filter.key, value)}
					onInteractionEnd={onInteractionEnd}
					onInteractionStart={onInteractionStart}
					value={rangeFilterValues[filter.key]}
					variant="linear"
				/>
			)}
		</div>
	);
}
