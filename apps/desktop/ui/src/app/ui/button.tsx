import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// An invalid button's edge is the full error colour in light and half of it
// in dark; error-line is a ring-strength tint, so that edge stays a dark: pair.
const buttonVariants = cva(
	"group/button inline-flex shrink-0 items-center justify-center corner-full bg-clip-padding text-body-xl font-medium whitespace-nowrap transition-all hover:duration-150 outline-none select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line dark:aria-invalid:border-error/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				// The fill lightens on hover by mode (80% light, 90% dark); no
				// role holds a per-mode opacity, so the step stays a dark: pair.
				default:
					"bg-primary shadow-primary text-primary-fg hover:bg-primary/80 dark:hover:bg-primary/90 [&_svg:not([class*='text-'])]:text-ink-disabled",
				outline:
					"shadow-control bg-card hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink [&_svg:not([class*='text-'])]:text-ink-3",
				ghost:
					"hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink [&_svg:not([class*='text-'])]:text-ink-3",
				// The error fill is stronger in dark (10/20% light, 20/30% dark);
				// error-tint is 11/17%, so the fill keeps its own dark: steps.
				destructive:
					"bg-error/10 shadow-destructive text-error hover:bg-error/20 dark:bg-error/20 dark:hover:bg-error/30",
				// Underline stays rendered but transparent at rest, fading its opacity
				// in on hover — the base `transition-all` animates the decoration color.
				link: "text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink",
				// The toolbar pill: a card surface with muted text and 14px icons
				// (whatever size the icon asks for). Pressed, active (`data-active`,
				// e.g. filters applied) or open lifts it to foreground text on the
				// stronger shadow.
				toolbar:
					"bg-card font-regular text-ink-3 shadow-control hover:bg-hover aria-expanded:bg-hover data-popup-open:bg-hover aria-pressed:text-ink aria-pressed:shadow-raised data-active:text-ink data-active:shadow-raised [&>svg]:size-3.5",
			},
			size: {
				xs: "h-6 gap-xs corner-full px-l text-body-m in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m [&_svg:not([class*='size-'])]:size-[11px]",
				sm: "h-7 gap-s corner-full px-l in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m",
				default:
					"h-8 gap-s px-l in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-l has-[>svg:last-child]:pr-l",
				icon: "size-8",
				"icon-xs":
					"size-6 corner-full in-data-[slot=button-group]:corner-full [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8 corner-full in-data-[slot=button-group]:corner-full",
				// Sits in a sentence ("Couldn't load. Try again"): no box, the
				// surrounding text's size and line.
				inline: "h-auto gap-xs p-zero align-baseline text-[length:inherit]",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
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
					<span>{child}</span>
				) : (
					child
				),
			)}
		</ButtonPrimitive>
	);
}

export { Button, buttonVariants };
