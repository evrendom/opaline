import "@/app/app-surface.css";
import type { ReactNode } from "react";
import { SidebarInset } from "@/app/ui/sidebar";
import {
	ShellWindowColumn,
	ShellWindowFooterPlaceholder,
	shellWindowRadiusClassName,
} from "@/features/shell/components/shell-window-column";
import { useRootMark } from "@/hooks/use-root-mark";
import { cn } from "@/lib/utils";
import "./product-window-chrome.css";
import "./app-shell.css";

export function ProductLoadingIndicator() {
	return (
		<output
			aria-busy="true"
			className="flex min-h-0 flex-1 items-center justify-center"
		>
			{/* A CSS image resolves from the app's own origin, also in the plugin. */}
			<span
				aria-hidden="true"
				className="size-12 bg-[url(/favicon-light.svg)] bg-contain bg-center bg-no-repeat dark:bg-[url(/favicon-dark.svg)]"
			/>
			<span className="sr-only">Loading workspace</span>
		</output>
	);
}

// Keep the product frame visible while auth and workspace access resolve.
// The interactive sidebar only mounts once the correct workspace is active.
export function ProductLoadingScreen({ children }: { children?: ReactNode }) {
	useRootMark("data-app-shell");
	return (
		<div className="product-app-shell dashboard-01-preview flex h-dvh overflow-hidden overscroll-none text-foreground">
			{/* Matches the sidebar's footprint so the window doesn't jump when the
			    real sidebar mounts. */}
			<div
				aria-hidden="true"
				data-variant="inset"
				className="peer hidden w-56 shrink-0 md:block"
			/>
			<ShellWindowColumn
				footer={
					import.meta.env.MODE === "plugin" ? null : (
						<ShellWindowFooterPlaceholder />
					)
				}
			>
				<SidebarInset
					className={cn(
						"dashboard-01-window min-h-0 overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)]",
						shellWindowRadiusClassName,
					)}
				>
					{children ?? <ProductLoadingIndicator />}
				</SidebarInset>
			</ShellWindowColumn>
		</div>
	);
}
