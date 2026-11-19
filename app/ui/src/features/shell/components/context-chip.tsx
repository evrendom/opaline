import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Adapted from the static ContextChip: the pill under a
// detail page's breadcrumb that names what the record belongs to.
export function ContextChip({
	icon,
	label,
	title,
	mono = false,
}: {
	icon: ReactNode;
	label: string;
	title?: string;
	mono?: boolean;
}) {
	return (
		<div
			title={title}
			className="inline-flex h-8 max-w-xs shrink-0 items-center gap-[5.5px] rounded-full bg-background pr-3 pl-2.5 text-sm whitespace-nowrap shadow-(--custom-outline-shadow) dark:bg-card [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg:not([class*='text-'])]:text-neutral-500 dark:[&>svg:not([class*='text-'])]:text-neutral-400"
		>
			{icon}
			<span className={cn("truncate", mono && "font-mono text-[0.8125rem]")}>
				{label}
			</span>
		</div>
	);
}
