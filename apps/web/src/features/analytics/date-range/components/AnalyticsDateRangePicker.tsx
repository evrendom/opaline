"use client";

import {
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	ArrowUp01Icon,
	Calendar03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useRef, useState } from "react";
import type { ChevronProps, DateRange } from "react-day-picker";
import { Button } from "@/app/ui/button";
import { Calendar } from "@/app/ui/calendar";
import { Popover, PopoverTrigger } from "@/app/ui/popover";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { SessionMenuPopoverContent } from "@/features/sessions/components/session-menu-popover-content";
import "./analytics-date-range-picker.css";
import { getSupportedAnalyticsDateRange } from "@/lib/analytics-date-range";
import { formatIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	formatDashboardDateRangeTriggerLabel,
	getAnalyticsDatePresets,
	parseIsoDateOnly,
	resolveMatchingAnalyticsPreset,
} from "../date-presets";

export type AnalyticsDateRangePickerProps = {
	startDate: string;
	endDate: string;
	onDateRangeApply: (startDate: string, endDate: string) => void;
	triggerClassName?: string;
	contentClassName?: string;
	align?: "start" | "center" | "end";
	sourceComponent?: string;
	variant?: "default" | "linear";
};

function LinearCalendarChevron({
	className,
	orientation = "right",
	size = 16,
}: ChevronProps) {
	const icon =
		orientation === "left"
			? ArrowLeft01Icon
			: orientation === "up"
				? ArrowUp01Icon
				: orientation === "down"
					? ArrowDown01Icon
					: ArrowRight01Icon;
	return (
		<HugeiconsIcon
			aria-hidden="true"
			icon={icon}
			size={size}
			strokeWidth={1.75}
			className={cn("session-menu-icon size-4", className)}
		/>
	);
}

function getValidDateRange(
	startDate: string,
	endDate: string,
): DateRange | undefined {
	const fromDate = parseIsoDateOnly(startDate);
	const toDate = parseIsoDateOnly(endDate);

	if (!fromDate || !toDate) {
		return undefined;
	}

	return {
		from: fromDate,
		to: toDate,
	};
}

