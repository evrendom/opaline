import type { ComponentProps } from "react";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
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
				"flex h-(--dashboard-01-header-height) shrink-0 items-center",
				"edge-b-s",
				"font-body",
				"border-line bg-canvas",
				className,
			)}
			{...props}
		>
			<FluidMenuHover items='button, a[href], [role="button"]' />
			{children}
		</header>
	);
}
