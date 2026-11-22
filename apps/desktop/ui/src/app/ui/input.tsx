import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

// The plain field the dialogs use: a filled pill on a clear 1px edge.
const PLAIN_INPUT_CLASS_NAME = cn(
	"h-9 w-full min-w-0",
	"corner-full edge-m border-transparent px-l py-xs",
	"text-body-xxl md:text-body-xl",
	"bg-hover",
	"transition-[color,box-shadow,background-color] outline-none",
	"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
	"placeholder:text-ink-3",
	"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
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
				// Dark trades the card shadow for a soft hairline that firms on hover.
				"dark:shadow-none dark:edge-s dark:border-line-soft",
				"hover:dark:border-line",
				"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
				"placeholder:text-ink-4",
				"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
				"md:text-body-xl",
				"dark:bg-hover",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
