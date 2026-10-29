import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { appRoutes, getSessionDetailId, isNewSessionPath } from "@/app/routes";
import { Separator } from "@/app/ui/separator";
import { SidebarTrigger } from "@/app/ui/sidebar";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { sessionPaneMotionStyle } from "@/features/sessions/components/session-pane-motion";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import {
	AGENT_PARAM,
	writeAgent,
} from "@/features/sessions/reader/reader-params";
import { useSessionModel } from "@/features/sessions/use-session-model";
import { CopyButton } from "@/features/shell/components/copy-button";
import { DashboardHeader } from "@/features/shell/components/dashboard-header";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { WorkspaceMenuButton } from "@/features/shell/components/WorkspaceMenuButton";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import { shellCrumbFollows } from "@/features/shell/shell-header-portal";
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
			{import.meta.env.MODE !== "plugin" && showWorkspaceMenu ? (
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
	actions,
	setNewseshListPortalHost,
	setPortalHost,
	showSidebarTrigger = false,
	showWorkspaceMenu = true,
}: {
	/** The page's controls on the title row, rendered with the header. */
	actions?: ReactNode;
	setNewseshListPortalHost: (element: HTMLElement | null) => void;
	setPortalHost: (element: HTMLElement | null) => void;
	showSidebarTrigger?: boolean;
	showWorkspaceMenu?: boolean;
}) {
	const location = useLocation();
	const currentShellRoute = useCurrentShellRoute();
	const getShellRoutePath = useShellRoutePath();
	const sessionDetailId = getSessionDetailId(location.pathname);
	const isNewSession = isNewSessionPath(location.pathname);
	const isCollectionDetail =
		(currentShellRoute.id === "skills" &&
			!!new URLSearchParams(location.search).get("skill")) ||
		(currentShellRoute.id === "repos" &&
			!!new URLSearchParams(location.search).get("repo"));
	const shortSessionId = sessionDetailId?.split("-")[0] ?? "";
	const sessionModel = useSessionModel(sessionDetailId);
	const modelChip = sessionModel ? <ModelChip model={sessionModel} /> : null;
	const params = new URLSearchParams(location.search);
	const readingSubagent = params.has(AGENT_PARAM);
	writeAgent(params, null);
	const mainThreadPath = `${location.pathname}${params.size ? `?${params}` : ""}`;
	const crumbFollows = useSyncExternalStore(
		shellCrumbFollows.subscribe,
		shellCrumbFollows.get,
		shellCrumbFollows.get,
	);
	const sessionMuted = readingSubagent || crumbFollows;
	// Settings shows its section in the tabs, so the header names the page.
	const title =
		location.pathname === CLI_SETUP_PATH ? "Sessions" : currentShellRoute.title;

	return (
		<DashboardHeader
			className={
				isNewSession
					? "p-0"
					: // Page header: no rule underneath, the section chip
						// beside a larger title, aligned with the page's 32px gutter.
						"h-14 gap-2 border-b-0 pt-2 pr-6 pl-8"
			}
		>
			{sessionDetailId !== null ? (
				<>
					<SiteHeaderLeadingControls
						showSidebarTrigger={showSidebarTrigger}
						showWorkspaceMenu={showWorkspaceMenu}
					/>
					{/* Detail breadcrumb: the section links back to the list,
					    the session id is the page title. */}
					<h1 className="flex min-w-0 items-center gap-1.5 text-base font-medium tracking-tight">
						{/* Back link only lifts its text on hover. Its own fluid
						    root keeps it out of the header's sliding hover fill. */}
						<Link
							to={getShellRoutePath(appRoutes.session())}
							data-fluid-menu-root=""
							className="group/back flex shrink-0 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
						>
							<span className="flex opacity-60 grayscale transition group-hover/back:opacity-100 group-hover/back:grayscale-0">
								<ShellNavIcon
									icon={currentShellRoute.icon}
									activeIcon={currentShellRoute.activeIcon}
									active
									filled={false}
									tone={currentShellRoute.tone}
								/>
							</span>
							{currentShellRoute.title}
						</Link>
						<IconChevronRight
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground/50"
							stroke={1.5}
						/>
						{modelChip ? (
							<span
								className={cn(
									"flex shrink-0",
									sessionMuted && "opacity-60 grayscale",
								)}
							>
								{modelChip}
							</span>
						) : null}
						{sessionModel ? (
							<span
								className={cn(
									"shrink-0",
									sessionMuted && "text-muted-foreground",
								)}
							>
								{formatModelDisplayLabel(sessionModel)}
							</span>
						) : null}
						<span
							className={cn(
								"shrink-0",
								sessionMuted && "text-muted-foreground",
							)}
						>
							Session
						</span>
						{readingSubagent ? (
							<Link
								to={mainThreadPath}
								replace
								data-fluid-menu-root=""
								title={sessionDetailId}
								className="truncate text-muted-foreground transition-colors hover:text-foreground"
							>
								{shortSessionId}
							</Link>
						) : (
							<span
								title={sessionDetailId}
								className={cn(
									"truncate",
									sessionMuted && "text-muted-foreground",
								)}
							>
								{shortSessionId}
							</span>
						)}
						<CopyButton value={sessionDetailId} title="Copy session ID" />
					</h1>
					<div
						ref={setPortalHost}
						className="ml-auto flex min-w-0 flex-1 items-center justify-end"
					/>
				</>
			) : isNewSession ? (
				<div className="flex min-h-0 min-w-0 flex-1 self-stretch">
					<div
						data-slot="session-list-header-pane"
						data-fluid-menu-root=""
						className="hidden min-w-0 items-center gap-2 bg-[#fcfcfc] pr-2 pl-4.5 lg:flex lg:w-[var(--session-list-pane-width,29.8125rem)] lg:flex-none"
					>
						<FluidMenuHover items='button, a[href], [role="button"]' />
						{showSidebarTrigger ? (
							<SidebarTrigger className="size-7 shrink-0 rounded-md text-[#5b5c5e] hover:bg-[#ececed] hover:text-[#1b1b1b]" />
						) : (
							<SiteHeaderLeadingControls
								showSidebarTrigger={showSidebarTrigger}
								showWorkspaceMenu={showWorkspaceMenu}
							/>
						)}
						<h1 className="truncate text-[0.8125rem]/5 font-medium tracking-normal text-balance text-[#1b1b1b]">
							Sessions
						</h1>
						<div
							ref={setNewseshListPortalHost}
							className="flex min-w-0 flex-1 items-center"
						/>
					</div>
					<div
						data-slot="session-detail-header-pane"
						data-fluid-menu-root=""
						style={sessionPaneMotionStyle}
						className="relative z-10 flex min-w-0 flex-1 items-center gap-2 border-l border-black/6 bg-[var(--dashboard-01-content-background)] px-2 dark:border-white/8"
					>
						<FluidMenuHover items='button, a[href], [role="button"]' />
						<div className="flex shrink-0 items-center gap-2 lg:hidden">
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
					{!isCollectionDetail ? (
						<h1 className="flex min-w-0 items-center gap-2 text-base font-medium tracking-tight">
							<ShellNavIcon
								icon={currentShellRoute.icon}
								activeIcon={currentShellRoute.activeIcon}
								active
								filled={false}
								tone={currentShellRoute.tone}
							/>
							<span className="truncate">{title}</span>
						</h1>
					) : null}
					<div
						ref={setPortalHost}
						className="ml-auto flex min-w-0 flex-1 items-center justify-end"
					>
						{actions}
					</div>
				</>
			)}
		</DashboardHeader>
	);
}
