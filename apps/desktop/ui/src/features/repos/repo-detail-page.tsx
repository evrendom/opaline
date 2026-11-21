import type {
	RepositoryPullRequest,
	RepositorySummary,
} from "@rudel/api-routes";
import { IconChevronRight, IconFolder } from "@tabler/icons-react";
import {
	Activity,
	type ComponentProps,
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { EmptyState } from "@/components/dashboard/page-parts";
import { DateRangeOverride } from "@/features/analytics/date-range/DateRangeProvider";
import type { DashboardVariant } from "@/features/costs/cost-dashboard-page";
import { CostDashboardView } from "@/features/costs/cost-dashboard-page";
import {
	DotPickContext,
	DotPreviewContext,
} from "@/features/costs/cost-hover-date";
import { UsageSelectionProvider } from "@/features/costs/plan-usage/usage-selection";
import { useRepositoryCostDashboard } from "@/features/costs/use-cost-dashboard";
import {
	type DotFilterRange,
	useDotFilter,
} from "@/features/costs/use-dot-filter";
import {
	useMetricPreviews,
	usePrefetchDashboardMetric,
} from "@/features/costs/use-metric-previews";
import { UsageSessionsPane } from "@/features/sessions/components/session-usage-detail";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { SessionInRepo } from "@/features/sessions/reader/session-reader-in-repo";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { CopyButton } from "@/features/shell/components/copy-button";
import {
	RepoNavIcon,
	useRepositoryHue,
} from "@/features/shell/components/repo-nav-icon";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import {
	ShellHeaderPortalContext,
	useShellHeaderPortal,
} from "@/features/shell/shell-header-portal";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { cn } from "@/lib/utils";
import { RepoCiView } from "./repo-ci-view";
import { RepoFiles } from "./repo-files";
import {
	RepoDataProvider,
	useRepoRangeInput,
} from "./repo-reader/repo-page-data";
import {
	type RailFilter,
	RailHighlightProvider,
	useRailFilter,
} from "./repo-reader/repo-rail-highlight";
import { RepoSessionBoxes } from "./repo-reader/repo-session-boxes";
import { RepoSetupView } from "./repo-reader/repo-setup-view";
import {
	type RepoReaderTab,
	RepoReaderTabs,
	readRepoTab,
} from "./repo-reader-tabs";
import { SkillPage } from "./repo-skill-page";
import {
	githubRepositoryIds,
	useRepoDashboardRepositories,
} from "./use-repo-dashboard-repositories";
import { useRepoPullRequests } from "./use-repo-pull-requests";

const TAB_STATE_PARAMS = ["from", "to", "metric", "interval", "split"] as const;

function openDuring(
	pull: RepositoryPullRequest,
	range: { startDate: string; endDate: string },
) {
	const opened = pull.createdAt?.slice(0, 10);
	const ended = (pull.mergedAt ?? pull.closedAt)?.slice(0, 10);
	return (
		(!opened || opened <= range.endDate) && (!ended || ended >= range.startDate)
	);
}

const RepoFocusContext = createContext<DotFilterRange | null>(null);

function RepoSessionsList(props: ComponentProps<typeof UsageSessionsPane>) {
	const focus = useContext(RepoFocusContext);
	const [days, setDays] = useState<ReadonlySet<string> | null>(null);
	const onVisibleSessions = useCallback(
		(rows: readonly { session_date: string }[]) => {
			const next = new Set(rows.map((row) => row.session_date.slice(0, 10)));
			setDays((current) =>
				current &&
				current.size === next.size &&
				[...next].every((day) => current.has(day))
					? current
					: next,
			);
		},
		[],
	);
	const filter = useMemo<RailFilter | null>(
		() =>
			days && days.size > 0 ? { days, figures: null, name: "Sessions" } : null,
		[days],
	);
	useRailFilter(filter);
	return (
		<UsageSessionsPane
			{...props}
			focus={focus}
			onVisibleSessions={onVisibleSessions}
		/>
	);
}

const SETUP_TABS = ["instructions", "skills", "mcp"] as const;

const TAB_PANE =
	"absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden";

const STAGE_PANE =
	"absolute inset-x-0 top-(--stage-top) bottom-0 left-[calc(var(--reader-gutter)-1.5rem)] flex min-h-0 min-w-0 flex-col overflow-hidden";

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
	const openSessionId = searchParams.get("session");
	const requested = readRepoTab(
		searchParams.get("tab"),
		openSessionId !== null,
	);
	const pulls = useRepoPullRequests(repoKey);
	const range = useRepoRangeInput();
	const { dotPick, pickedRange, preview, shownRange } = useDotFilter(range);
	const allPullRequests = pulls.data?.enabled ? pulls.data.pullRequests : [];
	const pullRequests = useMemo(
		() => allPullRequests.filter((pull) => openDuring(pull, range)),
		[allPullRequests, range],
	);
	const ci = allPullRequests.length > 0;
	const tab =
		requested === "ci" && pulls.isSuccess && !ci ? "summary" : requested;
	const skillName = tab === "skills" ? searchParams.get("skill") : null;
	const sessionId = tab === "sessions" ? openSessionId : null;
	const [headerControls, setHeaderControls] = useState<HTMLDivElement | null>(
		null,
	);
	const [clickedTab, setClickedTab] = useState<{
		from: RepoReaderTab;
		to: RepoReaderTab;
	} | null>(null);
	if (clickedTab && clickedTab.from !== tab) setClickedTab(null);
	const shownTab = clickedTab ? clickedTab.to : tab;
	const summaryPane = useMemo(
		() => (
			<div className="flex h-full min-h-0 min-w-0 flex-col pt-m pr-[calc(var(--space-xxl)*4/3)] pb-m pl-xxl">
				<RepoSessionBoxes fill />
			</div>
		),
		[],
	);
	const panes = useMemo(() => {
		const list: { id: RepoReaderTab; node: ReactNode }[] = SETUP_TABS.map(
			(section) => ({
				id: section,
				node: (
					<div className={TAB_PANE}>
						<RepoSetupView repoKey={repoKey} section={section} />
					</div>
				),
			}),
		);
		list.push({
			id: "files",
			node: (
				<div className={TAB_PANE}>
					<RepoFiles repoKey={repoKey} />
				</div>
			),
		});
		if (ci)
			list.push({
				id: "ci",
				node: (
					<div className={TAB_PANE}>
						<RepoCiView pullRequests={pullRequests} repoKey={repoKey} />
					</div>
				),
			});
		list.push({
			id: "sessions",
			node: (
				<div className={TAB_PANE} data-rail-beside>
					<div
						className={cn(
							SESSION_OVERVIEW_SURFACE_CLASS_NAME,
							"bg-transparent",
						)}
					>
						<RepoSessionsList
							kind="Repo"
							sessionFilter={{ repoKey }}
							range={range}
							sessionCount={undefined}
							rowHighlightClassName="corner-m corner-squircle squircle:corner-xl-inner"
							detailHref={(id) =>
								id
									? appRoutes.repoDetail(repoKey, id)
									: `${appRoutes.repoDetail(repoKey)}&tab=sessions`
							}
							navigationHost={headerControls}
							backBar={false}
						/>
					</div>
				</div>
			),
		});
		return list;
	}, [ci, headerControls, pullRequests, range, repoKey]);
	function closeSession() {
		setSearchParams((current) => {
			const params = new URLSearchParams(current);
			params.delete("session");
			params.delete("turn");
			params.set("tab", "sessions");
			return params;
		});
	}
	function selectTab(next: RepoReaderTab, skill?: string) {
		setClickedTab({ from: tab, to: next });
		setSearchParams((current) => {
			const params = new URLSearchParams({ repo: repoKey });
			for (const key of TAB_STATE_PARAMS) {
				const value = current.get(key);
				if (value !== null) params.set(key, value);
			}
			if (next !== "summary") params.set("tab", next);
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
	const sessionsProps: ComponentProps<typeof UsageSessionsPane> = {
		kind: "Repo",
		sessionFilter: { repoKey },
		range: pickedRange
			? { startDate: pickedRange.start, endDate: pickedRange.end }
			: range,
		sessionCount: undefined,
		rowHighlightClassName: "corner-m corner-squircle squircle:corner-xl-inner",
		detailHref: (id) =>
			id
				? appRoutes.repoDetail(repoKey, id)
				: `${appRoutes.repoDetail(repoKey)}&tab=sessions`,
		navigationHost: headerControls,
		backBar: false,
	};
	const sessions = <UsageSessionsPane {...sessionsProps} />;
	return (
		<div className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-inset text-ink [--reader-page:var(--canvas)]">
			<RepoDetailHeader
				repoKey={repoKey}
				name={name}
				onBack={onBack}
				sessionId={sessionId}
				onBackToSessions={closeSession}
				setControls={setHeaderControls}
			/>
			<h1 className="sr-only">{name}</h1>
			{sessionId ? (
				<SessionInRepo.Provider value>
					<div className={SESSION_OVERVIEW_SURFACE_CLASS_NAME}>{sessions}</div>
				</SessionInRepo.Provider>
			) : (
				<RepoDataProvider repoKey={repoKey}>
					<DotPickContext.Provider value={dotPick}>
						<RepoFocusContext.Provider value={shownRange}>
							<UsageSelectionProvider>
								<RailHighlightProvider tab={shownTab}>
									<div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden [--dashboard-01-content-background:var(--dashboard-01-stage-background)] [--panes-top:calc(var(--stage-top)-0.125rem)] [--stage-top:--spacing(2)] [--tabs-band:--spacing(19)]">
										<div
											aria-hidden="true"
											className="pointer-events-none absolute top-(--stage-top) right-0 bottom-0 left-(--reader-gutter) -z-10 -ml-xxl corner-tl-m bg-(--dashboard-01-stage-background) corner-squircle squircle:corner-tl-xl"
										/>
										{headerControls
											? createPortal(
													<RepoReaderTabs
														ci={ci}
														onChange={(next) => selectTab(next)}
														value={shownTab}
													/>,
													headerControls,
												)
											: null}
										{
											<div
												className={cn(
													STAGE_PANE,
													"flex-row [--cost-page-gutter:--spacing(6)]",
												)}
											>
												<ShellHeaderPortalContext.Provider value={null}>
													<div className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto">
														<DotPreviewContext.Provider value={preview}>
															<RepoDashboard
																repoKey={repoKey}
																variant="rail-chat"
															/>
														</DotPreviewContext.Provider>
													</div>
												</ShellHeaderPortalContext.Provider>
												<div className="relative min-w-0 flex-1">
													<Activity
														mode={shownTab === "summary" ? "visible" : "hidden"}
													>
														{summaryPane}
													</Activity>
													<DateRangeOverride range={pickedRange}>
														{panes.map(({ id, node }) => (
															<Activity
																key={id}
																mode={shownTab === id ? "visible" : "hidden"}
															>
																{node}
															</Activity>
														))}
													</DateRangeOverride>
												</div>
											</div>
										}
									</div>
								</RailHighlightProvider>
							</UsageSelectionProvider>
						</RepoFocusContext.Provider>
					</DotPickContext.Provider>
				</RepoDataProvider>
			)}
		</div>
	);
}

/** The workspace dashboard, filtered to this repo: its sessions, and its
 * pull requests and CI runs when GitHub is connected for it. */
const WAITING_PREVIEWS = {};

function RepoDashboard({
	repoKey,
	variant,
}: {
	repoKey: string;
	variant?: DashboardVariant;
}) {
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
		hasRepositories && githubRepositories !== undefined,
	);
	const waiting =
		hasRepositories &&
		(githubRepositories === undefined || previews.pending === true);
	const prefetchMetric = usePrefetchDashboardMetric(
		dashboard.inputFor,
		hasRepositories,
	);
	if (repositories.isError || repositories.data?.length === 0)
		return (
			<div className="px-[calc(var(--space-xxl)*4/3)] py-xxl">
				<EmptyState
					icon={IconFolder}
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
			previews={waiting ? WAITING_PREVIEWS : previews}
			onMetricIntent={prefetchMetric}
			scope="repository"
			variant={variant}
			waiting={waiting}
		/>
	);
}

/** The page title in the shell header: a `[icon] Repos › [repo] name`
 * breadcrumb whose section leads back to the list, extended by the open
 * session's id (the repo crumb then leads back to its sessions), and a slot
 * at the row's right end for the open session's controls. */
function RepoDetailHeader({
	repoKey,
	name,
	onBack,
	sessionId,
	onBackToSessions,
	setControls,
}: {
	repoKey: string;
	name: string;
	onBack: () => void;
	sessionId: string | null;
	onBackToSessions: () => void;
	setControls: (element: HTMLDivElement | null) => void;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	const repoHue = useRepositoryHue(repoKey);
	if (!headerPortal) return null;
	const crumbClassName =
		"flex items-center gap-s text-ink-3 transition-colors hover:text-ink";
	const separator = (
		<IconChevronRight
			aria-hidden="true"
			// design-escape-ok(opacity): no role renders this; ink-3/50
			className="size-4 shrink-0 text-ink-3/50"
			stroke={1.5}
		/>
	);
	const repoLabel = (
		<>
			<RepoNavIcon hue={repoHue} active={!sessionId} />
			<span className="truncate">{name}</span>
		</>
	);
	return createPortal(
		<>
			<nav
				aria-label="Repo breadcrumb"
				className="flex min-w-0 flex-1 items-center gap-s text-body-xxl font-medium"
			>
				<button
					type="button"
					onClick={onBack}
					data-fluid-menu-root=""
					className={cn(crumbClassName, "shrink-0 gap-m")}
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
							className="flex min-w-0 items-center gap-s"
						>
							{/* The Sessions section's own chip, colour included. */}
							<ShellNavIcon
								icon={shellRouteMap.sessions.icon}
								activeIcon={shellRouteMap.sessions.activeIcon}
								active
								tone={shellRouteMap.sessions.tone}
							/>
							<span className="truncate">{sessionId}</span>
							<CopyButton value={sessionId} title="Copy session ID" />
						</span>
					</>
				) : (
					<span aria-current="page" className="flex min-w-0 items-center gap-s">
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
