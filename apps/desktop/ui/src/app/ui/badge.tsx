import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// A short status word on a pill: "Shared", "Owner", "Up to date", "Failed".
// Five tones and nothing else; colour means state, so a coloured tone is only
// ever a state. Something in progress is neutral with a spinner.
const badgeVariants = cva(
	"group/badge inline-flex w-fit corner-full shrink-0 items-center justify-center overflow-hidden font-medium whitespace-nowrap transition-all focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus-ring aria-invalid:border-error aria-invalid:ring-error-line [&>svg]:pointer-events-none [&_svg]:shrink-0 h-5 px-m gap-s text-body-m has-[>svg:first-child]:pl-s has-[>svg:last-child]:pr-s [&_svg:not([class*='size-'])]:size-3!",
	{
		variants: {
			variant: {
				neutral: "bg-field shadow-raised text-ink [a]:hover:bg-hover-strong",
				outline: "shadow-card text-ink [a]:hover:bg-hover [a]:hover:text-ink-3",
				success: "bg-success-tint text-success",
				warning: "bg-warning-tint text-warning",
				error: "bg-error-tint text-error",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
);

function Badge({
	className,
	variant = "neutral",
	render,
	children,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	const wrappedChildren = React.Children.map(children, (child) =>
		typeof child === "string" || typeof child === "number" ? (
			<span>{child}</span>
		) : (
			child
		),
	);

	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ variant }), className),
				children: wrappedChildren,
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge };
