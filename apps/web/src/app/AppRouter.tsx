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
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { CliOnboardingPage } from "@/features/cli-onboarding/cli-onboarding-page";
import { AcceptInvitationPage } from "@/features/invitations/AcceptInvitationPage";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { settingsRouteMap } from "@/features/settings/config/settings-routes";
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

const DashboardPage = lazyNamed(
	() => import("@/features/dashboard/DashboardPage"),
	"DashboardPage",
);
const SessionsPage = lazyNamed(
	() => import("@/features/sessions/sessions-page"),
	"SessionsPage",
);
const NewSessionPage = lazyNamed(
	() => import("@/features/sessions/new-session-page"),
	"NewSessionPage",
);
const SkillsPage = lazyNamed(
	() => import("@/features/skills/SkillsPage"),
	"SkillsPage",
);
const WorkspaceSettingsPage = lazyNamed(
	() => import("@/features/settings/workspace/WorkspaceSettingsPage"),
	"WorkspaceSettingsPage",
);
const CreateWorkspacePage = lazyNamed(
	() => import("@/features/settings/workspace/components/CreateWorkspaceCard"),
	"CreateWorkspaceCard",
);
const MembersSettingsPage = lazyNamed(
	() => import("@/features/settings/members/MembersSettingsPage"),
	"MembersSettingsPage",
);
const AccountSettingsPage = lazyNamed(
	() => import("@/features/settings/account/AccountSettingsPage"),
	"AccountSettingsPage",
);
const TeamPage = lazyNamed(
	() => import("@/features/team/TeamPage"),
	"TeamPage",
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
	dashboard: string;
	session: string;
	skills: string;
	team: string;
	settings: string;
	settingsAccount: string;
	settingsWorkspace: string;
};

const canonicalShellRoutePaths: ShellRoutePaths = {
	dashboard: appRoutes.dashboard(),
	session: appRoutes.session(),
	skills: appRoutes.skills(),
	team: appRoutes.team(),
	settings: appRoutes.settings(),
	settingsAccount: appRoutes.settingsAccount(),
	settingsWorkspace: appRoutes.settingsWorkspace(),
};

const workspaceShellRoutePaths: ShellRoutePaths = {
	dashboard: "/:workspaceSlug/dashboard",
	session: "/:workspaceSlug/sessions",
	skills: "/:workspaceSlug/skills",
	team: "/:workspaceSlug/team",
	settings: "/:workspaceSlug/settings",
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
) {
	return (
		<>
			<Route
				path={routePaths.dashboard}
				element={
					import.meta.env.PROD && shellRouteMap.dashboard.comingSoon ? (
						<ShellRedirect to={routePaths.session} />
					) : (
						<LazyRoute Component={DashboardPage} />
					)
				}
			/>
			<Route
				path={`${routePaths.session}/:sessionId?`}
				element={<LazyRoute Component={SessionComponent} />}
			/>
			<Route
				path={`${routePaths.session}/:sessionId/v2`}
				element={<LazyRoute Component={SessionComponent} />}
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
				path={routePaths.team}
				element={
					import.meta.env.PROD && shellRouteMap.team.comingSoon ? (
						<ShellRedirect to={routePaths.session} />
					) : (
						<LazyRoute Component={TeamPage} />
					)
				}
			/>
			<Route path={routePaths.settings} element={<SettingsLayout />}>
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
					path={settingsRouteMap.members.segment}
					element={
						<LazyRoute
							Component={MembersSettingsPage}
							fallback={<SettingsPageSkeleton routeId="members" />}
						/>
					}
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
}: {
	rootRedirectTarget: string | null;
	sessionComponent?: ComponentType;
}) {
	const rootRedirect =
		rootRedirectTarget ||
		(import.meta.env.PROD
			? shellRouteMap.sessions.path
			: shellRouteMap.dashboard.path);
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
				path="/:workspaceSlug/join/:token"
				element={<LazyRoute Component={TeamInviteAcceptPage} />}
			/>
			<Route element={<LeftSidebarAppShellLayout />}>
				{getShellRouteElements(canonicalShellRoutePaths, sessionComponent)}

				<Route path={CLI_SETUP_PATH} element={<CliOnboardingPage />} />
				<Route
					path={appRoutes.legacyDashboard()}
					element={<Navigate to={appRoutes.home()} replace />}
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
					{getShellRouteElements(workspaceShellRoutePaths, sessionComponent)}
					<Route
						path="/:workspaceSlug"
						element={<ShellRedirect to="/:workspaceSlug/sessions" />}
					/>
					<Route
						path="/:workspaceSlug/newsesh/:sessionId?"
						element={<LazyRoute Component={NewSessionPage} />}
					/>
				</Route>
			</Route>
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}
