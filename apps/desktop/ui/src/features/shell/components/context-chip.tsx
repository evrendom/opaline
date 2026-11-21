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
			className={cn(
				"inline-flex h-8 max-w-xs shrink-0 items-center gap-s",
				"corner-full pr-l pl-[calc(var(--space-m)+var(--space-xxs))]",
				"text-body-xl whitespace-nowrap",
				"bg-card shadow-control",
				"[&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg:not([class*='text-'])]:text-ink-3",
			)}
		>
			{icon}
			<span className={cn("truncate", mono && "font-data text-body-l")}>
				{label}
			</span>
		</div>
	);
}
