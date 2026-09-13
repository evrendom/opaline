import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function DashboardHeader({
	className,
	...props
}: ComponentProps<"header">) {
	return (
		<header
			data-slot="dashboard-header"
			className={cn(
				"flex h-(--dashboard-01-header-height) shrink-0 items-center border-b-[0.5px] border-black/6 bg-[var(--dashboard-01-content-background)] font-sans dark:border-white/8",
				className,
			)}
			{...props}
		/>
	);
}
