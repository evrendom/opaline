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
			<EmptyMedia variant="icon" className="mb-zero">
				<OpalineShape
					className={cn(
						"absolute inset-0",
						restingChipClassName,
						"[--opal-ring:var(--line)]",
					)}
				/>
				<IconChartArea className="relative" />
			</EmptyMedia>
			<p>{title}</p>
		</div>
	);
}
