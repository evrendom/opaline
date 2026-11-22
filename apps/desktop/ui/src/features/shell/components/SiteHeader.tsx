import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { appRoutes, getSessionDetailId, isNewSessionPath } from "@/app/routes";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { Separator } from "@/app/ui/separator";
import { SidebarTrigger } from "@/app/ui/sidebar";
import { Skeleton } from "@/app/ui/skeleton";
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
					<SidebarTrigger className="size-7 corner-s text-ink-3 hover:bg-hover hover:text-ink md:hidden" />
					<Separator
						orientation="vertical"
						className="data-vertical:h-4 data-vertical:self-auto md:hidden"
					/>
				</>
			) : null}
			{import.meta.env.MODE !== "plugin" && showWorkspaceMenu ? (
				<div className="flex shrink-0 items-center gap-xs">
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
			!!new URLSearchParams(location.search).get("repo")) ||
		(currentShellRoute.id === "mcp" &&
			!!new URLSearchParams(location.search).get("mcp"));
	const shortSessionId = sessionDetailId?.split("-")[0] ?? "";
	const sessionModel = useSessionModel(sessionDetailId);
	const modelPending = sessionDetailId !== null && sessionModel === undefined;
	const modelChip = sessionModel ? (
		<ModelChip model={sessionModel} />
	) : modelPending ? (
		<Skeleton className="size-4.5 shrink-0 corner-full" />
	) : null;
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
					? "p-zero"
					: // Page header: no rule underneath, the section chip
						// beside a larger title, aligned with the page's 32px gutter.
						"h-14 gap-m edge-b-none pt-m pr-[calc(var(--space-xxl)*4/3)] pl-[calc(var(--space-xxl)*4/3)]"
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
					{/* design-escape-ok(type): shipped value; -0.025em title tracking */}
					<h1 className="flex min-w-0 items-center gap-s text-body-xxl font-medium tracking-[-0.025em]">
						{/* Back link only lifts its text on hover. Its own fluid
						    root keeps it out of the header's sliding hover fill. */}
						<Link
							to={getShellRoutePath(appRoutes.session())}
							data-fluid-menu-root=""
							className={cn(
								"group/back flex shrink-0 items-center gap-m",
								"text-ink-3 transition-colors",
								"hover:text-ink",
							)}
						>
							<span className="flex opacity-60 grayscale transition group-hover/back:opacity-100 group-hover/back:grayscale-0">
								<ShellNavIcon
									icon={currentShellRoute.icon}
									activeIcon={currentShellRoute.activeIcon}
									active
									tone={currentShellRoute.tone}
								/>
							</span>
							{currentShellRoute.title}
						</Link>
						<IconChevronRight
							aria-hidden="true"
							className={"size-4 shrink-0 text-ink-disabled"}
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
							<span className={cn("shrink-0", sessionMuted && "text-ink-3")}>
								{formatModelDisplayLabel(sessionModel)}
							</span>
						) : modelPending ? (
							<Skeleton
								// design-escape-ok(radius): shipped value; 4px corner
								className="h-3.5 w-16 shrink-0 rounded-[4px] corner-squircle squircle:corner-s"
							/>
						) : null}
						<span className={cn("shrink-0", sessionMuted && "text-ink-3")}>
							Session
						</span>
						{readingSubagent ? (
							<Link
								to={mainThreadPath}
								data-fluid-menu-root=""
								title={sessionDetailId}
								className="truncate text-ink-3 transition-colors hover:text-ink"
							>
								{shortSessionId}
							</Link>
						) : (
							<span
								title={sessionDetailId}
								className={cn("truncate", sessionMuted && "text-ink-3")}
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
						className={cn(
							"hidden min-w-0 items-center gap-m",
							"pr-m pl-[calc(var(--space-xl)+var(--space-xxs))]",
							"bg-inset",
							"lg:flex lg:w-[var(--session-list-pane-width,29.8125rem)] lg:flex-none",
						)}
					>
						<FluidMenuHover items='button, a[href], [role="button"]' />
						{showSidebarTrigger ? (
							<SidebarTrigger className="size-7 shrink-0 corner-s text-ink-2 hover:bg-hover-strong hover:text-ink" />
						) : (
							<SiteHeaderLeadingControls
								showSidebarTrigger={showSidebarTrigger}
								showWorkspaceMenu={showWorkspaceMenu}
							/>
						)}
						<h1 className="truncate text-body-l font-medium tracking-m text-balance text-ink">
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
						className={cn(
							"relative z-10 flex min-w-0 flex-1 items-center gap-m",
							"edge-l-m px-m",
							"border-line bg-canvas",
						)}
					>
						<FluidMenuHover items='button, a[href], [role="button"]' />
						<div className="flex shrink-0 items-center gap-m lg:hidden">
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
						<h1
							// design-escape-ok(type): shipped value; -0.025em title tracking
							className="flex min-w-0 items-center gap-m text-body-xxl font-medium tracking-[-0.025em]"
						>
							<ShellNavIcon
								icon={currentShellRoute.icon}
								activeIcon={currentShellRoute.activeIcon}
								active
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
