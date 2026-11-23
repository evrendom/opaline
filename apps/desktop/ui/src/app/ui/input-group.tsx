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
					? "h-8 corner-full bg-surface shadow-card hover:bg-field"
					: "h-9 corner-s corner-squircle bg-control shadow-control squircle:corner-l",
				"in-data-[slot=combobox-content]:focus-within:border-inherit",
				"has-[[data-slot=input-group-control]:focus-visible]:border-focus has-[[data-slot=input-group-control]:focus-visible]:ring-[1.5px] has-[[data-slot=input-group-control]:focus-visible]:ring-focus-ring",
				"has-[[data-slot][aria-invalid=true]]:border-error has-[[data-slot][aria-invalid=true]]:ring-[1.5px] has-[[data-slot][aria-invalid=true]]:ring-error-line",
				"has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
				"has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
				"has-[>textarea]:h-auto",
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
					"order-first pl-[calc(var(--space-m)+var(--space-xxs))] has-[>button]:-ml-xs has-[>kbd]:-ml-xxs",
				"inline-end":
					"order-last pr-[calc(var(--space-m)+var(--space-xxs))] has-[>button]:-mr-xs has-[>kbd]:-mr-xxs",
				"block-start":
					"order-first w-full justify-start px-[calc(var(--space-m)+var(--space-xxs))] pt-m group-has-[>input]/input-group:pt-m [.border-b]:pb-m",
				"block-end":
					"order-last w-full justify-start px-[calc(var(--space-m)+var(--space-xxs))] pb-m group-has-[>input]/input-group:pb-m [.border-t]:pt-m",
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
				sm: "h-6 gap-xs corner-xs px-s [&>svg:not([class*='size-'])]:size-3.5",
				md: "",
				"icon-sm": "size-6 corner-xs p-zero has-[>svg]:p-zero",
				icon: "size-8 p-zero has-[>svg]:p-zero",
			},
		},
		defaultVariants: {
			size: "sm",
		},
	},
);

function InputGroupButton({
	className,
	type = "button",
	variant = "secondary",
	size = "sm",
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
				"bg-transparent shadow-none ring-0 aria-invalid:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
