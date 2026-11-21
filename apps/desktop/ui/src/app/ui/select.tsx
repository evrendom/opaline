"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
	IconCheck,
	IconChevronDown,
	IconChevronUp,
	IconSelector,
} from "@tabler/icons-react";
import * as React from "react";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { cn } from "@/lib/utils";

function collectSelectItemLabels(
	children: React.ReactNode,
	labels: Record<string, React.ReactNode>,
) {
	React.Children.forEach(children, (child) => {
		if (!React.isValidElement(child)) return;
		const childProps = child.props as {
			value?: unknown;
			label?: React.ReactNode;
			children?: React.ReactNode;
		};
		if (child.type === SelectItem && childProps.value != null) {
			labels[String(childProps.value)] =
				childProps.label ?? childProps.children;
			return;
		}
		if (childProps.children != null) {
			collectSelectItemLabels(childProps.children, labels);
		}
	});
}

function Select<Value, Multiple extends boolean | undefined = false>({
	children,
	items,
	...props
}: SelectPrimitive.Root.Props<Value, Multiple>) {
	const collectedItems = React.useMemo(() => {
		if (items != null) return items;
		const labels: Record<string, React.ReactNode> = {};
		collectSelectItemLabels(children, labels);
		return Object.keys(labels).length > 0 ? labels : undefined;
	}, [items, children]);

	return (
		<SelectPrimitive.Root items={collectedItems} {...props}>
			{children}
		</SelectPrimitive.Root>
	);
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
	return (
		<SelectPrimitive.Value
			data-slot="select-value"
			className={cn("flex flex-1 text-left", className)}
			{...props}
		/>
	);
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: SelectPrimitive.Trigger.Props & {
	size?: "sm" | "default";
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			skullet-block=""
			data-size={size}
			className={cn(
				"flex w-fit items-center justify-between gap-s",
				"corner-s corner-squircle py-m pr-l pl-l",
				"text-body-xl whitespace-nowrap",
				"shadow-card bg-transparent transition-all outline-none",
				"squircle:corner-xl",
				// design-escape-ok(opacity): no role renders this; line/50 dark edge
				"dark:shadow-none dark:edge-s dark:border-line/50",
				"disabled:cursor-not-allowed disabled:opacity-50",
				// design-escape-ok(opacity): no role renders this; error/20 invalid ring
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error/20",
				// design-escape-ok(opacity): no role renders this; ink-3/50 placeholder
				"data-placeholder:text-ink-3/50",
				"data-[size=default]:h-9",
				"data-[size=sm]:h-8",
				"*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-s",
				// design-escape-ok(opacity): no role renders this; line-strong/30 and /50 dark fills, error/40–/50 invalid marks
				"dark:bg-line-strong/30 dark:hover:bg-line-strong/50 dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon
				render={
					// design-escape-ok(opacity): no role renders this; ink-3/50 chevron
					<IconSelector className="pointer-events-none size-3.5 text-ink-3/50" />
				}
			/>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	side = "bottom",
	sideOffset = 4,
	align = "center",
	alignOffset = 0,
	alignItemWithTrigger = true,
	...props
}: SelectPrimitive.Popup.Props &
	Pick<
		SelectPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
	>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				side={side}
				sideOffset={sideOffset}
				align={align}
				alignOffset={alignOffset}
				alignItemWithTrigger={alignItemWithTrigger}
				className="isolate z-50"
			>
				<SelectPrimitive.Popup
					data-slot="select-content"
					data-align-trigger={alignItemWithTrigger}
					className={cn(
						"relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 overflow-x-hidden overflow-y-auto",
						"corner-s corner-squircle p-xs",
						"origin-(--transform-origin) bg-surface text-ink shadow-card duration-(--motion-quick-duration) outline-none",
						"squircle:corner-xl-inner",
						"data-[align-trigger=true]:animate-none",
						"data-[side=bottom]:slide-in-from-top-2",
						"data-[side=inline-end]:slide-in-from-left-2",
						"data-[side=inline-start]:slide-in-from-right-2",
						"data-[side=left]:slide-in-from-right-2",
						"data-[side=right]:slide-in-from-left-2",
						"data-[side=top]:slide-in-from-bottom-2",
						"data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
						"data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
						className,
					)}
					{...props}
				>
					<SelectScrollUpButton />
					<SelectPrimitive.List data-fluid-menu-root="">
						<FluidMenuHover items='[role="option"]' />
						{children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({
	className,
	children,
	label,
	...props
}: SelectPrimitive.Item.Props) {
	const derivedLabel =
		label ??
		(typeof children === "string" || typeof children === "number"
			? String(children)
			: undefined);

	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			label={derivedLabel}
			className={cn(
				"relative flex w-full items-center gap-m",
				"corner-s py-s pr-[calc(var(--space-xxl)*4/3)] pl-m",
				"text-body-xl",
				"outline-hidden select-none",
				"focus:bg-hover focus:text-sidebar-accent-foreground",
				"not-data-[variant=destructive]:focus:**:text-sidebar-accent-foreground",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"[&_svg:not([class*='size-'])]:size-4",
				"*:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-m",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText className="flex flex-1 shrink-0 items-center gap-m whitespace-nowrap">
				{children}
			</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator
				render={
					<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
				}
			>
				<IconCheck className="pointer-events-none" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

function SelectScrollUpButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
	return (
		<SelectPrimitive.ScrollUpArrow
			data-slot="select-scroll-up-button"
			className={cn(
				"top-0 z-10 flex w-full items-center justify-center",
				"py-xs",
				"cursor-default bg-surface",
				"[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<IconChevronUp />
		</SelectPrimitive.ScrollUpArrow>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
	return (
		<SelectPrimitive.ScrollDownArrow
			data-slot="select-scroll-down-button"
			className={cn(
				"bottom-0 z-10 flex w-full items-center justify-center",
				"py-xs",
				"cursor-default bg-surface",
				"[&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<IconChevronDown />
		</SelectPrimitive.ScrollDownArrow>
	);
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
