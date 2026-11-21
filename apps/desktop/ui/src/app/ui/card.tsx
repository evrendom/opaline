import type * as React from "react";

import { cn } from "@/lib/utils";

function Card({
	className,
	size = "default",
	...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
	return (
		<div
			data-slot="card"
			data-size={size}
			className={cn(
				"group/card flex flex-col gap-xl overflow-hidden",
				"corner-m corner-squircle py-xxl",
				"text-body-xl",
				// design-escape-ok(type): shipped value; the 20/14 line as a ratio, so smaller text inside keeps it
				"leading-[calc(20/14)]",
				"shadow-card bg-card text-ink",
				"squircle:corner-xl",
				"has-[>img:first-child]:pt-zero",
				"data-[size=sm]:gap-m data-[size=sm]:py-[calc(var(--space-xs)*5)]",
				"*:[img:first-child]:corner-t-xl *:[img:first-child]:corner-squircle *:[img:last-child]:corner-b-xl *:[img:last-child]:corner-squircle",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"group/card-header @container/card-header grid auto-rows-min items-start gap-xs",
				"corner-t-l px-xxl",
				"group-data-[size=sm]/card:px-[calc(var(--space-xs)*5)] has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-xxl group-data-[size=sm]/card:[.border-b]:pb-xl",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn(
				"font-body text-body-xxl font-medium group-data-[size=sm]/card:text-body-xl",
				// design-escape-ok(type): shipped value; a small card's 14px title sits on a 1.5 line (21px)
				"group-data-[size=sm]/card:leading-normal",
				className,
			)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-body-xl text-ink-3 text-balance", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn(
				"px-xxl group-data-[size=sm]/card:px-[calc(var(--space-xs)*5)]",
				className,
			)}
			{...props}
		/>
	);
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
