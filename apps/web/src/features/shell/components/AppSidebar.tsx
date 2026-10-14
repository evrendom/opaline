"use client";

import { Link } from "react-router-dom";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/app/ui/sidebar";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { useAgentTracesEnabled } from "@/features/agent-traces/use-agent-traces-access";
import { SidebarInstallCommand } from "@/features/shell/components/SidebarInstallCommand";
import { SidebarUserMenu } from "@/features/shell/components/SidebarUserMenu";
import { SidebarWorkspaceSwitcher } from "@/features/shell/components/SidebarWorkspaceSwitcher";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import {
	type ShellRouteDefinition,
	shellNavigationRoutes,
} from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";

const primaryRoutes = shellNavigationRoutes.filter(
	(route) => route.id !== "settings",
);
const footerRoutes = shellNavigationRoutes.filter(
	(route) => route.id === "settings",
);

function SidebarNavItem({
	route,
	active,
}: {
	route: ShellRouteDefinition;
	active: boolean;
}) {
	const getShellRoutePath = useShellRoutePath();

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				data-sidebar-interactive=""
				isActive={active}
				render={
					<Link
						to={getShellRoutePath(route.path)}
						aria-current={active ? "page" : undefined}
					/>
				}
			>
				<ShellNavIcon
					icon={route.icon}
					activeIcon={route.activeIcon}
					active={active}
					tone={route.tone}
				/>
				<span>{route.navLabel}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function AppSidebar() {
	const currentShellRoute = useCurrentShellRoute();
	// Agent traces shows only in the workspaces it is open to.
	const agentTracesEnabled = useAgentTracesEnabled();
	const visibleRoutes = primaryRoutes.filter(
		(route) => route.id !== "agentTraces" || agentTracesEnabled,
	);

	return (
		<Sidebar variant="inset" collapsible="offcanvas">
			{/* One highlight glides between rows on hover (Opaline's fluid
			    hover), tinted like a row hover. */}
			<div
				data-fluid-menu-root=""
				className="flex min-h-0 flex-1 flex-col [--session-overview-hover:color-mix(in_oklab,var(--sidebar-accent)_70%,transparent)]"
			>
				<FluidMenuHover items="[data-sidebar-interactive]" bridgeGap={12} />
				{/* The plugin's host already titles it "Opaline". */}
				{import.meta.env.MODE === "plugin" ? null : (
					<SidebarHeader>
						<SidebarWorkspaceSwitcher />
					</SidebarHeader>
				)}

				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<nav aria-label="Primary">
								<SidebarMenu>
									{visibleRoutes.map((route) => (
										<SidebarNavItem
											key={route.id}
											route={route}
											active={currentShellRoute.id === route.id}
										/>
									))}
								</SidebarMenu>
							</nav>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter>
					<SidebarMenu>
						<SidebarInstallCommand />
						{footerRoutes.map((route) => (
							<SidebarNavItem
								key={route.id}
								route={route}
								active={currentShellRoute.id === route.id}
							/>
						))}
						<SidebarUserMenu />
					</SidebarMenu>
				</SidebarFooter>
			</div>
		</Sidebar>
	);
}
