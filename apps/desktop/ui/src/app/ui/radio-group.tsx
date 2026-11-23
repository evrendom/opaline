import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Pick one of a short, fixed list (two to five options) where every option
// should stay in view. A longer list, or one where the choice is secondary,
// is a Select. The group takes `value`/`onValueChange` (or `defaultValue`)
// and an `aria-label` or `aria-labelledby`; each item is a radio with its own
// visible label, so an option is never unlabelled.
function RadioGroup<Value = string>({
	className,
	orientation = "vertical",
	...props
}: RadioGroupPrimitive.Props<Value> & {
	orientation?: "vertical" | "horizontal";
}) {
	return (
		<RadioGroupPrimitive<Value>
			data-slot="radio-group"
			data-orientation={orientation}
			className={cn(
				"flex gap-m",
				orientation === "vertical" ? "flex-col" : "flex-row flex-wrap gap-x-xl",
				className,
			)}
			{...props}
		/>
	);
}

function RadioGroupItem<Value = string>({
	className,
	children,
	...props
}: Radio.Root.Props<Value> & { children: React.ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the radio is the label's own child
		<label
			data-slot="radio-group-item"
			className={cn(
				"flex w-fit items-center gap-s text-body-xl",
				"has-data-disabled:opacity-50",
				className,
			)}
		>
			<Radio.Root<Value>
				className={cn(
					"relative flex size-4 shrink-0 items-center justify-center",
					"corner-full edge-m border-transparent",
					"bg-line transition-shadow outline-none",
					"after:absolute after:-inset-x-3 after:-inset-y-2",
					"focus-visible:border-focus focus-visible:ring-[1.5px] focus-visible:ring-focus-ring",
					"data-disabled:cursor-not-allowed",
					"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
					// Checked takes the filled button's primary fill, like Checkbox.
					"data-checked:border-primary data-checked:bg-primary",
				)}
				{...props}
			>
				<Radio.Indicator className="size-1.5 corner-full bg-primary-fg" />
			</Radio.Root>
			{children}
		</label>
	);
}

export { RadioGroup, RadioGroupItem };
