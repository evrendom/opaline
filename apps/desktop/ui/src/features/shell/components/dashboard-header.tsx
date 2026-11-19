import type { ComponentProps } from "react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { cn } from "@/lib/utils";

export function DashboardHeader({
	className,
	children,
	...props
}: ComponentProps<"header">) {
	return (
		<header
			data-slot="dashboard-header"
			data-fluid-menu-root=""
			className={cn(
				"flex h-(--dashboard-01-header-height) shrink-0 items-center border-b-[0.5px] border-black/6 bg-[var(--dashboard-01-content-background)] font-sans dark:border-white/8",
				className,
			)}
			{...props}
		>
			<FluidMenuHover items='button, a[href], [role="button"]' />
			{children}
		</header>
	);
}
