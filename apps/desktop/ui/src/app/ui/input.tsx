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
	"focus-visible:ring-[1.5px] focus-visible:ring-focus-ring",
	"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
	"placeholder:text-ink-3",
	"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
);

// The field every single- and multi-line text control shares: a squircle on
// the control ground and shadow (the roles flip it for dark), placeholder in
// ink-4, a focus ring when focused.
export const FIELD_CLASS_NAME = cn(
	"corner-s corner-squircle px-l py-xs",
	"text-body-xxl",
	"bg-control shadow-control transition-[color,box-shadow] outline-none",
	// the field's focus mark: a soft focus ring over the control shadow
	"focus-visible:ring-[1.5px] focus-visible:ring-focus-ring",
	"squircle:corner-xl-inner",
	"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
	"placeholder:text-ink-4",
	// a read-only value reads as meta: it shows, it doesn't take input
	"read-only:text-ink-3",
	"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
	"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
	"md:text-body-xl",
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
			className={cn("h-9 w-full min-w-0", FIELD_CLASS_NAME, className)}
			{...props}
		/>
	);
}

export { Input };
