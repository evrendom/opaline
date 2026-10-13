import type { RepositorySummary } from "@rudel/api-routes";
import { IconChevronRight, IconFolderFilled } from "@tabler/icons-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { EmptyState } from "@/components/dashboard/page-parts";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { CostDashboardView } from "@/features/costs/cost-dashboard-page";
import { useRepositoryCostDashboard } from "@/features/costs/use-cost-dashboard";
import {
	useMetricPreviews,
	usePrefetchDashboardMetric,
} from "@/features/costs/use-metric-previews";
import { UsageSessionsPane } from "@/features/sessions/components/session-usage-detail";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { CopyButton } from "@/features/shell/components/copy-button";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import {
	ShellHeaderPortalContext,
	useShellHeaderPortal,
} from "@/features/shell/shell-header-portal";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { PillTabs } from "./pill-tabs";
import { SkillPage } from "./repo-skill-page";
import { RepoSkillsTable } from "./repo-skills-table";
import {
	githubRepositoryIds,
	useRepoDashboardRepositories,
} from "./use-repo-dashboard-repositories";

const REPO_TABS = [
	{
		id: "dashboard",
		label: shellRouteMap.dashboard.navLabel,
		icon: shellRouteMap.dashboard.activeIcon,
	},
	{
		id: "skills",
		label: shellRouteMap.skills.navLabel,
		icon: shellRouteMap.skills.activeIcon,
	},
	{
		id: "sessions",
		label: shellRouteMap.sessions.navLabel,
		icon: shellRouteMap.sessions.activeIcon,
	},
] as const;
type RepoTab = (typeof REPO_TABS)[number]["id"];
// Page-wide state that outlives a tab switch: the date range and the
// dashboard's chart settings.
const TAB_STATE_PARAMS = ["from", "to", "metric", "interval", "split"] as const;

/** One repository: the workspace dashboard scoped to it, its skills and its
 * sessions, one tab each (`?tab=`, dashboard by default). */
export function RepoDetailPage({
	repoKey,
	repo,
	onBack,
}: {
	repoKey: string;
	repo: RepositorySummary | undefined;
	onBack: () => void;
}) {
	const name = repo?.identity.repoLabel ?? repoKey.replace(/^[^:]+:/u, "");
	const [searchParams, setSearchParams] = useSearchParams();
	// Session links (`repoDetail(repoKey, sessionId)`) open on the Sessions tab.
	const tab: RepoTab =
		REPO_TABS.find(({ id }) => id === searchParams.get("tab"))?.id ??
		(searchParams.get("session") ? "sessions" : "dashboard");
	const skillName = tab === "skills" ? searchParams.get("skill") : null;
	const [tabControls, setTabControls] = useState<HTMLDivElement | null>(null);
	const [headerControls, setHeaderControls] = useState<HTMLDivElement | null>(
		null,
	);
	const openSessionId = tab === "sessions" ? searchParams.get("session") : null;
	function closeSession() {
		setSearchParams((current) => {
			const params = new URLSearchParams(current);
			params.delete("session");
			params.delete("turn");
			// Session links don't name the tab; without the session it would
			// fall back to the dashboard.
			params.set("tab", "sessions");
			return params;
		});
	}
	// Each tab starts clean: no open session or skill, no list filters.
	function selectTab(next: RepoTab, skill?: string) {
		setSearchParams((current) => {
			const params = new URLSearchParams({ repo: repoKey });
			for (const key of TAB_STATE_PARAMS) {
				const value = current.get(key);
				if (value !== null) params.set(key, value);
			}
			if (next !== "dashboard") params.set("tab", next);
			if (skill) params.set("skill", skill);
			return params;
		});
	}
	if (skillName)
		return (
			<SkillPage
				key={skillName}
				repo={{
					key: repoKey,
					name,
					onBack: () => selectTab("skills"),
				}}
				skillName={skillName}
				onBackToList={onBack}
			/>
		);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<RepoDetailHeader
				name={name}
				onBack={onBack}
				sessionId={openSessionId}
				onBackToSessions={closeSession}
				setControls={setHeaderControls}
			/>
			{/* The tab row under the page header: 24px in, so the first tab's
			    icon lines up with the breadcrumb's section icon above it
			    (the pill's 10px inset); the range controls sit at its right
			    end, on the 32px gutter. An open session gives the page to its
			    detail; the breadcrumb leads back to the sessions. */}
			{openSessionId ? null : (
				<PillTabs
					tabs={REPO_TABS}
					value={tab}
					onChange={(next) => selectTab(next)}
					label="Repo views"
					layoutId="repo-tab-bg"
					className="pr-8 pl-6"
					trailing={
						<div
							ref={setTabControls}
							className="flex min-w-0 items-center justify-end"
						/>
					}
				/>
			)}
			<h1 className="sr-only">{name}</h1>
			{tab === "dashboard" ? (
				tabControls ? (
					<ShellHeaderPortalContext.Provider value={tabControls}>
						<RepoDashboard repoKey={repoKey} />
					</ShellHeaderPortalContext.Provider>
				) : null
			) : tab === "skills" ? (
				<RepoSkills
					repoKey={repoKey}
					onOpenSkill={(skill) => selectTab("skills", skill)}
				/>
			) : (
				<div className={SESSION_OVERVIEW_SURFACE_CLASS_NAME}>
					<UsageSessionsPane
						kind="Repo"
						sessionFilter={{ repoKey }}
						sessionCount={repo?.sessionCount}
						detailHref={(sessionId) =>
							sessionId
								? appRoutes.repoDetail(repoKey, sessionId)
								: `${appRoutes.repoDetail(repoKey)}&tab=sessions`
						}
						navigationHost={headerControls}
						backBar={false}
					/>
				</div>
			)}
		</div>
	);
}

