import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
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
