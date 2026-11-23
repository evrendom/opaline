import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// The one button. Four variants and nothing else: an unlisted variant is a
// type error, not an option. `secondary` is the default; `primary` is named
// on purpose, once per view, for the screen's main action. Navigation is a
// <Link>, not a button. An invalid button takes the error edge inside an
// error-line ring; keyboard focus is the system's one mark, `focus-outline`.
const buttonVariants = cva(
	"group/button inline-flex shrink-0 items-center justify-center corner-full bg-clip-padding text-body-xl font-medium whitespace-nowrap transition-all hover:duration-(--motion-duration) focus-outline select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				// The screen's main action, and the toolbar's pills: a card pill on
				// the card shadow. Pressed, active (`data-active`, e.g. filters
				// applied) or open lifts it onto the raised shadow. Its hover and
				// open fill is opaque (field), so a pill over a chart or an image
				// never turns see-through.
				primary:
					"bg-surface text-ink shadow-card hover:bg-field aria-expanded:bg-field data-popup-open:bg-field aria-pressed:shadow-raised data-active:shadow-raised [&_svg:not([class*='text-'])]:text-ink-3",
				// Everything else: Cancel, row actions, icon-only buttons. Plain text
				// on a clear 1px edge, a field fill on hover, grey icons.
				secondary:
					"border border-transparent hover:bg-field hover:text-ink aria-expanded:bg-field aria-expanded:text-ink aria-pressed:bg-field aria-pressed:text-ink [&_svg:not([class*='text-'])]:text-ink-3",
				// Destructive or hard-to-undo actions only: an error tint, firming
				// to the error line on hover.
				danger:
					"border border-transparent bg-error-tint text-error hover:bg-error-line",
				// An action inside a sentence ("Couldn't load. Try again"). The
				// underline stays drawn but quiet at rest and firms on hover.
				link: "text-ink underline decoration-line underline-offset-4 hover:decoration-ink",
			},
			size: {
				sm: "h-6 gap-xs px-m text-body-m [&_svg:not([class*='size-'])]:size-[11px]",
				md: "h-8 gap-s px-l has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m",
				lg: "h-9 gap-s px-l has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m",
				"icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
				icon: "size-8",
				// Sits in a sentence: no box, the surrounding text's size and line.
				inline: "h-auto gap-xs p-zero align-baseline text-[length:inherit]",
			},
		},
		defaultVariants: {
			variant: "secondary",
			size: "md",
		},
	},
);

function Button({
	className,
	variant = "secondary",
	size = "md",
	children,
	nativeButton,
	...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
	return (
		<ButtonPrimitive
			data-slot="button"
			data-variant={variant}
			data-size={size}
			skullet-block=""
			className={cn(buttonVariants({ variant, size, className }))}
			// When `render` swaps in a non-button element (e.g. a Next.js
			// <Link>/<a>), it isn't a native <button>; tell Base UI so it applies the
			// right a11y semantics instead of warning. An explicit prop always wins.
			nativeButton={nativeButton ?? props.render === undefined}
			{...props}
		>
			{React.Children.map(children, (child) =>
				typeof child === "string" || typeof child === "number" ? (
					<span data-button-text="">{child}</span>
				) : (
					child
				),
			)}
		</ButtonPrimitive>
	);
}

export { Button, buttonVariants };
