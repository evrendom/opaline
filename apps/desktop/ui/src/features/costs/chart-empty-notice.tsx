import { IconChartArea } from "@tabler/icons-react";
import { EmptyMedia } from "@/app/ui/empty";
import {
	OpalineShape,
	restingChipClassName,
} from "@/features/shell/components/shell-nav-icon";
import { cn } from "@/lib/utils";

export function ChartEmptyNotice({ title }: { title: string }) {
	return (
		<div className="cost-chart-empty">
			<EmptyMedia variant="icon" className="mb-0">
				<OpalineShape
					className={cn(
						"absolute inset-0",
						restingChipClassName,
						"[--opal-ring:rgb(17_24_39/0.08)]",
					)}
				/>
				<IconChartArea className="relative" />
			</EmptyMedia>
			<p>{title}</p>
		</div>
	);
}