/** The workspace dashboard, filtered to this repo: its sessions, and its
 * pull requests and CI runs when GitHub is connected for it. */
function RepoDashboard({ repoKey }: { repoKey: string }) {
	const repositories = useRepoDashboardRepositories(repoKey);
	const { state } = useOrganization();
	const github = useGitHubConnection(state.activeOrg?.id ?? null).query;
	const githubRepositories = !repositories.data
		? undefined
		: github.data?.visibility === "visible"
			? githubRepositoryIds(
					repositories.data,
					github.data.connection.repositories,
				)
			: github.isPending
				? undefined
				: [];
	const dashboard = useRepositoryCostDashboard(
		repositories.data,
		githubRepositories,
	);
	const hasRepositories = (repositories.data?.length ?? 0) > 0;
	const previews = useMetricPreviews(
		dashboard.inputFor,
		dashboard.metrics,
		dashboard.input,
		hasRepositories,
	);
	const prefetchMetric = usePrefetchDashboardMetric(
		dashboard.inputFor,
		hasRepositories,
	);
	if (repositories.isError || repositories.data?.length === 0)
		return (
			<div className="px-8 py-6">
				<EmptyState
					icon={IconFolderFilled}
					title={
						repositories.isError
							? "This repo’s dashboard couldn’t load"
							: "No sessions in this repo yet"
					}
					description={
						repositories.isError ? "Try loading this view again." : undefined
					}
				/>
			</div>
		);
	return (
		<CostDashboardView
			dashboard={dashboard}
			previews={previews}
			onMetricIntent={prefetchMetric}
			scope="repository"
		/>
	);
}

function RepoSkills({
	repoKey,
	onOpenSkill,
}: {
	repoKey: string;
	onOpenSkill: (skill: string) => void;
}) {
	const query = useAnalyticsQuery(
		orpc.analytics.repositories.detail.queryOptions({ input: { repoKey } }),
	);
	return (
		<div
			className={cn(
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
				"overflow-y-auto overscroll-none",
			)}
		>
			<RepoSkillsTable
				skills={query.data?.skills}
				isError={query.isError}
				isPending={query.isPending}
				onRetry={() => {
					void query.refetch();
				}}
				onOpenSkill={onOpenSkill}
			/>
		</div>
	);
}

/** The page title in the shell header: a `[icon] Repos › [repo] name`
 * breadcrumb whose section leads back to the list, extended by the open
 * session's id (the repo crumb then leads back to its sessions), and a slot
 * at the row's right end for the open session's controls. */
function RepoDetailHeader({
	name,
	onBack,
	sessionId,
	onBackToSessions,
	setControls,
}: {
	name: string;
	onBack: () => void;
	sessionId: string | null;
	onBackToSessions: () => void;
	setControls: (element: HTMLDivElement | null) => void;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	if (!headerPortal) return null;
	const crumbClassName =
		"flex cursor-pointer items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground";
	const separator = (
		<IconChevronRight
			aria-hidden="true"
			className="size-4 shrink-0 text-muted-foreground/50"
			stroke={1.5}
		/>
	);
	// The repo crumb wears the Repos chip, lit only while it is the page you
	// are on (the header keeps the outline glyph).
	const repoLabel = (
		<>
			<ShellNavIcon
				icon={shellRouteMap.repos.icon}
				activeIcon={shellRouteMap.repos.activeIcon}
				active={!sessionId}
				filled={false}
				tone={shellRoute.tone}
			/>
			<span className="truncate">{name}</span>
		</>
	);
	return createPortal(
		<>
			<nav
				aria-label="Repo breadcrumb"
				className="flex min-w-0 flex-1 items-center gap-1.5 text-base font-medium tracking-tight"
			>
				<button
					type="button"
					onClick={onBack}
					data-fluid-menu-root=""
					className={cn(crumbClassName, "shrink-0 gap-2")}
				>
					<ShellNavIcon
						icon={shellRoute.icon}
						activeIcon={shellRoute.activeIcon}
						active={false}
						tone={shellRoute.tone}
					/>
					{shellRoute.title}
				</button>
				{separator}
				{sessionId ? (
					<>
						<button
							type="button"
							onClick={onBackToSessions}
							data-fluid-menu-root=""
							className={cn(crumbClassName, "min-w-0 shrink")}
						>
							{repoLabel}
						</button>
						{separator}
						<span
							aria-current="page"
							className="flex min-w-0 items-center gap-1.5"
						>
							{/* The Sessions section's own chip, colour included. */}
							<ShellNavIcon
								icon={shellRouteMap.sessions.icon}
								activeIcon={shellRouteMap.sessions.activeIcon}
								active
								filled={false}
								tone={shellRouteMap.sessions.tone}
							/>
							<span className="truncate">{sessionId}</span>
							<CopyButton value={sessionId} title="Copy session ID" />
						</span>
					</>
				) : (
					<span
						aria-current="page"
						className="flex min-w-0 items-center gap-1.5"
					>
						{repoLabel}
					</span>
				)}
			</nav>
			<div
				ref={setControls}
				data-fluid-menu-root=""
				className="flex min-w-0 shrink-0 items-center justify-end empty:hidden"
			/>
		</>,
		headerPortal,
	);
}
