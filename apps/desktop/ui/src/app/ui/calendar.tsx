import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
} from "@tabler/icons-react";
import * as React from "react";
import {
	type DayButton,
	DayPicker,
	getDefaultClassNames,
	type Locale,
} from "react-day-picker";
import { Button, buttonVariants } from "@/app/ui/button";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { cn } from "@/lib/utils";

function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	captionLayout = "label",
	buttonVariant = "secondary",
	locale,
	formatters,
	components,
	...props
}: React.ComponentProps<typeof DayPicker> & {
	buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
	const defaultClassNames = getDefaultClassNames();

	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn(
				"group/calendar bg-canvas p-l [--cell-size:--spacing(8)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
				String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
				String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
				className,
			)}
			captionLayout={captionLayout}
			locale={locale}
			formatters={{
				formatMonthDropdown: (date) =>
					date.toLocaleString(locale?.code, { month: "short" }),
				...formatters,
			}}
			classNames={{
				root: cn("w-fit", defaultClassNames.root),
				months: cn(
					"relative flex flex-col gap-xl md:flex-row",
					defaultClassNames.months,
				),
				month: cn("flex w-full flex-col gap-xl", defaultClassNames.month),
				nav: cn(
					"absolute inset-x-0 top-0 flex w-full items-center justify-between gap-xs",
					defaultClassNames.nav,
				),
				button_previous: cn(
					buttonVariants({ variant: buttonVariant }),
					"size-(--cell-size) p-zero select-none aria-disabled:opacity-50",
					defaultClassNames.button_previous,
				),
				button_next: cn(
					buttonVariants({ variant: buttonVariant }),
					"size-(--cell-size) p-zero select-none aria-disabled:opacity-50",
					defaultClassNames.button_next,
				),
				month_caption: cn(
					"flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
					defaultClassNames.month_caption,
				),
				dropdowns: cn(
					"flex h-(--cell-size) w-full items-center justify-center gap-s text-body-xl font-medium",
					defaultClassNames.dropdowns,
				),
				dropdown_root: cn(
					"relative corner-full",
					defaultClassNames.dropdown_root,
				),
				dropdown: cn(
					"absolute inset-0 bg-surface opacity-0",
					defaultClassNames.dropdown,
				),
				caption_label: cn(
					"font-medium select-none",
					captionLayout === "label"
						? "text-body-xl"
						: "flex items-center gap-xs corner-full text-body-xl [&>svg]:size-3.5 [&>svg]:text-ink-3",
					defaultClassNames.caption_label,
				),
				table: "w-full border-collapse",
				weekdays: cn("flex", defaultClassNames.weekdays),
				weekday: cn(
					"flex-1 corner-full text-body-m font-regular text-ink-3 select-none",
					defaultClassNames.weekday,
				),
				week: cn("mt-m flex w-full", defaultClassNames.week),
				week_number_header: cn(
					"w-(--cell-size) select-none",
					defaultClassNames.week_number_header,
				),
				week_number: cn(
					"text-body-m text-ink-3 select-none",
					defaultClassNames.week_number,
				),
				day: cn(
					"group/day relative aspect-square h-full w-full corner-full p-zero text-center select-none [&:last-child[data-selected=true]_button]:corner-r-full",
					props.showWeekNumber
						? "[&:nth-child(2)[data-selected=true]_button]:corner-l-full"
						: "[&:first-child[data-selected=true]_button]:corner-l-full",
					defaultClassNames.day,
				),
				range_start: cn(
					"relative isolate z-0 corner-l-full bg-field after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-field",
					defaultClassNames.range_start,
				),
				range_middle: cn("corner-zero", defaultClassNames.range_middle),
				range_end: cn(
					"relative isolate z-0 corner-r-full bg-field after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-field",
					defaultClassNames.range_end,
				),
				today: cn(
					"corner-full bg-field text-ink data-[selected=true]:corner-zero",
					defaultClassNames.today,
				),
				outside: cn(
					"text-ink-3 aria-selected:text-ink-3",
					defaultClassNames.outside,
				),
				disabled: cn("text-ink-3 opacity-50", defaultClassNames.disabled),
				hidden: cn("invisible", defaultClassNames.hidden),
				...classNames,
			}}
			components={{
				Root: ({ className, rootRef, children, ...props }) => {
					return (
						<div
							data-slot="calendar"
							data-fluid-menu-root=""
							ref={rootRef}
							className={cn(className)}
							{...props}
						>
							<FluidMenuHover items="button" />
							{children}
						</div>
					);
				},
				Chevron: ({ className, orientation, ...props }) => {
					if (orientation === "left") {
						return (
							<IconChevronLeft className={cn("size-4", className)} {...props} />
						);
					}

					if (orientation === "right") {
						return (
							<IconChevronRight
								className={cn("size-4", className)}
								{...props}
							/>
						);
					}

					return (
						<IconChevronDown className={cn("size-4", className)} {...props} />
					);
				},
				DayButton: ({ ...props }) => (
					<CalendarDayButton locale={locale} {...props} />
				),
				WeekNumber: ({ children, ...props }) => {
					return (
						<td {...props}>
							<div className="flex size-(--cell-size) items-center justify-center text-center">
								{children}
							</div>
						</td>
					);
				},
				...components,
			}}
			{...props}
		/>
	);
}

function CalendarDayButton({
	className,
	day,
	modifiers,
	locale,
	...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
	const defaultClassNames = getDefaultClassNames();

	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		if (modifiers.focused) ref.current?.focus();
	}, [modifiers.focused]);

	return (
		<Button
			variant="secondary"
			size="icon"
			data-day={day.date.toLocaleDateString(locale?.code)}
			data-selected-single={
				modifiers.selected &&
				!modifiers.range_start &&
				!modifiers.range_end &&
				!modifiers.range_middle
			}
			data-range-start={modifiers.range_start}
			data-range-end={modifiers.range_end}
			data-range-middle={modifiers.range_middle}
			className={cn(
				"relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-xs",
				"edge-none",
				// set solid: day numbers sit in a square cell, their line box hugs the text
				"line-solid font-regular",
				"group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10",
				"data-[range-end=true]:corner-full data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-fg",
				"data-[range-middle=true]:corner-zero data-[range-middle=true]:bg-field data-[range-middle=true]:text-ink",
				"data-[range-start=true]:corner-full data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-fg",
				"data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-fg",
				"[&>span]:text-body-m [&>span]:opacity-70",
				defaultClassNames.day,
				className,
			)}
			{...props}
		/>
	);
}

export { Calendar };
