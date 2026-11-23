import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { IconCheck } from "@tabler/icons-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// A checkbox with visible text takes it as children: the checkbox and its
// text become one label, in regular weight like a radio option. Without
// children, give it an `aria-label` (a table cell, a menu row that labels it).
function Checkbox({
	className,
	children,
	...props
}: CheckboxPrimitive.Root.Props & { children?: React.ReactNode }) {
	if (children != null) {
		return (
			// biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is the label's own child
			<label
				data-slot="checkbox-label"
				className={cn(
					"flex w-fit items-center gap-s text-body-xl",
					"has-data-disabled:opacity-50",
					className,
				)}
			>
				<CheckboxBox {...props} />
				{children}
			</label>
		);
	}
	return <CheckboxBox className={className} {...props} />;
}

function CheckboxBox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative flex size-4 shrink-0 items-center justify-center",
				"corner-xs edge-m border-transparent",
				"bg-line transition-shadow outline-none",
				"group-has-disabled/field:opacity-50",
				"after:absolute after:-inset-x-3 after:-inset-y-2",
				"focus-visible:border-focus focus-visible:ring-[1.5px] focus-visible:ring-focus-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error-line",
				// Checked takes the filled button's primary fill.
				"aria-invalid:aria-checked:border-primary data-checked:border-primary data-checked:bg-primary data-checked:text-primary-fg",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
			>
				<IconCheck />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
