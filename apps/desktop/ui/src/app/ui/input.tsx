import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

// The plain field the dialogs shipped with: a filled pill on a clear 1px edge.
const PLAIN_INPUT_CLASS_NAME = cn(
	"h-9 w-full min-w-0",
	"corner-full edge-m border-transparent px-l py-xs",
	"text-body-xxl md:text-body-xl",
	// design-escape-ok(opacity,colour): shipped value; input/50, line-strong at 50% and oklch(1 0 0 / 7.5%) in dark
	"bg-line-strong/50 dark:bg-[oklch(1_0_0/7.5%)]",
	"transition-[color,box-shadow,background-color] outline-none",
	"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
	"placeholder:text-ink-3",
	"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	// design-escape-ok(opacity): no role renders this; error/20 invalid ring, error/40–/50 in dark
	"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error/20 dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40",
);

function Input({
	className,
	type,
	variant = "default",
	...props
}: React.ComponentProps<"input"> & { variant?: "default" | "plain" }) {
	if (variant === "plain") {
		return (
			<InputPrimitive
				type={type}
				data-slot="input"
				className={cn(PLAIN_INPUT_CLASS_NAME, className)}
				{...props}
			/>
		);
	}
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0",
				"corner-s corner-squircle px-[calc(var(--space-m)+var(--space-xxs))] py-xs",
				"text-body-xxl",
				"shadow-card bg-transparent transition-[color,box-shadow] outline-none",
				"squircle:corner-xl-inner",
				// design-escape-ok(opacity): no role renders this; line/50 dark edge
				"dark:shadow-none dark:edge-s dark:border-line/50",
				// design-escape-ok(opacity): no role renders this; line/70 dark edge on hover
				"hover:dark:border-line/70",
				"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
				// design-escape-ok(opacity): no role renders this; ink-3/50 placeholder
				"placeholder:text-ink-3/50",
				"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				// design-escape-ok(opacity): no role renders this; error/20 invalid ring
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error/20",
				"md:text-body-xl",
				// design-escape-ok(opacity): no role renders this; line-strong/30 dark fill, error/40–/50 invalid marks
				"dark:bg-line-strong/30 dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
