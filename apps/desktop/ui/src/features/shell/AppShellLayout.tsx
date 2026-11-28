import * as React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppToaster } from "@/app/ui/AppToaster";
import { SessionArrivalNotifications } from "@/features/sessions/session-arrival-notifications";
import "@/app/app-surface.css";
import { useFirstOpenReady } from "@/app/first-open";
import { appRoutes, getCanonicalAppPath, isNewSessionPath } from "@/app/routes";
import { SidebarInset, SidebarProvider } from "@/app/ui/sidebar";
import { TooltipProvider } from "@/app/ui/tooltip";
import "@/features/dashboard/dashboard-theme.css";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { RetiredCliBanner } from "@/features/retired-cli/RetiredCliBanner";
import { ServiceStatusBanner } from "@/features/service-status/ServiceStatusBanner";
import "./product-window-chrome.css";
import "./welcome-shell.css";
import "./app-shell.css";
import { useCompassEnabled } from "@/features/compass/use-compass-access";
import { ShellDashboardRangeControls } from "@/features/costs/dashboard-range-controls";
import { AppSidebar } from "@/features/shell/components/AppSidebar";
import { LastSessionUploadBar } from "@/features/shell/components/last-session-upload-bar";
import { SiteHeader } from "@/features/shell/components/SiteHeader";
import { ShellWindowColumn } from "@/features/shell/components/shell-window-column";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { NewseshListHeaderPortalContext } from "@/features/shell/newsesh-list-header-portal";
import { ShellBottomNavigationPortalContext } from "@/features/shell/shell-bottom-navigation-portal";
import { shellChromeStyle } from "@/features/shell/shell-chrome-style";
import { ShellHeaderPortalContext } from "@/features/shell/shell-header-portal";
import { ShellOnboardingPanelContext } from "@/features/shell/shell-onboarding-panel";
import { useRootMark } from "@/hooks/use-root-mark";
import { cn } from "@/lib/utils";

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

export function LeftSidebarAppShellLayout() {
	const navigate = useNavigate();
	const demo = useDemoRuntime();
	const location = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const canonicalPathname = getCanonicalAppPath(location.pathname);
	const isWelcome = canonicalPathname === CLI_SETUP_PATH;
	useRootMark("data-app-shell");
	useRootMark("data-welcome-shell", isWelcome);
	useFirstOpenReady();
	const [onboardingPanel, setOnboardingPanel] =
		React.useState<HTMLElement | null>(null);
	const isSessionOverviewRoute = canonicalPathname === appRoutes.session();
	const isSessionWorkspaceRoute =
		isSessionOverviewRoute ||
		canonicalPathname.startsWith(`${appRoutes.session()}/`) ||
		isNewSessionPath(canonicalPathname);
	const isDashboardWorkspaceRoute = canonicalPathname === appRoutes.dashboard();
	const isHomeWorkspaceRoute = canonicalPathname === appRoutes.home();
	const isSkillsWorkspaceRoute = [
		appRoutes.skills(),
		appRoutes.mcp(),
		appRoutes.compass(),
		appRoutes.repos(),
	].includes(canonicalPathname);
	const isSettingsWorkspaceRoute =
		canonicalPathname === appRoutes.settings() ||
		canonicalPathname.startsWith(`${appRoutes.settings()}/`);
	const isFixedWorkspaceRoute =
		isWelcome ||
		isHomeWorkspaceRoute ||
		isDashboardWorkspaceRoute ||
		isSessionWorkspaceRoute ||
		isSkillsWorkspaceRoute ||
		isSettingsWorkspaceRoute;
	const [shellHeaderPortal, setShellHeaderPortal] =
		React.useState<HTMLElement | null>(null);
	const [newseshListHeaderPortal, setNewseshListHeaderPortal] =
		React.useState<HTMLElement | null>(null);
	// The plugin host and onboarding have no workspace sessions to date.
	const showLastSessionUpload = import.meta.env.MODE !== "plugin" && !isWelcome;
	const compassEnabled = useCompassEnabled();

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
			if (
				!canonicalNextPath ||
				(canonicalNextPath === appRoutes.compass() && !compassEnabled)
			) {
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
	}, [
		getShellRoutePath,
		location.pathname,
		navigate,
		isWelcome,
		compassEnabled,
	]);

	const shellWindowContent = (
		<>
			{import.meta.env.MODE !== "plugin" && !demo && !isWelcome ? (
				<>
					<ServiceStatusBanner />
					<RetiredCliBanner />
				</>
			) : null}
			{isHomeWorkspaceRoute ? null : (
				<SiteHeader
					// Rendered here rather than portaled by the page, so the
					// prerendered demo has them in place from its first paint.
					actions={
						isDashboardWorkspaceRoute ? <ShellDashboardRangeControls /> : null
					}
					setNewseshListPortalHost={setNewseshListHeaderPortal}
					setPortalHost={setShellHeaderPortal}
					showWorkspaceMenu={false}
				/>
			)}
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col overscroll-none",

					isFixedWorkspaceRoute ? "overflow-hidden" : "overflow-auto",
				)}
			>
				<div
					className={cn(
						"@container/main flex min-h-0 flex-1 flex-col",
						!isFixedWorkspaceRoute && "gap-m",
					)}
				>
					<div
						className={cn(
							"flex min-h-0 flex-1 flex-col",
							isFixedWorkspaceRoute && "overflow-hidden",
							!isFixedWorkspaceRoute && "gap-xl py-xl md:gap-xxl md:py-xxl",
						)}
					>
						<Outlet />
					</div>
				</div>
			</div>
		</>
	);

	return (
		<ShellOnboardingPanelContext.Provider value={onboardingPanel}>
			<TooltipProvider>
				<ShellHeaderPortalContext.Provider value={shellHeaderPortal}>
					<NewseshListHeaderPortalContext.Provider
						value={newseshListHeaderPortal}
					>
						<ShellBottomNavigationPortalContext.Provider value={null}>
							<div
								className={cn(
									"dashboard-01-preview h-dvh overflow-hidden overscroll-none text-ink",
									isWelcome && "cli-welcome-shell",
									!demo && !isWelcome && "product-app-shell",
								)}
								data-cli-setup={
									canonicalPathname === CLI_SETUP_PATH ? "" : undefined
								}
							>
								{isWelcome ? (
									<div className="cli-welcome-panel" ref={setOnboardingPanel} />
								) : null}
								<div
									className={cn(
										"h-full min-h-0",
										isWelcome && "product-window-frame",
									)}
									inert={isWelcome || undefined}
								>
									<SidebarProvider
										className="group/shell dashboard-01-chrome-frame desktop-drag-wrapper relative h-full min-h-0 overflow-clip overscroll-none"
										style={shellChromeStyle}
									>
										<AppSidebar fillHeight={isWelcome} />
										<ShellWindowColumn
											footer={
												showLastSessionUpload ? <LastSessionUploadBar /> : null
											}
										>
											<SidebarInset>{shellWindowContent}</SidebarInset>
										</ShellWindowColumn>
									</SidebarProvider>
								</div>
							</div>
						</ShellBottomNavigationPortalContext.Provider>
					</NewseshListHeaderPortalContext.Provider>
				</ShellHeaderPortalContext.Provider>
				{import.meta.env.MODE !== "plugin" && !demo && !isWelcome ? (
					<SessionArrivalNotifications />
				) : null}
				<AppToaster richColors position="bottom-right" />
			</TooltipProvider>
		</ShellOnboardingPanelContext.Provider>
	);
}
