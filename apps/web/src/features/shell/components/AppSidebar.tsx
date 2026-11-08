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
import { SidebarInstallCommand } from "@/features/shell/components/SidebarInstallCommand";
import { SidebarRepositories } from "@/features/shell/components/SidebarRepositories";
import { SidebarUserMenu } from "@/features/shell/components/SidebarUserMenu";
import { SidebarWorkspaceSwitcher } from "@/features/shell/components/SidebarWorkspaceSwitcher";
import {
	restingChipClassName,
	restingGlyphClassName,
	ShellNavIcon,
} from "@/features/shell/components/shell-nav-icon";
import {
	type ShellRouteDefinition,
	shellNavigationRoutes,
} from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { cn } from "@/lib/utils";

const primaryRoutes = shellNavigationRoutes.filter(
	(route) =>
		route.id !== "settings" && route.id !== "repos" && route.id !== "compass",
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

function SidebarNavTile({
	route,
	active,
}: {
	route: ShellRouteDefinition;
	active: boolean;
}) {
	const getShellRoutePath = useShellRoutePath();
	const Glyph = active ? route.activeIcon : route.icon;
	return (
		<li>
			<Link
				to={getShellRoutePath(route.path)}
				aria-current={active ? "page" : undefined}
				data-active={active || undefined}
				title={route.navLabel}
				className={cn(
					"flex h-10 w-full items-center justify-center rounded-[12px] corner-squircle squircle:rounded-[18px] border border-(--opal-ring) bg-(--opal-fill) outline-none transition-[background-color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
					active && route.tone ? route.tone.chip : restingChipClassName,
					!active &&
						"hover:[--opal-fill:color-mix(in_oklab,var(--dashboard-01-rail-active)_55%,white)] dark:[--opal-fill:rgb(255_255_255/0.03)] dark:[--opal-ring:rgb(255_255_255/0.05)] dark:hover:[--opal-fill:rgb(255_255_255/0.06)]",
				)}
			>
				<Glyph
					aria-hidden="true"
					className={cn(
						"size-[18px] transition-colors duration-150",
						active && route.tone ? route.tone.glyph : restingGlyphClassName,
					)}
				/>
				<span className="sr-only">{route.navLabel}</span>
			</Link>
		</li>
	);
}

export function AppSidebar() {
	const currentShellRoute = useCurrentShellRoute();
	const visibleRoutes = primaryRoutes;

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
								<ul className="grid grid-cols-4 gap-1.5 px-1 pt-0.5">
									{visibleRoutes.map((route) => (
										<SidebarNavTile
											key={route.id}
											route={route}
											active={currentShellRoute.id === route.id}
										/>
									))}
								</ul>
							</nav>
						</SidebarGroupContent>
					</SidebarGroup>
					{import.meta.env.MODE === "plugin" ? null : (
						<SidebarRepositories
							reposActive={currentShellRoute.id === "repos"}
						/>
					)}
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
