import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	// design-escape-ok(opacity): no role renders this; error/20 and /40 invalid rings
	"group/badge inline-flex w-fit corner-full shrink-0 items-center justify-center capitalize overflow-hidden font-medium whitespace-nowrap transition-all focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus-ring aria-invalid:border-error aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 [&>svg]:pointer-events-none [&_svg]:shrink-0 h-5 px-m gap-s text-body-m has-[>svg:first-child]:pl-s has-[>svg:last-child]:pr-s [&_svg:not([class*='size-'])]:size-3!",
	{
		variants: {
			variant: {
				// design-escape-ok(opacity): no role renders this; field/80 on a linked badge's hover
				secondary: "bg-field shadow-raised text-ink [a]:hover:bg-field/80",
				outline: "shadow-card text-ink [a]:hover:bg-hover [a]:hover:text-ink-3",
			},
		},
		defaultVariants: {
			variant: "secondary",
		},
	},
);

function Badge({
	className,
	variant = "secondary",
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
