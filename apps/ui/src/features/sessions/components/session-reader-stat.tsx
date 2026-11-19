import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SessionStat({
	label,
	title,
	value,
	valueClassName,
}: {
	label: string;
	title?: string;
	value: ReactNode;
	valueClassName?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1" title={title}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className={cn("text-[13px] tabular-nums", valueClassName)}>
				{value}
			</span>
		</div>
	);
}