export function AnalyticsDateRangePicker({
	startDate,
	endDate,
	onDateRangeApply,
	triggerClassName,
	contentClassName,
	align = "end",
	sourceComponent,
	variant = "default",
}: AnalyticsDateRangePickerProps) {
	const { trackFilterChange } = useAnalyticsTracking();
	const [open, setOpen] = useState(false);
	const popoverScrollRegionRef = useRef<HTMLDivElement>(null);
	const popoverElementRef = useRef<HTMLDivElement>(null);
	const wheelHandlerRef = useRef((event: WheelEvent) => {
		const scrollRegion = popoverScrollRegionRef.current;
		if (!scrollRegion) {
			return;
		}

		event.stopPropagation();
		const hasVerticalOverflow =
			scrollRegion.scrollHeight > scrollRegion.clientHeight + 1;
		const isScrollingUp = event.deltaY < 0;
		const isScrollingDown = event.deltaY > 0;
		const isAtTop = scrollRegion.scrollTop <= 0;
		const isAtBottom =
			scrollRegion.scrollTop + scrollRegion.clientHeight >=
			scrollRegion.scrollHeight - 1;
		const isHorizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY);

		if (
			!hasVerticalOverflow ||
			isHorizontalGesture ||
			(isScrollingUp && isAtTop) ||
			(isScrollingDown && isAtBottom) ||
			(!isScrollingUp && !isScrollingDown)
		) {
			event.preventDefault();
		}
	});
	const today = new Date();
	const supportedDateRange = getSupportedAnalyticsDateRange(today);
	const selectedDateRange = useMemo(
		() => getValidDateRange(startDate, endDate),
		[endDate, startDate],
	);
	const [draftDateRange, setDraftDateRange] = useState<DateRange | undefined>(
		selectedDateRange,
	);
	const presets = getAnalyticsDatePresets();
	const activePresetId =
		resolveMatchingAnalyticsPreset(startDate, endDate, today)?.id ?? null;
	const canApplyRange = Boolean(draftDateRange?.from && draftDateRange.to);
	const displayValue =
		selectedDateRange?.from && selectedDateRange.to
			? formatDashboardDateRangeTriggerLabel(startDate, endDate)
			: "Pick a date";
	const analyticsSourceComponent =
		sourceComponent ?? "analytics_date_range_picker";
	const isLinear = variant === "linear";

	function resetDraftDateRange() {
		setDraftDateRange(selectedDateRange);
	}

	function setPopoverElement(node: HTMLDivElement | null) {
		const previousNode = popoverElementRef.current;
		if (previousNode === node) {
			return;
		}

		previousNode?.removeEventListener("wheel", wheelHandlerRef.current);
		popoverElementRef.current = node;
		node?.addEventListener("wheel", wheelHandlerRef.current, {
			passive: false,
		});
	}

	function handlePresetApply(
		resolvedStartDate: string,
		resolvedEndDate: string,
		valueKey: string,
		changeAction: string,
	) {
		trackFilterChange({
			filterName: "date_range",
			filterCategory: "date",
			changeAction,
			sourceComponent: analyticsSourceComponent,
			valueKey,
			affectedScope: "page",
		});
		onDateRangeApply(resolvedStartDate, resolvedEndDate);
		setOpen(false);
	}

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				resetDraftDateRange();
			}}
		>
			<PopoverTrigger
				render={
					<Button
						variant="outline"
						size="sm"
						className={cn(
							"h-9 justify-start rounded-full border-border bg-background/90 px-3 text-sm font-medium text-foreground shadow-none",
							triggerClassName,
						)}
					/>
				}
			>
				<HugeiconsIcon
					aria-hidden="true"
					data-icon="inline-start"
					className="size-4"
					icon={Calendar03Icon}
					strokeWidth={1.75}
				/>
				{displayValue}
			</PopoverTrigger>
			<SessionMenuPopoverContent
				ref={setPopoverElement}
				align={align}
				sideOffset={6}
				data-slot="popover-content"
				aria-label="Date range"
				className={cn(
					"session-menu-surface session-date-picker",
					contentClassName,
				)}
			>
				<form
					className="flex min-h-0 flex-col overflow-hidden"
					onSubmit={(event) => {
						event.preventDefault();
						applyDraftDateRange();
					}}
				>
					<div
						ref={popoverScrollRegionRef}
						data-linear-calendar-scroll-region=""
						className="flex min-h-0 flex-col overflow-y-auto overscroll-contain md:flex-row"
					>
						<div
							data-fluid-menu-root=""
							className="session-menu-list session-date-picker-presets"
						>
							<FluidMenuHover />
							{presets.map((preset) => {
								const isActive = preset.id === activePresetId;

								return (
									<button
										key={preset.id}
										type="button"
										aria-pressed={isActive}
										className="session-menu-row"
										onClick={() => applyPreset(preset)}
									>
										<span className="truncate">{preset.label}</span>
									</button>
								);
							})}
						</div>
						<div className="session-date-picker-divider" aria-hidden="true" />
						<div className="session-date-picker-calendar-panel">
							{renderCalendar(isLinear)}
						</div>
					</div>
					<div className="session-date-picker-footer">
						<div
							data-fluid-menu-root=""
							className="session-date-picker-actions"
						>
							<FluidMenuHover />
							{renderFooterButtons()}
						</div>
					</div>
				</form>
			</SessionMenuPopoverContent>
		</Popover>
	);

	function applyPreset(preset: (typeof presets)[number]) {
		const resolvedRange = preset.resolveRange(today);
		handlePresetApply(
			resolvedRange.startDate,
			resolvedRange.endDate,
			preset.id,
			"preset",
		);
	}

	function applyDraftDateRange() {
		if (!draftDateRange?.from || !draftDateRange.to) {
			return;
		}

		handlePresetApply(
			formatIsoDate(draftDateRange.from),
			formatIsoDate(draftDateRange.to),
			"custom",
			"set",
		);
	}

	function renderCalendar(linear: boolean) {
		return (
			<Calendar
				mode="range"
				defaultMonth={draftDateRange?.from}
				selected={draftDateRange}
				onSelect={setDraftDateRange}
				today={today}
				weekStartsOn={linear ? 1 : undefined}
				showOutsideDays={!linear}
				numberOfMonths={2}
				fixedWeeks={linear}
				data-date-picker={linear ? "true" : undefined}
				data-multiple-months={linear ? "true" : undefined}
				components={{ Chevron: LinearCalendarChevron }}
				modifiers={linear ? { day_weekends: { dayOfWeek: [0, 6] } } : undefined}
				modifiersClassNames={
					linear
						? {
								day_weekends: "rdp-day_weekends",
							}
						: undefined
				}
				className="bg-transparent session-date-picker-calendar"
				classNames={{
					button_next: "session-date-picker-nav-button",
					button_previous: "session-date-picker-nav-button",
					caption_label: "session-date-picker-month-label",
					month: "flex min-w-0 flex-1 flex-col gap-2.5",
					month_caption: "flex h-8 w-full items-center justify-start px-0",
					months: "relative flex flex-col gap-5 md:flex-row md:gap-[0.96rem]",
					nav: "absolute top-0 right-0 z-20 flex items-center gap-0.5",
					week: "mt-1 flex w-full",
					weekday: "session-date-picker-weekday",
				}}
				disabled={(date) =>
					date < supportedDateRange.start || date > supportedDateRange.end
				}
			/>
		);
	}

	function renderFooterButtons() {
		return (
			<>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="session-date-picker-action session-date-picker-cancel"
					onClick={() => {
						resetDraftDateRange();
						setOpen(false);
					}}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					size="sm"
					className="session-date-picker-action session-date-picker-apply"
					disabled={!canApplyRange}
				>
					Apply
				</Button>
			</>
		);
	}
}
