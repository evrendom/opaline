import "@/app/app-surface.css";
import { SidebarInset } from "@/app/ui/sidebar";
import { getDefaultSidebarShellTuningState } from "@/features/shell/config/sidebar-shell-debug";
import "./product-window-chrome.css";

const sidebarWidth = `${getDefaultSidebarShellTuningState().collapsedWidth}rem`;

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
export function ProductLoadingScreen() {
	return (
		<div className="product-app-shell dashboard-01-preview flex h-dvh overflow-hidden overscroll-none text-foreground">
			<div
				aria-hidden="true"
				className="hidden shrink-0 md:block"
				style={{ width: sidebarWidth }}
			/>
			<SidebarInset className="dashboard-01-window min-h-0 overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] md:m-(--dashboard-01-window-inset) md:ml-0 md:rounded-(--dashboard-01-window-radius) md:shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_0_rgba(0,0,0,0.04)]">
				<ProductLoadingIndicator />
			</SidebarInset>
		</div>
	);
}
