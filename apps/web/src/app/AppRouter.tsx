import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import {
	generatePath,
	Navigate,
	Outlet,
	Route,
	Routes,
	useLocation,
	useParams,
} from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { loadSessionsPage } from "@/app/session-page-loader";
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { AcceptInvitationPage } from "@/features/invitations/AcceptInvitationPage";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { SessionReaderFallback } from "@/features/sessions/reader/session-reader-light-samples";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { settingsRouteMap } from "@/features/settings/config/settings-routes";
import { GitHubSettingsPage } from "@/features/settings/github/GitHubSettingsPage";
import { SettingsIndexRedirect } from "@/features/settings/SettingsIndexRedirect";
import { SettingsLayout } from "@/features/settings/SettingsLayout";
import { LeftSidebarAppShellLayout } from "@/features/shell/AppShellLayout";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { ProductLoadingIndicator } from "@/features/shell/product-loading-screen";
import { WorkspaceRoute } from "@/features/workspace/organization/workspace-route";

function lazyNamed<TModule extends Record<string, unknown>>(
	loader: () => Promise<TModule>,
	exportName: keyof TModule,
) {
	return lazy(async () => {
		const module = await loader();
		return {
			default: module[exportName] as ComponentType,
		};
	});
}

const AdminDashboardPage = lazyNamed(
	() => import("@/features/admin/AdminDashboardPage"),
	"AdminDashboardPage",
);
const RunQuestionsAdminPage = lazyNamed(
	() => import("@/features/admin/RunQuestionsAdminPage"),
	"RunQuestionsAdminPage",
);
const WorkspaceFeaturesAdminPage = lazyNamed(
	() => import("@/features/admin/WorkspaceFeaturesAdminPage"),
	"WorkspaceFeaturesAdminPage",
);
const AnnouncementPage = lazyNamed(
	() => import("@/features/announcement/AnnouncementPage"),
	"AnnouncementPage",
);
const CliOnboardingPage = lazyNamed(
	() => import("@/features/cli-onboarding/cli-onboarding-page"),
	"CliOnboardingPage",
);

const DashboardPage = lazyNamed(
	() => import("@/features/dashboard/DashboardPage"),
	"DashboardPage",
);
const SessionsPage = lazyNamed(loadSessionsPage, "SessionsPage");
const NewSessionPage = lazyNamed(
	() => import("@/features/sessions/new-session-page"),
	"NewSessionPage",
);
const ReposPage = lazyNamed(
	() => import("@/features/repos/repos-page"),
	"ReposPage",
);
const CompassPage = lazyNamed(
	() => import("@/features/compass/CompassPage"),
	"CompassPage",
);
const SkillsPage = lazyNamed(
	() => import("@/features/skills/SkillsPage"),
	"SkillsPage",
);
const McpPage = lazyNamed(() => import("@/features/mcp/McpPage"), "McpPage");
const WorkspaceSettingsPage = lazyNamed(
	() => import("@/features/settings/workspace/WorkspaceSettingsPage"),
	"WorkspaceSettingsPage",
);
const CreateWorkspacePage = lazyNamed(
	() => import("@/features/settings/workspace/components/CreateWorkspaceCard"),
	"CreateWorkspacePage",
);
const SessionsSettingsPage = lazyNamed(
	() => import("@/features/settings/sessions/sessions-settings-page"),
	"SessionsSettingsPage",
);
const ReportsSettingsPage = lazyNamed(
	() => import("@/features/settings/reports/ReportsSettingsPage"),
	"ReportsSettingsPage",
);
const MembersSettingsPage = lazyNamed(
	() => import("@/features/settings/members/MembersSettingsPage"),
	"MembersSettingsPage",
);
const AccountSettingsPage = lazyNamed(
	() => import("@/features/settings/account/AccountSettingsPage"),
	"AccountSettingsPage",
);
const McpSettingsPage = lazyNamed(
	() => import("@/features/self-hosted/McpSettingsPage"),
	"McpSettingsPage",
);
const ReportPage = lazyNamed(
	() => import("@/features/reports/ReportPage"),
	"ReportPage",
);
const TeamInviteAcceptPage = lazyNamed(
	() => import("@/features/team/TeamInviteAcceptPage"),
	"TeamInviteAcceptPage",
);
const LEGACY_DASHBOARDY_PATH = "/dashboardy";
const LEGACY_DASHBOARD_SESSIONS_PATH = "/dashboard/sessions";
const LEGACY_SESSION_FULL_PATH = "/session/full";
const LEGACY_SESSION_SPLIT_PATH = "/session/split";

type ShellRoutePaths = {
	home: string;
	compass: string;
	dashboard: string;
	session: string;
	skills: string;
	repos: string;
	mcp: string;
	team: string;
	settings: string;
	settingsMembers: string;
	settingsAccount: string;
	settingsWorkspace: string;
};

