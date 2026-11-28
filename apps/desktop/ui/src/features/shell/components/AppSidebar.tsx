import { IntroReveal } from "@/app/ui/bones";

("use client");

import { Link } from "react-router-dom";
import { routePreloadHandlers } from "@/app/route-loaders";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
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
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { DesktopWindowBar } from "@/features/shell/components/desktop-window-bar";
import { SidebarRepositories } from "@/features/shell/components/SidebarRepositories";
import { SidebarUserMenu } from "@/features/shell/components/SidebarUserMenu";
import { SidebarWorkspaceSwitcher } from "@/features/shell/components/SidebarWorkspaceSwitcher";
import {
	restingChipClassName,
	restingGlyphClassName,
	ShellNavIcon,
} from "@/features/shell/components/shell-nav-icon";
import { SidebarStarCard } from "@/features/shell/components/star-card/SidebarStarCard";
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

export function SidebarNavItem({
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
						{...routePreloadHandlers(getShellRoutePath(route.path))}
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

export function SidebarNavTile({
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
				{...routePreloadHandlers(getShellRoutePath(route.path))}
				data-active={active || undefined}
				title={route.navLabel}
				className={cn(
					"flex h-10 w-full items-center justify-center",
					"corner-m corner-squircle edge-m",
					"border-(--opal-ring) bg-(--opal-fill) focus-outline transition-[background-color,border-color] duration-(--motion-duration)",
					"squircle:corner-xl-inner",
					active && route.tone ? route.tone.chip : restingChipClassName,
					!active &&
						"hover:[--opal-fill:color-mix(in_oklab,var(--dashboard-01-rail-active)_55%,white)] dark:[--opal-fill:rgb(255_255_255/0.03)] dark:[--opal-ring:rgb(255_255_255/0.05)] dark:hover:[--opal-fill:rgb(255_255_255/0.06)]",
				)}
			>
				<Glyph
					aria-hidden="true"
					className={cn(
						"size-[18px] transition-colors duration-(--motion-duration)",
						active && route.tone ? route.tone.glyph : restingGlyphClassName,
					)}
				/>
				<span className="sr-only">{route.navLabel}</span>
			</Link>
		</li>
	);
}

export function AppSidebar({
	fillHeight = false,
}: {
	/** Fill the parent's height instead of the viewport's (the welcome
	 *  window frame). */
	fillHeight?: boolean;
} = {}) {
	const currentShellRoute = useCurrentShellRoute();
	const localApp = useLocalDesktopApp();
	const visibleRoutes = primaryRoutes;

	return (
		<Sidebar
			variant="inset"
			collapsible="offcanvas"
			rootClassName={fillHeight ? "h-full" : undefined}
		>
			{/* One highlight glides between rows on hover (Opaline's fluid
			    hover), tinted like a row hover. */}
			<div
				data-fluid-menu-root=""
				className="flex min-h-0 flex-1 flex-col antialiased [--fluid-fill:var(--sidebar-accent)]"
			>
				<FluidMenuHover items="[data-sidebar-interactive]" bridgeGap={12} />
				{/* The plugin's host already titles it "Opaline". */}
				{import.meta.env.MODE === "plugin" ? null : (
					<SidebarHeader data-desktop-drag="">
						<DesktopWindowBar />
						<IntroReveal label="Workspace">
							<SidebarWorkspaceSwitcher />
						</IntroReveal>
					</SidebarHeader>
				)}

				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<nav aria-label="Primary">
								<ul className="grid grid-cols-4 gap-s px-xs pt-xxs">
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
						<IntroReveal label="Repositories">
							<SidebarRepositories
								reposActive={currentShellRoute.id === "repos"}
							/>
						</IntroReveal>
					)}
				</SidebarContent>

				{/* Only the Mac app asks; the hook shows nothing without its bridge. */}
				<SidebarStarCard />

				{localApp ? null : (
					<SidebarFooter>
						<SidebarMenu>
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
				)}
			</div>
		</Sidebar>
	);
}
