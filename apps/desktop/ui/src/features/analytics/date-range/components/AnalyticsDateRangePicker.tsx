"use client";

import {
	IconCalendar,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronUp,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import type { ChevronProps, DateRange } from "react-day-picker";
import { Button } from "@/app/ui/button";
import { Calendar } from "@/app/ui/calendar";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { Popover, PopoverTrigger } from "@/app/ui/popover";
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
	maxDays?: number;
	startDate: string;
	endDate: string;
	onDateRangeApply: (startDate: string, endDate: string) => void;
	triggerClassName?: string;
	triggerSuffix?: string;
	compact?: boolean;
	contentClassName?: string;
	calendarControls?: ReactNode;
	align?: "start" | "center" | "end";
	variant?: "default" | "linear";
};

function LinearCalendarChevron({
	className,
	orientation = "right",
	size = 16,
}: ChevronProps) {
	const Glyph =
		orientation === "left"
			? IconChevronLeft
			: orientation === "up"
				? IconChevronUp
				: orientation === "down"
					? IconChevronDown
					: IconChevronRight;
	return (
		<Glyph
			aria-hidden="true"
			size={size}
			stroke={1.75}
			className={cn("menu-icon size-4", className)}
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
	maxDays = 365,
	startDate,
	endDate,
	onDateRangeApply,
	triggerClassName,
	triggerSuffix,
	compact = false,
	contentClassName,
	calendarControls,
	align = "end",
	variant = "default",
}: AnalyticsDateRangePickerProps) {
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
	const supportedDateRange = getSupportedAnalyticsDateRange(today, maxDays);
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
			? formatDashboardDateRangeTriggerLabel(startDate, endDate, today)
			: "Pick a date";
	const shownValue = compact
		? displayValue
				.replace(/,\s*\d{4}/g, "")
				.replace(/\s+-\s+/, "–")
				.replace(/^(\p{L}+) (\d+)–\1 (\d+)$/u, "$1 $2–$3")
		: displayValue;
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
	) {
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
						type="button"
						variant="toolbar"
						data-active
						className={triggerClassName}
					/>
				}
			>
				{compact ? null : (
					<IconCalendar
						aria-hidden="true"
						data-icon="inline-start"
						className="size-4"
					/>
				)}
				{triggerSuffix && !compact
					? `${shownValue} · ${triggerSuffix}`
					: shownValue}
			</PopoverTrigger>
			<SessionMenuPopoverContent
				ref={setPopoverElement}
				align={align}
				sideOffset={6}
				data-slot="popover-content"
				aria-label="Date range"
				className={cn("menu-surface session-date-picker", contentClassName)}
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
							className="menu-list session-date-picker-presets"
						>
							<FluidMenuHover />
							{presets.map((preset) => {
								const isActive = preset.id === activePresetId;

								return (
									<button
										key={preset.id}
										type="button"
										aria-pressed={isActive}
										className="menu-row"
										onClick={() => applyPreset(preset)}
									>
										<span className="truncate">{preset.label}</span>
									</button>
								);
							})}
						</div>
						<div className="session-date-picker-divider" aria-hidden="true" />
						{calendarControls ? (
							<>
								{calendarControls}
								<div
									className="session-date-picker-divider"
									aria-hidden="true"
								/>
							</>
						) : null}
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
		handlePresetApply(resolvedRange.startDate, resolvedRange.endDate);
	}

	function applyDraftDateRange() {
		if (!draftDateRange?.from || !draftDateRange.to) {
			return;
		}

		handlePresetApply(
			formatIsoDate(draftDateRange.from),
			formatIsoDate(draftDateRange.to),
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
				weekStartsOn={1}
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
					month: "flex min-w-0 flex-1 flex-col gap-m",
					month_caption: "flex h-8 w-full items-center justify-center px-zero",
					months: "relative flex flex-col gap-xl md:flex-row",
					// Layout: the arrows at the outer edges of the months.
					nav: "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between *:pointer-events-auto",
					week: "mt-xs flex w-full",
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
					variant="quiet"
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
