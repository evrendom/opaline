import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// An invalid button's edge is the full error colour in light and half of it
// in dark; error-line is a ring-strength tint, so that edge stays a dark: pair.
// Keyboard focus is the system's one mark, `focus-outline`.
const buttonVariants = cva(
	// design-escape-ok(opacity): no role renders this; error/50 invalid edge in dark
	"group/button inline-flex shrink-0 items-center justify-center corner-full bg-clip-padding text-body-xl font-medium whitespace-nowrap transition-all hover:duration-(--motion-duration) focus-outline select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line dark:aria-invalid:border-error/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				// The shipped filled button: a flat near-black (near-white in dark)
				// fill inside a 1px clear edge, no shadow, lightening to 80% on hover.
				// No role holds these greys (primary is a step lighter), so they stay
				// as shipped.
				default:
					// design-escape-ok(colour,opacity): shipped value; oklch(0.205 0 0) fill on oklch(0.985 0 0) text, oklch(0.922 0 0) on oklch(0.205 0 0) in dark, /80 hover
					"border border-transparent bg-[oklch(0.205_0_0)] text-[oklch(0.985_0_0)] hover:bg-[oklch(0.205_0_0)]/80 dark:bg-[oklch(0.922_0_0)] dark:text-[oklch(0.205_0_0)] dark:hover:bg-[oklch(0.922_0_0)]/80",
				outline:
					"shadow-card bg-surface hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink [&_svg:not([class*='text-'])]:text-ink-3",
				ghost:
					"hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink [&_svg:not([class*='text-'])]:text-ink-3",
				// The plain ghost the dialogs, the date picker, the calendar and the
				// settings tables shipped with: a 1px clear edge, a field fill on hover
				// (half of it in dark), and icons that follow the text at 16px.
				quiet:
					// design-escape-ok(opacity): shipped value; muted/50 hover in dark, field at 50%
					"border border-transparent hover:bg-field hover:text-ink aria-expanded:bg-field aria-expanded:text-ink dark:hover:bg-field/50 [&_svg:not([class*='size-'])]:size-4",
				// The plain outline those places shipped with: a 1px line-strong edge on
				// the canvas (clear in dark), a field fill on hover, 16px icons.
				bordered:
					"border border-line bg-canvas hover:bg-field hover:text-ink aria-expanded:bg-field aria-expanded:text-ink dark:bg-transparent dark:hover:bg-hover [&_svg:not([class*='size-'])]:size-4",
				// The error fill is stronger in dark (10/20% light, 20/30% dark);
				// error-tint is 11/17%, so the fill keeps its own dark: steps. Like the
				// filled button it sits flat inside a 1px clear edge, with no shadow.
				destructive:
					// design-escape-ok(opacity): no role renders this; error/10–/30 fills
					"border border-transparent bg-error/10 text-error hover:bg-error/20 dark:bg-error/20 dark:hover:bg-error/30",
				// Underline stays rendered but transparent at rest, fading its opacity
				// in on hover — the base `transition-all` animates the decoration color.
				// design-escape-ok(opacity): no role renders this; ink/20 underline at rest
				link: "text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink",
				// The toolbar pill: a card surface with muted text and 14px icons
				// (whatever size the icon asks for). Pressed, active (`data-active`,
				// e.g. filters applied) or open lifts it to foreground text on the
				// stronger shadow.
				toolbar:
					"bg-surface font-regular text-ink-3 shadow-card hover:bg-[color-mix(in_oklab,var(--field)_50%,var(--surface))] aria-expanded:bg-[color-mix(in_oklab,var(--field)_50%,var(--surface))] data-popup-open:bg-[color-mix(in_oklab,var(--field)_50%,var(--surface))] aria-pressed:text-ink aria-pressed:shadow-raised data-active:text-ink data-active:shadow-raised [&>svg]:size-3.5",
			},
			size: {
				xs: "h-6 gap-xs corner-full px-[calc(var(--space-xxs)*5)] text-body-m in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m [&_svg:not([class*='size-'])]:size-[11px]",
				// The shipped small button is 32px with a 4px gap.
				sm: "h-8 gap-xs corner-full px-l in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-m has-[>svg:last-child]:pr-m",
				default:
					"h-8 gap-s px-l in-data-[slot=button-group]:corner-full has-[>svg:first-child]:pl-l has-[>svg:last-child]:pr-l",
				// The plain buttons' 36px size: 6px gap, 12px sides, 10px beside an icon.
				md: "h-9 gap-s px-l has-data-[icon=inline-end]:pr-[calc(var(--space-m)+var(--space-xxs))] has-data-[icon=inline-start]:pl-[calc(var(--space-m)+var(--space-xxs))]",
				icon: "size-8",
				"icon-xs":
					"size-6 corner-full in-data-[slot=button-group]:corner-full [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8 corner-full in-data-[slot=button-group]:corner-full",
				// Sits in a sentence ("Couldn't load. Try again"): no box, the
				// surrounding text's size and line.
				inline: "h-auto gap-xs p-zero align-baseline text-[length:inherit]",
			},
		},
		compoundVariants: [
			// The toolbar pill's shipped spacing: a 5.5px gap, and 10px on an
			// icon's side. A lone icon before a plain label shipped with 10px on
			// both sides (the label was a text node, so the icon was also the
			// last element).
			{
				variant: "toolbar",
				size: "default",
				className:
					// design-escape-ok(space): shipped value; 5.5px gap
					"gap-[5.5px] has-[>svg:first-child]:pl-[calc(var(--space-xxs)*5)] has-[>svg:last-child]:pr-[calc(var(--space-xxs)*5)] has-[>svg+[data-button-text]:last-child]:pr-[calc(var(--space-xxs)*5)]",
			},
			// The plain buttons' small size kept its 12px sides beside an icon.
			{
				variant: ["quiet", "bordered"],
				size: "sm",
				className: "has-[>svg:first-child]:pl-l has-[>svg:last-child]:pr-l",
			},
		],
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
					<span data-button-text="">{child}</span>
				) : (
					child
				),
			)}
		</ButtonPrimitive>
	);
}

export { Button, buttonVariants };
