import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative flex size-4 shrink-0 items-center justify-center",
				// design-escape-ok(radius): shipped value; 5px corner
				"rounded-[5px] edge-m border-transparent",
				// design-escape-ok(opacity): shipped value; input/90 fill, line-strong at 90% in light
				"bg-line-strong/90 transition-shadow outline-none",
				// design-escape-ok(colour): shipped value; oklch(1 0 0 / 15%) input at 90% in dark
				"dark:bg-[oklch(1_0_0/13.5%)]",
				"group-has-disabled/field:opacity-50",
				"after:absolute after:-inset-x-3 after:-inset-y-2",
				"focus-visible:border-focus focus-visible:ring-[1.5px] focus-visible:ring-focus-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				// design-escape-ok(opacity): no role renders this; error/20 invalid ring
				"aria-invalid:border-error aria-invalid:ring-[1.5px] aria-invalid:ring-error/20",
				// design-escape-ok(opacity): no role renders this; error/40–/50 invalid marks in dark
				"dark:aria-invalid:border-error/50 dark:aria-invalid:ring-error/40",
				// The shipped checked fill: oklch(0.205) on oklch(0.985), oklch(0.922) on oklch(0.205) in dark; no role holds these greys.
				// design-escape-ok(colour): shipped value; oklch(0.205 0 0) fill and edge on oklch(0.985 0 0)
				"aria-invalid:aria-checked:border-[oklch(0.205_0_0)] data-checked:border-[oklch(0.205_0_0)] data-checked:bg-[oklch(0.205_0_0)] data-checked:text-[oklch(0.985_0_0)]",
				// design-escape-ok(colour): shipped value; oklch(0.922 0 0) fill and edge on oklch(0.205 0 0) in dark
				"dark:aria-invalid:aria-checked:border-[oklch(0.922_0_0)] dark:data-checked:border-[oklch(0.922_0_0)] dark:data-checked:bg-[oklch(0.922_0_0)] dark:data-checked:text-[oklch(0.205_0_0)]",
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
