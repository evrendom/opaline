import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// A small, square-cornered label attached to a thing in a row: the tool, file,
// model or subagent a step touched, a signal count, "Plan", "MCP". Where a
// Badge says a thing's status on a pill, a Tag says what it is or what's on
// it. Tones are the state colours and only ever mean state; most tags are
// neutral. `sm` sits in a dense row (a session row, a waterfall), `md` beside
// body text (a trace step).
const tagVariants = cva(
	"inline-flex w-fit min-w-0 shrink-0 items-center gap-xxs corner-xs whitespace-nowrap tabular-nums select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-ink-3",
	{
		variants: {
			tone: {
				neutral: "bg-field text-ink-2",
				success:
					"bg-success-tint text-success [&_svg:not([class*='text-'])]:text-success",
				warning:
					"bg-warning-tint text-warning [&_svg:not([class*='text-'])]:text-warning",
				error:
					"bg-error-tint text-error [&_svg:not([class*='text-'])]:text-error",
			},
			size: {
				sm: "h-4.5 px-s text-body-xs has-[>svg:first-child]:pl-xs",
				md: "h-5 px-s text-body-m has-[>svg:first-child]:pl-xs [&_svg:not([class*='size-'])]:size-3.5",
			},
		},
		defaultVariants: { tone: "neutral", size: "sm" },
	},
);

function Tag({
	className,
	tone = "neutral",
	size = "sm",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof tagVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{ className: cn(tagVariants({ tone, size }), className) },
			props,
		),
		render,
		state: { slot: "tag", tone, size },
	});
}

export { Tag, tagVariants };
