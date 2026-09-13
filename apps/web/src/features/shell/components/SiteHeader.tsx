import { useLocation } from "react-router-dom";
import { isNewSessionPath, isSessionDetailPath } from "@/app/routes";
import { Separator } from "@/app/ui/separator";
import { SidebarTrigger } from "@/app/ui/sidebar";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { sessionPaneMotionStyle } from "@/features/sessions/components/session-pane-motion";
import {
	getActiveSettingsRouteId,
	settingsRouteMap,
} from "@/features/settings/config/settings-routes";
import { DashboardHeader } from "@/features/shell/components/dashboard-header";
import { WorkspaceMenuButton } from "@/features/shell/components/WorkspaceMenuButton";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { cn } from "@/lib/utils";

function SiteHeaderLeadingControls({
	showSidebarTrigger,
	showWorkspaceMenu,
}: {
	showSidebarTrigger: boolean;
	showWorkspaceMenu: boolean;
}) {
	return (
		<>
			{showSidebarTrigger ? (
				<>
					<SidebarTrigger className="size-7 rounded-md text-[color:var(--dashboard-01-rail-icon)] hover:bg-[color:var(--dashboard-01-rail-hover)] hover:text-[color:var(--dashboard-01-rail-icon-active)] md:hidden" />
					<Separator
						orientation="vertical"
						className="data-vertical:h-4 data-vertical:self-auto md:hidden"
					/>
				</>
			) : null}
			{showWorkspaceMenu ? (
				<div className="flex shrink-0 items-center gap-1">
					<WorkspaceMenuButton variant="header" />
					<Separator
						orientation="vertical"
						className="data-vertical:h-4 data-vertical:self-auto"
					/>
				</div>
			) : null}
		</>
	);
}

export function SiteHeader({
	setNewseshListPortalHost,
	setPortalHost,
	showSidebarTrigger = false,
	showWorkspaceMenu = true,
}: {
	setNewseshListPortalHost: (element: HTMLElement | null) => void;
	setPortalHost: (element: HTMLElement | null) => void;
	showSidebarTrigger?: boolean;
	showWorkspaceMenu?: boolean;
}) {
	const location = useLocation();
	const currentShellRoute = useCurrentShellRoute();
	const isSessionDetail = isSessionDetailPath(location.pathname);
	const isNewSession = isNewSessionPath(location.pathname);
	const isSessionsRoute = currentShellRoute.id === "sessions";
	const title =
		location.pathname === CLI_SETUP_PATH
			? "Sessions"
			: currentShellRoute.id === "settings"
				? settingsRouteMap[getActiveSettingsRouteId(location.pathname)].label
				: currentShellRoute.title;

	return (
		<DashboardHeader
			className={cn(
				isSessionDetail ? "p-0" : "gap-1 pr-2",
				!isSessionDetail && (isSessionsRoute ? "pl-4.5" : "pl-2"),
			)}
		>
			{isSessionDetail ? (
				<div className="flex min-h-0 min-w-0 flex-1 self-stretch">
					<div
						data-slot="session-list-header-pane"
						className={cn(
							"hidden min-w-0 items-center gap-2",
							isNewSession
								? "bg-[#fcfcfc] pr-2 pl-4.5 lg:flex lg:w-[var(--session-list-pane-width,29.8125rem)] lg:flex-none"
								: "pr-2 pl-4.5 sm:flex sm:w-[var(--session-list-pane-width,clamp(20rem,34vw,40rem))] sm:flex-none",
						)}
					>
						{isNewSession && showSidebarTrigger ? (
							<SidebarTrigger className="size-7 shrink-0 rounded-md text-[#5b5c5e] hover:bg-[#ececed] hover:text-[#1b1b1b]" />
						) : (
							<SiteHeaderLeadingControls
								showSidebarTrigger={showSidebarTrigger}
								showWorkspaceMenu={showWorkspaceMenu}
							/>
						)}
						<h1
							className={cn(
								"truncate text-[0.8125rem]/5 font-medium tracking-normal text-balance",
								isNewSession
									? "text-[#1b1b1b]"
									: "text-[color:var(--dashboardy-heading)]",
							)}
						>
							Sessions
						</h1>
						{isNewSession ? (
							<div
								ref={setNewseshListPortalHost}
								className="flex min-w-0 flex-1 items-center"
							/>
						) : null}
					</div>
					<div
						data-slot="session-detail-header-pane"
						style={sessionPaneMotionStyle}
						className={cn(
							"relative z-10 flex min-w-0 flex-1 items-center gap-2 border-l border-black/6 bg-[var(--dashboard-01-content-background)] px-2 dark:border-white/8",
							!isNewSession &&
								"shadow-[-4px_0_10px_-8px_rgba(0,0,0,0.18)] dark:shadow-[-4px_0_10px_-8px_rgba(0,0,0,0.5)]",
						)}
					>
						<div
							className={cn(
								"flex shrink-0 items-center gap-2",
								isNewSession ? "lg:hidden" : "sm:hidden",
							)}
						>
							<SiteHeaderLeadingControls
								showSidebarTrigger={showSidebarTrigger}
								showWorkspaceMenu={showWorkspaceMenu}
							/>
						</div>
						<div
							ref={setPortalHost}
							className="flex min-w-0 flex-1 items-center"
						/>
					</div>
				</div>
			) : (
				<>
					<SiteHeaderLeadingControls
						showSidebarTrigger={showSidebarTrigger}
						showWorkspaceMenu={showWorkspaceMenu}
					/>
					<h1 className="truncate text-[0.8125rem]/5 font-medium tracking-normal text-balance">
						{title}
					</h1>
					<div
						ref={setPortalHost}
						className="ml-auto flex min-w-0 flex-1 items-center justify-end"
					/>
				</>
			)}
		</DashboardHeader>
	);
}
