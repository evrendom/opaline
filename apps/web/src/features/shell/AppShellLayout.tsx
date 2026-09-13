import type { CSSProperties } from "react";
import * as React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppToaster } from "@/app/ui/AppToaster";
import "@/app/app-surface.css";
import { appRoutes, getCanonicalAppPath, isNewSessionPath } from "@/app/routes";
import { SidebarInset, SidebarProvider } from "@/app/ui/sidebar";
import { TooltipProvider } from "@/app/ui/tooltip";
import "@/features/dashboard/dashboard-theme.css";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import "./product-window-chrome.css";
import { AppSidebar } from "@/features/shell/components/AppSidebar";
import { BottomNavigation } from "@/features/shell/components/BottomNavigation";
import { BottomRailNavigation } from "@/features/shell/components/BottomRailNavigation";
import { FloatingRowNavigation } from "@/features/shell/components/FloatingRowNavigation";
import { OlivettiRailNavigation } from "@/features/shell/components/OlivettiRailNavigation";
import { SiteHeader } from "@/features/shell/components/SiteHeader";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
import { getDefaultSidebarShellTuningState } from "@/features/shell/config/sidebar-shell-debug";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { NewseshListHeaderPortalContext } from "@/features/shell/newsesh-list-header-portal";
import { ShellBottomNavigationPortalContext } from "@/features/shell/shell-bottom-navigation-portal";
import { ShellHeaderPortalContext } from "@/features/shell/shell-header-portal";
import { ShellOnboardingPanelContext } from "@/features/shell/shell-onboarding-panel";
import { cn } from "@/lib/utils";

type DashboardChromeStyle = CSSProperties & {
	[customProperty: `--${string}`]: string | number | undefined;
};

const defaultDashboardChromeValues = {
	turbulence: {
		opacity: 0.18,
		highlightOpacity: 0.15,
		largeSize: 130,
		smallSize: 136,
		contrast: 190,
		darkness: 0.8,
	},
	shadow: {
		x: 0,
		y: 0,
		blur: 4,
		spread: 0,
		color: "#000000",
		opacity: 0.13,
	},
} as const;

function hexToRgba(hex: string, alpha: number) {
	const sanitized = hex.replace("#", "").trim();
	const normalized =
		sanitized.length === 3
			? sanitized
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: sanitized;

	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
		return `rgba(0, 0, 0, ${alpha})`;
	}

	const red = Number.parseInt(normalized.slice(0, 2), 16);
	const green = Number.parseInt(normalized.slice(2, 4), 16);
	const blue = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const defaultChromeStyle: DashboardChromeStyle = {
	"--dashboard-01-chrome-turbulence-opacity": `${defaultDashboardChromeValues.turbulence.opacity}`,
	"--dashboard-01-chrome-highlight-opacity": `${defaultDashboardChromeValues.turbulence.highlightOpacity}`,
	"--dashboard-01-chrome-noise-large-size": `${defaultDashboardChromeValues.turbulence.largeSize}px`,
	"--dashboard-01-chrome-noise-small-size": `${defaultDashboardChromeValues.turbulence.smallSize}px`,
	"--dashboard-01-chrome-turbulence-contrast": `${defaultDashboardChromeValues.turbulence.contrast}%`,
	"--dashboard-01-chrome-turbulence-darkness": `${defaultDashboardChromeValues.turbulence.darkness}`,
	"--dashboard-01-window-shadow": `${defaultDashboardChromeValues.shadow.x}px ${defaultDashboardChromeValues.shadow.y}px ${defaultDashboardChromeValues.shadow.blur}px ${defaultDashboardChromeValues.shadow.spread}px ${hexToRgba(defaultDashboardChromeValues.shadow.color, defaultDashboardChromeValues.shadow.opacity)}`,
};

const shellShortcutRouteByKey = shellNavigationRoutes.reduce<
	Record<string, string>
