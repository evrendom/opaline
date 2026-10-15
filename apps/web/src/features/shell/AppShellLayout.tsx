import type { CSSProperties } from "react";
import * as React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppToaster } from "@/app/ui/AppToaster";
import { SessionArrivalNotifications } from "@/features/sessions/session-arrival-notifications";
import "@/app/app-surface.css";
import { appRoutes, getCanonicalAppPath, isNewSessionPath } from "@/app/routes";
import { SidebarInset, SidebarProvider } from "@/app/ui/sidebar";
import { TooltipProvider } from "@/app/ui/tooltip";
import "@/features/dashboard/dashboard-theme.css";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { CliUpdateNotice } from "@/features/cli-update/CliUpdateNotice";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { ServiceStatusBanner } from "@/features/service-status/ServiceStatusBanner";
import "./product-window-chrome.css";
import "./welcome-shell.css";
import "./app-shell.css";
import { useAgentTracesEnabled } from "@/features/agent-traces/use-agent-traces-access";
import {
	AssistantPanel,
	useAssistantShortcut,
} from "@/features/assistant/AssistantPanel";
import { useCompassEnabled } from "@/features/compass/use-compass-access";
import { AppSidebar } from "@/features/shell/components/AppSidebar";
import { LastSessionUploadBar } from "@/features/shell/components/last-session-upload-bar";
import { SiteHeader } from "@/features/shell/components/SiteHeader";
import {
	ShellWindowColumn,
	shellWindowRadiusClassName,
} from "@/features/shell/components/shell-window-column";
import { shellNavigationRoutes } from "@/features/shell/config/shell-routes";
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

export function LeftSidebarAppShellLayout() {
	const navigate = useNavigate();
	const demo = useDemoRuntime();
	const location = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const canonicalPathname = getCanonicalAppPath(location.pathname);
	const isWelcome = canonicalPathname === CLI_SETUP_PATH;
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
		appRoutes.agentTraces(),
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
	// The assistant lives in the full product only: the plugin host has its own
	// chat, and the marketing demo and onboarding stay focused. Its replies are
	// placeholders for now, so it stays out of production builds.
	const assistantAvailable =
		import.meta.env.DEV &&
		import.meta.env.MODE !== "plugin" &&
		!demo &&
		!isWelcome;
	// The plugin host and onboarding have no workspace sessions to date.
	const showLastSessionUpload = import.meta.env.MODE !== "plugin" && !isWelcome;
	const [assistantOpen, setAssistantOpen] = React.useState(false);
	const openAssistant = React.useCallback(() => setAssistantOpen(true), []);
	useAssistantShortcut(openAssistant, assistantAvailable && !assistantOpen);
	const agentTracesEnabled = useAgentTracesEnabled();
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
				(canonicalNextPath === appRoutes.agentTraces() &&
					!agentTracesEnabled) ||
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
		agentTracesEnabled,
		compassEnabled,
	]);

	const shellWindowContent = (
		<>
			{import.meta.env.MODE !== "plugin" && !demo && !isWelcome ? (
				<ServiceStatusBanner />
			) : null}
			{isHomeWorkspaceRoute ? null : (
				<SiteHeader
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
			{import.meta.env.MODE !== "plugin" && !demo && !isWelcome ? (
				<CliUpdateNotice />
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
						<ShellBottomNavigationPortalContext.Provider value={null}>
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
										className="group/shell dashboard-01-chrome-frame relative h-full min-h-0 overflow-clip overscroll-none"
										style={defaultChromeStyle}
									>
										<AppSidebar />
										<ShellWindowColumn
											footer={
												showLastSessionUpload ? <LastSessionUploadBar /> : null
											}
										>
											<SidebarInset
												className={cn(
													"dashboard-01-window min-h-0 min-w-0 overflow-hidden overscroll-none bg-[var(--dashboard-01-content-background)]",
													shellWindowRadiusClassName,
												)}
											>
												{shellWindowContent}
												{/* Lights up the window's right edge while the panel's
												    resize handle is hovered or dragged. */}
												<div
													aria-hidden="true"
													className="pointer-events-none absolute inset-0 z-10 rounded-lg border-r border-border/80 opacity-0 transition-opacity duration-200 group-has-[[data-assistant-resize]:hover]/shell:opacity-100 group-has-[[data-assistant-resize][data-resizing]]/shell:opacity-100 squircle:rounded-3xl corner-squircle"
												/>
											</SidebarInset>
										</ShellWindowColumn>
										{assistantAvailable ? (
											<AssistantPanel
												open={assistantOpen}
												onOpenChange={setAssistantOpen}
											/>
										) : null}
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