const canonicalShellRoutePaths: ShellRoutePaths = {
	home: appRoutes.home(),
	compass: appRoutes.compass(),
	dashboard: appRoutes.dashboard(),
	session: appRoutes.session(),
	skills: appRoutes.skills(),
	repos: appRoutes.repos(),
	mcp: appRoutes.mcp(),
	team: appRoutes.team(),
	settings: appRoutes.settings(),
	settingsMembers: appRoutes.settingsMembers(),
	settingsAccount: appRoutes.settingsAccount(),
	settingsWorkspace: appRoutes.settingsWorkspace(),
};

const workspaceShellRoutePaths: ShellRoutePaths = {
	home: "/:workspaceSlug/home",
	compass: "/:workspaceSlug/compass",
	dashboard: "/:workspaceSlug/dashboard",
	session: "/:workspaceSlug/sessions",
	skills: "/:workspaceSlug/skills",
	repos: "/:workspaceSlug/repos",
	mcp: "/:workspaceSlug/mcp",
	team: "/:workspaceSlug/team",
	settings: "/:workspaceSlug/settings",
	settingsMembers: "/:workspaceSlug/settings/members",
	settingsAccount: "/:workspaceSlug/settings/account",
	settingsWorkspace: "/:workspaceSlug/settings/workspace",
};

