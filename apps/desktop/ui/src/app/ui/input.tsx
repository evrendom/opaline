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
				"dark:shadow-none dark:edge-s dark:border-line/50",
				"hover:dark:border-line/70",
				"file:inline-flex file:h-7 file:edge-none file:bg-transparent file:text-body-xl file:font-medium file:text-ink",
				"placeholder:text-ink-3/50",
				"disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error/20",
				"md:text-body-xl",
				"dark:bg-line-strong/30 dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