>((shortcutRouteMap, route) => {
	if (route.shortcut && !route.comingSoon) {
		shortcutRouteMap[route.shortcut.toLowerCase()] = route.path;
	}

	return shortcutRouteMap;
}, {});

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.isContentEditable) {
		return true;
	}

	const editableContainer = target.closest(
		'input, textarea, select, [contenteditable="true"], [role="textbox"]',
	);
	return editableContainer instanceof HTMLElement;
}

export function AppShellLayout() {
	return <ShellLayout navigationVariant="floating-dock" />;
}

export function BottomRailAppShellLayout() {
	return <ShellLayout navigationVariant="bottom-rail" />;
}

export function CenteredSidebarAppShellLayout() {
	return <ShellLayout navigationVariant="centered-sidebar" />;
}

export function OlivettiRailAppShellLayout() {
	return <ShellLayout navigationVariant="olivetti-rail" />;
}

export function FloatingRowAppShellLayout() {
	return <ShellLayout navigationVariant="floating-row" />;
}

export function LeftSidebarAppShellLayout() {
	return <ShellLayout navigationVariant="left-sidebar" />;
}

function ShellLayout({
	navigationVariant,
}: {
	navigationVariant:
		| "bottom-rail"
		| "centered-sidebar"
		| "floating-dock"
		| "floating-row"
		| "left-sidebar"
		| "olivetti-rail";
}) {
	const navigate = useNavigate();
	const demo = useDemoRuntime();
	const location = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const isBottomRailVariant = navigationVariant === "bottom-rail";
	const isCenteredSidebarVariant = navigationVariant === "centered-sidebar";
	const isFloatingDockVariant = navigationVariant === "floating-dock";
	const isFloatingRowVariant = navigationVariant === "floating-row";
	const isLeftSidebarVariant =
		navigationVariant === "left-sidebar" || isCenteredSidebarVariant;
	const isOlivettiRailVariant = navigationVariant === "olivetti-rail";
	const canonicalPathname = getCanonicalAppPath(location.pathname);
	const isWelcome = canonicalPathname === CLI_SETUP_PATH;
	const [onboardingPanel, setOnboardingPanel] =
		React.useState<HTMLElement | null>(null);
	const sidebarTuning = React.useMemo(getDefaultSidebarShellTuningState, []);
	const leftSidebarChromeStyle = React.useMemo<DashboardChromeStyle>(
		() => ({
			"--sidebar-width": `${sidebarTuning.collapsedWidth}rem`,
			"--sidebar-width-icon": `${sidebarTuning.collapsedWidth}rem`,
			"--header-height": "var(--dashboard-01-header-height)",
			"--sidebar-section-first-margin-top": `${sidebarTuning.sectionMarginTop}rem`,
			"--sidebar-rail-inset-left": `${sidebarTuning.railInsetLeft}rem`,
			"--sidebar-rail-inset-right": `${sidebarTuning.railInsetRight}rem`,
			"--sidebar-collapsed-section-padding-x": `${sidebarTuning.collapsedSectionPaddingX}rem`,
			"--sidebar-collapsed-footer-padding-x": `${sidebarTuning.collapsedFooterPaddingX}rem`,
			"--sidebar-row-height": `${sidebarTuning.rowHeight}rem`,
			"--sidebar-row-radius": `${sidebarTuning.rowRadius}rem`,
			"--sidebar-collapsed-row-padding-left": `${sidebarTuning.collapsedRowPaddingLeft}rem`,
			"--sidebar-collapsed-row-padding-right": `${sidebarTuning.collapsedRowPaddingRight}rem`,
			"--sidebar-row-gap": `${sidebarTuning.rowGap}rem`,
			"--sidebar-icon-lane-size": `${sidebarTuning.iconLaneSize}rem`,
			"--sidebar-icon-size": `${sidebarTuning.iconSize}rem`,
			"--sidebar-avatar-size": `${sidebarTuning.avatarSize}rem`,
			"--sidebar-row-idle-bg": sidebarTuning.rowIdleBg,
			"--sidebar-row-hover-bg": sidebarTuning.rowHoverBg,
			"--sidebar-row-active-bg": sidebarTuning.rowActiveBg,
			"--sidebar-row-fg": sidebarTuning.rowFg,
			"--sidebar-row-active-fg": sidebarTuning.rowActiveFg,
			...defaultChromeStyle,
		}),
		[sidebarTuning],
	);
	const isSessionOverviewRoute = canonicalPathname === appRoutes.session();
	const isSessionWorkspaceRoute =
		isSessionOverviewRoute ||
		canonicalPathname.startsWith(`${appRoutes.session()}/`) ||
		isNewSessionPath(canonicalPathname);
	const isDashboardWorkspaceRoute = canonicalPathname === appRoutes.dashboard();
	const isSkillsWorkspaceRoute = canonicalPathname === appRoutes.skills();
	const isSettingsWorkspaceRoute =
		canonicalPathname === appRoutes.settings() ||
		canonicalPathname.startsWith(`${appRoutes.settings()}/`);
	const isFixedWorkspaceRoute =
		isWelcome ||
		isDashboardWorkspaceRoute ||
		isSessionWorkspaceRoute ||
		isSkillsWorkspaceRoute ||
		isSettingsWorkspaceRoute;
	const [shellHeaderPortal, setShellHeaderPortal] =
		React.useState<HTMLElement | null>(null);
	const [newseshListHeaderPortal, setNewseshListHeaderPortal] =
		React.useState<HTMLElement | null>(null);
	const [shellBottomNavigationPortal, setShellBottomNavigationPortal] =
		React.useState<HTMLElement | null>(null);

	React.useEffect(() => {
		const handleShellShortcutKeyDown = (event: KeyboardEvent) => {
			if (
				isWelcome ||
				event.defaultPrevented ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey ||
				event.repeat ||
				isEditableTarget(event.target)
			) {
				return;
			}

			const canonicalNextPath =
				shellShortcutRouteByKey[event.key.toLowerCase()];
			if (!canonicalNextPath) {
				return;
			}

			const nextPath = getShellRoutePath(canonicalNextPath);
			if (location.pathname === nextPath) {
				return;
			}

			event.preventDefault();
			navigate(nextPath);
		};

		window.addEventListener("keydown", handleShellShortcutKeyDown);
		return () =>
			window.removeEventListener("keydown", handleShellShortcutKeyDown);
	}, [getShellRoutePath, location.pathname, navigate, isWelcome]);

	const shellWindowContent = (
		<>
			{isDashboardWorkspaceRoute || isSettingsWorkspaceRoute ? null : (
				<SiteHeader
					setNewseshListPortalHost={setNewseshListHeaderPortal}
					setPortalHost={setShellHeaderPortal}
					showWorkspaceMenu={isFloatingDockVariant}
				/>
			)}
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col overscroll-none",
					isSettingsWorkspaceRoute &&
						isFloatingDockVariant &&
						"pb-[calc(5rem+env(safe-area-inset-bottom))]",
					isSettingsWorkspaceRoute &&
						isFloatingRowVariant &&
						"pb-[calc(4.75rem+env(safe-area-inset-bottom))]",
					isFixedWorkspaceRoute
						? "overflow-hidden"
						: cn(
								"overflow-auto",
								isFloatingDockVariant &&
									"pb-[calc(5rem+env(safe-area-inset-bottom))]",
								isFloatingRowVariant &&
									"pb-[calc(4.75rem+env(safe-area-inset-bottom))]",
							),
				)}
			>
				<div
					className={cn(
						"@container/main flex min-h-0 flex-1 flex-col",
						!isFixedWorkspaceRoute && "gap-2",
					)}
				>
					<div
						className={cn(
							"flex min-h-0 flex-1 flex-col",
							isFixedWorkspaceRoute && "overflow-hidden",
							!isFixedWorkspaceRoute && "gap-4 py-4 md:gap-6 md:py-6",
						)}
					>
						<Outlet />
					</div>
				</div>
			</div>
			{isFloatingDockVariant ? (
				<BottomNavigation setPortalHost={setShellBottomNavigationPortal} />
			) : null}
		</>
	);

	return (
		<ShellOnboardingPanelContext.Provider value={onboardingPanel}>
			<TooltipProvider>
				<ShellHeaderPortalContext.Provider value={shellHeaderPortal}>
					<NewseshListHeaderPortalContext.Provider
						value={newseshListHeaderPortal}
					>
						<ShellBottomNavigationPortalContext.Provider
							value={shellBottomNavigationPortal}
						>
							{isLeftSidebarVariant ? (
								<div
									className={cn(
										"dashboard-01-preview h-dvh overflow-hidden overscroll-none text-foreground",
										isWelcome && "cli-welcome-shell",
										!demo && !isWelcome && "product-app-shell",
									)}
									data-cli-setup={
										canonicalPathname === CLI_SETUP_PATH ? "" : undefined
									}
								>
									{isWelcome ? (
										<div
											className="cli-welcome-panel"
											ref={setOnboardingPanel}
										/>
									) : null}
									<div
										className={cn(
											"h-full min-h-0",
											isWelcome && "product-window-frame",
										)}
										inert={isWelcome || undefined}
									>
										<SidebarProvider
											defaultOpen={false}
											open={false}
											className="dashboard-01-chrome-frame h-full overflow-hidden overscroll-none"
											style={leftSidebarChromeStyle}
										>
											<div className="contents" inert={isWelcome || undefined}>
												<AppSidebar
													layout={
														isCenteredSidebarVariant ? "centered" : "standard"
													}
												/>
											</div>
											<SidebarInset className="dashboard-01-window min-h-0 overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] md:m-(--dashboard-01-window-inset) md:ml-0 md:rounded-(--dashboard-01-window-radius) md:shadow-[0_3px_6px_-2px_rgba(0,0,0,0.02),0_1px_1px_0_rgba(0,0,0,0.04)]">
												{shellWindowContent}
											</SidebarInset>
										</SidebarProvider>
									</div>
								</div>
							) : (
								<div
									className={cn(
										"dashboard-01-preview dashboard-01-chrome-frame isolate h-dvh overflow-hidden overscroll-none text-foreground antialiased",
										isOlivettiRailVariant && "!shadow-none",
										isBottomRailVariant || isOlivettiRailVariant
											? "p-0"
											: "p-0 sm:p-(--dashboard-01-window-inset)",
									)}
									style={defaultChromeStyle}
								>
									{isBottomRailVariant ? (
										<div className="relative flex h-full min-h-0 flex-col overflow-hidden overscroll-none">
											<div className="dashboard-01-window relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] sm:mx-(--dashboard-01-window-inset) sm:mt-(--dashboard-01-window-inset) sm:rounded-(--dashboard-01-window-radius) sm:shadow-[var(--dashboard-01-window-shadow)] dark:shadow-none">
												{shellWindowContent}
											</div>
											<BottomRailNavigation />
										</div>
									) : isOlivettiRailVariant ? (
										<div className="relative flex h-full min-h-0 flex-col overflow-hidden overscroll-none">
											<div className="dashboard-01-window relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] !shadow-none">
												{shellWindowContent}
											</div>
											<OlivettiRailNavigation />
										</div>
									) : isFloatingRowVariant ? (
										<div className="relative flex h-full min-h-0 flex-col overflow-hidden overscroll-none">
											<div className="dashboard-01-window relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] sm:rounded-(--dashboard-01-window-radius) sm:shadow-[var(--dashboard-01-window-shadow)] dark:shadow-none">
												{shellWindowContent}
											</div>
											<FloatingRowNavigation />
										</div>
									) : (
										<div className="dashboard-01-window relative flex h-full min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)] sm:rounded-(--dashboard-01-window-radius) sm:shadow-[var(--dashboard-01-window-shadow)] dark:shadow-none">
											{shellWindowContent}
										</div>
									)}
								</div>
							)}
						</ShellBottomNavigationPortalContext.Provider>
					</NewseshListHeaderPortalContext.Provider>
				</ShellHeaderPortalContext.Provider>
				<AppToaster richColors position="bottom-right" />
			</TooltipProvider>
		</ShellOnboardingPanelContext.Provider>
	);
}
