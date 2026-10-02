"use client";

import { Sidebar } from "@/app/ui/sidebar";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { RailLink } from "@/features/shell/components/shell-rail";
import { UserRailButton } from "@/features/shell/components/UserRailButton";
import { WorkspaceMenuButton } from "@/features/shell/components/WorkspaceMenuButton";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { cn } from "@/lib/utils";

type SidebarLayout = "centered" | "standard";

const sidebarRailHorizontalPaddingClassName =
	"pl-[calc(var(--sidebar-rail-inset-left)+var(--sidebar-collapsed-section-padding-x))] pr-[calc(var(--sidebar-rail-inset-right)+var(--sidebar-collapsed-section-padding-x))]";
// 22px total: the standard 2px gap plus the requested 20px.
const centeredSidebarNavigationGapClassName = "gap-5.5";

function SidebarNavigation({ spacious = false }: { spacious?: boolean }) {
	const currentShellRoute = useCurrentShellRoute();
	const getShellRoutePath = useShellRoutePath();

	return (
		<nav aria-label="Primary">
			<ul
				className={cn(
					"flex list-none flex-col",
					spacious ? centeredSidebarNavigationGapClassName : "gap-0.5",
				)}
			>
				{shellNavigationRoutes.map((route) => (
					<RailLink
						key={route.id}
						to={getShellRoutePath(route.path)}
						label={route.navLabel}
						shortcut={route.shortcut}
						comingSoon={route.comingSoon}
						active={currentShellRoute.id === route.id}
					>
						{route.icon}
					</RailLink>
				))}
			</ul>
		</nav>
	);
}

export function AppSidebar({
	layout = "standard",
}: {
	layout?: SidebarLayout;
}) {
	const isCenteredLayout = layout === "centered";

	return (
		<Sidebar collapsible="icon" className="dashboard-01-chrome-sidebar">
			<div
				data-slot="sidebar-inner"
				data-fluid-menu-root=""
				className={cn(
					"relative flex size-full min-w-0 flex-col overflow-hidden bg-transparent",
					!isCenteredLayout && "pb-3",
				)}
			>
				<FluidMenuHover items="[data-sidebar-interactive]" />
				{/* The plugin's host already titles it "Opaline". */}
				{isCenteredLayout || import.meta.env.MODE === "plugin" ? null : (
					<div
						className={`mt-[var(--sidebar-section-first-margin-top)] flex w-full flex-col ${sidebarRailHorizontalPaddingClassName}`}
					>
						<WorkspaceMenuButton />
					</div>
				)}

				<div
					data-sidebar-navigation-stage
					className={cn(
						"relative min-h-0 w-full flex-1",
						isCenteredLayout && "flex items-center",
					)}
				>
					<div
						data-sidebar-navigation-cluster
						className={cn(
							"w-full",
							sidebarRailHorizontalPaddingClassName,
							!isCenteredLayout && "absolute top-3 left-0",
						)}
					>
						<SidebarNavigation spacious={isCenteredLayout} />
					</div>
				</div>

				{isCenteredLayout ? null : (
					<div
						className={`w-full pl-[calc(var(--sidebar-rail-inset-left)+var(--sidebar-collapsed-footer-padding-x))] pr-[calc(var(--sidebar-rail-inset-right)+var(--sidebar-collapsed-footer-padding-x))]`}
					>
						<UserRailButton />
					</div>
				)}
			</div>
		</Sidebar>
	);
}
