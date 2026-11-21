import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"h-9 w-full min-w-0",
				"corner-s corner-squircle px-l py-xs",
				"text-body-xxl",
				"shadow-card bg-transparent transition-[color,box-shadow] outline-none",
				"squircle:corner-xl",
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
