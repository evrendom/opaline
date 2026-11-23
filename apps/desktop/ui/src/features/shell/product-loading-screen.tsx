import { OpalineMark48 } from "@/app/bootstrap/opaline-mark";
import "@/app/app-surface.css";
import type { ReactNode } from "react";
import { SidebarInset } from "@/app/ui/sidebar";
import {
	ShellWindowColumn,
	ShellWindowFooterPlaceholder,
} from "@/features/shell/components/shell-window-column";
import { shellChromeStyle } from "@/features/shell/shell-chrome-style";
import { useRootMark } from "@/hooks/use-root-mark";
import "./product-window-chrome.css";
import "./app-shell.css";

export function ProductLoadingIndicator() {
	return (
		<output
			aria-busy="true"
			className="flex min-h-0 flex-1 items-center justify-center"
		>
			<OpalineMark48 />
			<span className="sr-only">Loading workspace</span>
		</output>
	);
}

// Keep the product frame visible while auth and workspace access resolve.
// The interactive sidebar only mounts once the correct workspace is active.
export function ProductLoadingScreen({ children }: { children?: ReactNode }) {
	useRootMark("data-app-shell");
	return (
		<div className="product-app-shell dashboard-01-preview flex h-dvh overflow-hidden overscroll-none text-ink">
			<div
				className="dashboard-01-chrome-frame relative flex h-full min-h-0 w-full overflow-clip overscroll-none"
				style={shellChromeStyle}
			>
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
					<SidebarInset>{children ?? <ProductLoadingIndicator />}</SidebarInset>
				</ShellWindowColumn>
			</div>
		</div>
	);
}