function ShellRedirect({ to }: { to: string }) {
	const params = useParams();
	const { search, hash } = useLocation();
	const [path, targetHash] = to.split("#", 2);
	return (
		<Navigate
			replace
			to={`${generatePath(path ?? to, params)}${search}${targetHash ? `#${targetHash}` : hash}`}
		/>
	);
}

function LegacySessionDetailRedirect() {
	const params = useParams<{ sessionId: string }>();

	return (
		<Navigate
			replace
			to={
				params.sessionId
					? appRoutes.sessionDetail(params.sessionId)
					: appRoutes.session()
			}
		/>
	);
}

function LazyRoute({
	Component,
	fallback = <ProductLoadingIndicator />,
}: {
	Component: ComponentType;
	fallback?: ReactNode;
}) {
	return (
		<Suspense fallback={fallback}>
			<Component />
		</Suspense>
	);
}

function getShellRouteElements(
	routePaths: ShellRoutePaths,
	SessionComponent: ComponentType = SessionsPage,
	DashboardComponent: ComponentType = DashboardPage,
	selfHosted = false,
) {
	return (
		<>
			<Route
				path={routePaths.home}
				element={<ShellRedirect to={routePaths.dashboard} />}
			/>
			<Route
				path={routePaths.dashboard}
				element={
					import.meta.env.PROD && shellRouteMap.dashboard.comingSoon ? (
						<ShellRedirect to={routePaths.session} />
					) : (
						<LazyRoute Component={DashboardComponent} />
					)
				}
			/>
			<Route
				path={`${routePaths.session}/:sessionId?`}
				element={
					<LazyRoute
						Component={SessionComponent}
						fallback={<SessionReaderFallback />}
					/>
				}
			/>
			<Route
				path={`${routePaths.session}/:sessionId/v2`}
				element={
					<LazyRoute
						Component={SessionComponent}
						fallback={<SessionReaderFallback />}
					/>
				}
			/>
			<Route
				path={routePaths.repos}
				element={
					<LazyRoute
						Component={ReposPage}
						fallback={<SessionReaderFallback />}
					/>
				}
			/>
			<Route
				path={routePaths.skills}
				element={
					import.meta.env.PROD && shellRouteMap.skills.comingSoon ? (
						<ShellRedirect to={routePaths.session} />
					) : (
						<LazyRoute Component={SkillsPage} />
					)
				}
			/>
			<Route
				path={routePaths.compass}
				element={<LazyRoute Component={CompassPage} />}
			/>
			<Route
				path={routePaths.mcp}
				element={<LazyRoute Component={McpPage} />}
			/>
			<Route
				path={routePaths.team}
				element={<ShellRedirect to={routePaths.settingsMembers} />}
			/>
			<Route path={routePaths.settings} element={<SettingsLayout />}>
				<Route
					path={settingsRouteMap.github.segment}
					element={<GitHubSettingsPage />}
				/>
				<Route
					index
					element={
						import.meta.env.PROD && shellRouteMap.settings.comingSoon ? (
							<ShellRedirect to={routePaths.session} />
						) : (
							<SettingsIndexRedirect />
						)
					}
				/>
				<Route
					path={settingsRouteMap.workspace.segment}
					element={
						<LazyRoute
							Component={WorkspaceSettingsPage}
							fallback={<SettingsPageSkeleton routeId="workspace" />}
						/>
					}
				/>
				<Route
					path={settingsRouteMap.sessions.segment}
					element={
						<LazyRoute
							Component={SessionsSettingsPage}
							fallback={<SettingsPageSkeleton routeId="sessions" />}
						/>
					}
				/>
				<Route
					path={settingsRouteMap.reports.segment}
					element={
						<LazyRoute
							Component={ReportsSettingsPage}
							fallback={<SettingsPageSkeleton routeId="reports" />}
						/>
					}
				/>
				<Route
					path={settingsRouteMap.members.segment}
					element={
						<LazyRoute
							Component={MembersSettingsPage}
							fallback={<SettingsPageSkeleton routeId="members" />}
						/>
					}
				/>
				<Route
					path={settingsRouteMap.team.segment}
					element={<ShellRedirect to={routePaths.settingsMembers} />}
				/>
				<Route
					path={settingsRouteMap.invitations.segment}
					element={
						<ShellRedirect
							to={`${routePaths.settingsAccount}#workspace-invitations`}
						/>
					}
				/>
				<Route
					path={settingsRouteMap.account.segment}
					element={
						<LazyRoute
							Component={AccountSettingsPage}
							fallback={<SettingsPageSkeleton routeId="account" />}
						/>
					}
				/>
				{selfHosted ? (
					<Route
						path={settingsRouteMap.mcp.segment}
						element={<LazyRoute Component={McpSettingsPage} />}
					/>
				) : null}
				<Route
					path={settingsRouteMap["create-workspace"].segment}
					element={
						<LazyRoute
							Component={CreateWorkspacePage}
							fallback={<SettingsPageSkeleton routeId="workspace" />}
						/>
					}
				/>
			</Route>
		</>
	);
}

export function AppRouter({
	rootRedirectTarget,
	sessionComponent,
	dashboardComponent,
}: {
	rootRedirectTarget: string | null;
	sessionComponent?: ComponentType;
	dashboardComponent?: ComponentType;
}) {
	const rootRedirect = rootRedirectTarget || shellRouteMap.dashboard.path;
	const selfHosted = useSelfHost() !== null;
	return (
		<Routes>
			<Route path="/" element={<Navigate to={rootRedirect} replace />} />
			<Route
				path="/invitation/:invitationId"
				element={<AcceptInvitationPage />}
			/>
			<Route
				path="/team/invite/:token"
				element={<LazyRoute Component={TeamInviteAcceptPage} />}
			/>
			<Route
				path={appRoutes.admin()}
				element={<LazyRoute Component={AdminDashboardPage} />}
			/>
			<Route
				path={appRoutes.adminRunQuestions()}
				element={<LazyRoute Component={RunQuestionsAdminPage} />}
			/>
			<Route
				path={appRoutes.adminFeatures()}
				element={<LazyRoute Component={WorkspaceFeaturesAdminPage} />}
			/>
			<Route
				path="/announcement"
				element={<LazyRoute Component={AnnouncementPage} />}
			/>
			<Route
				path="/:workspaceSlug/join/:token"
				element={<LazyRoute Component={TeamInviteAcceptPage} />}
			/>
			<Route element={<LeftSidebarAppShellLayout />}>
				{getShellRouteElements(
					canonicalShellRoutePaths,
					sessionComponent,
					dashboardComponent,
					selfHosted,
				)}

				<Route
					path={CLI_SETUP_PATH}
					element={<LazyRoute Component={CliOnboardingPage} />}
				/>
				<Route
					path={`${appRoutes.newSession()}/:sessionId?`}
					element={<LazyRoute Component={NewSessionPage} />}
				/>
				<Route
					path={LEGACY_DASHBOARD_SESSIONS_PATH}
					element={<Navigate to={appRoutes.session()} replace />}
				/>
				<Route
					path={`${LEGACY_DASHBOARD_SESSIONS_PATH}/:sessionId`}
					element={<LegacySessionDetailRedirect />}
				/>
				<Route
					path={LEGACY_SESSION_SPLIT_PATH}
					element={<Navigate to={appRoutes.session()} replace />}
				/>
				<Route
					path={LEGACY_SESSION_FULL_PATH}
					element={<Navigate to={appRoutes.session()} replace />}
				/>
				<Route
					path={`${LEGACY_SESSION_FULL_PATH}/:sessionId`}
					element={<LegacySessionDetailRedirect />}
				/>
				<Route
					path={LEGACY_DASHBOARDY_PATH}
					element={<Navigate to={shellRouteMap.dashboard.path} replace />}
				/>
			</Route>
			<Route
				element={
					<WorkspaceRoute>
						<Outlet />
					</WorkspaceRoute>
				}
			>
				<Route element={<LeftSidebarAppShellLayout />}>
					{getShellRouteElements(
						workspaceShellRoutePaths,
						sessionComponent,
						dashboardComponent,
						selfHosted,
					)}
					<Route
						path="/:workspaceSlug"
						element={<ShellRedirect to="/:workspaceSlug/dashboard" />}
					/>
					<Route
						path="/:workspaceSlug/newsesh/:sessionId?"
						element={<LazyRoute Component={NewSessionPage} />}
					/>
					<Route
						path="/:workspaceSlug/reports/:analysisId"
						element={<LazyRoute Component={ReportPage} />}
					/>
				</Route>
			</Route>
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}
