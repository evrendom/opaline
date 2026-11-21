import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { FlowNumber } from "@/app/ui/flow-number";
import { PLAIN_NUMBER } from "@/lib/figure";
import { cn } from "@/lib/utils";

/** The inside of a toolbar "Filter" trigger: the icon, the label and how many
 *  filters are applied. `iconOnly` keeps just the icon (narrow toolbars). */
export function FilterTriggerLabel({
	activeCount,
	iconOnly = false,
}: {
	activeCount: number;
	iconOnly?: boolean;
}) {
	return (
		<>
			<IconAdjustmentsHorizontal
				aria-hidden="true"
				className={cn(
					"size-4 h-lh shrink-0",
					activeCount > 0
						? "text-accent"
						: // design-escape-ok(colour): shipped value; #5d5d5d, #acaeb2 in dark
							"text-[#5d5d5d] dark:text-[#acaeb2]",
				)}
			/>
			{iconOnly ? null : <span>Filter</span>}
			{activeCount > 0 && !iconOnly ? (
				<span
					className={cn(
						"min-w-4",
						"corner-full px-xs",
						"text-center text-body-xs font-heavy tabular-nums",
						"bg-accent text-accent-fg",
					)}
				>
					<FlowNumber value={activeCount} format={PLAIN_NUMBER} />
				</span>
			) : null}
		</>
	);
}
