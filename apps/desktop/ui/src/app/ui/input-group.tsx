"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import { cn } from "@/lib/utils";

function InputGroup({
	className,
	variant = "default",
	...props
}: React.ComponentProps<"div"> & {
	/** `toolbar`: the toolbar's 32px search pill, on the toolbar button's
	 *  card and control shadow in both modes (a filter row's search). */
	variant?: "default" | "toolbar";
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: A fieldset's default border and min-width would break the inline control layout.
		<div
			data-slot="input-group"
			data-variant={variant}
			role="group"
			className={cn(
				"group/input-group relative flex w-full min-w-0 items-center",
				"transition-[color,box-shadow] outline-none",
				variant === "toolbar"
					? // The hover tint is half the hover role in light and all of it in
						// dark; no role holds that step, so it stays a dark: pair.
						"h-8 corner-full bg-card shadow-control hover:bg-hover-50 dark:hover:bg-hover"
					: // design-escape-ok(opacity): no role renders this; line/50 edge and line-strong/30 fill in dark
						"h-9 corner-s corner-squircle shadow-card squircle:corner-l dark:shadow-none dark:edge-s dark:border-line/50 dark:bg-line-strong/30",
				"in-data-[slot=combobox-content]:focus-within:border-inherit",
				"has-[[data-slot=input-group-control]:focus-visible]:border-focus has-[[data-slot=input-group-control]:focus-visible]:ring-[1.5px] has-[[data-slot=input-group-control]:focus-visible]:ring-focus-ring",
				// design-escape-ok(opacity): no role renders this; error/20 invalid ring
				"has-[[data-slot][aria-invalid=true]]:border-error has-[[data-slot][aria-invalid=true]]:ring-[1.5px] has-[[data-slot][aria-invalid=true]]:ring-error/20",
				"has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
				"has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
				"has-[>textarea]:h-auto",
				// design-escape-ok(opacity): no role renders this; error/40 invalid ring in dark
				"dark:has-[[data-slot][aria-invalid=true]]:ring-error/40",
				"has-[>[data-align=block-end]]:[&>input]:pt-l",
				"has-[>[data-align=block-start]]:[&>input]:pb-l",
				"has-[>[data-align=inline-end]]:[&>input]:pr-s",
				"has-[>[data-align=inline-start]]:[&>input]:pl-s",
				className,
			)}
			{...props}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"flex h-auto cursor-text items-center justify-center gap-m py-s text-body-xl font-medium text-ink-3 select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:corner-xs [&>svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			align: {
				"inline-start":
					"order-first pl-l has-[>button]:-ml-xs has-[>kbd]:-ml-xxs",
				"inline-end": "order-last pr-l has-[>button]:-mr-xs has-[>kbd]:-mr-xxs",
				"block-start":
					"order-first w-full justify-start px-l pt-m group-has-[>input]/input-group:pt-m [.border-b]:pb-m",
				"block-end":
					"order-last w-full justify-start px-l pb-m group-has-[>input]/input-group:pb-m [.border-t]:pt-m",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon({
	className,
	align = "inline-start",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Pointer convenience only; keyboard users focus the input directly.
		<div
			data-slot="input-group-addon"
			data-align={align}
			className={cn(inputGroupAddonVariants({ align }), className)}
			onClick={(e) => {
				if ((e.target as HTMLElement).closest("button")) {
					return;
				}
				e.currentTarget.parentElement?.querySelector("input")?.focus();
			}}
			{...props}
		/>
	);
}

const inputGroupButtonVariants = cva(
	"flex items-center gap-m text-body-xl shadow-none",
	{
		variants: {
			size: {
				xs: "h-6 gap-xs corner-xs px-s [&>svg:not([class*='size-'])]:size-3.5",
				sm: "",
				"icon-xs": "size-6 corner-xs p-zero has-[>svg]:p-zero",
				"icon-sm": "size-8 p-zero has-[>svg]:p-zero",
			},
		},
		defaultVariants: {
			size: "xs",
		},
	},
);

function InputGroupButton({
	className,
	type = "button",
	variant = "ghost",
	size = "xs",
	...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
	VariantProps<typeof inputGroupButtonVariants> & {
		type?: "button" | "submit" | "reset";
	}) {
	return (
		<Button
			type={type}
			data-size={size}
			variant={variant}
			className={cn(inputGroupButtonVariants({ size }), className)}
			{...props}
		/>
	);
}

function InputGroupInput({
	className,
	...props
}: React.ComponentProps<"input">) {
	return (
		<Input
			data-slot="input-group-control"
			className={cn(
				"flex-1",
				"corner-zero edge-none",
				"bg-transparent shadow-none ring-0",
				"dark:border-none aria-invalid:ring-0 dark:bg-transparent",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
