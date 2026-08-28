import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { AcceptInvitationPage } from "@/features/invitations/AcceptInvitationPage";
import { settingsRouteSegments } from "@/features/settings/config/settings-routes";
import { SettingsIndexRedirect } from "@/features/settings/SettingsIndexRedirect";
import { AppShellLayout } from "@/features/shell/AppShellLayout";
import {
	LegacyWorkspaceRedirect,
	RootWorkspaceRedirect,
	WorkspaceRouteBoundary,
	WorkspaceSettingsAliasRedirect,
} from "@/features/workspace/routing/workspace-routes";

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
const SessionsListPage = lazyNamed(
	() => import("@/pages/dashboard/SessionsListPage"),
	"SessionsListPage",
);
const SessionDetailPage = lazyNamed(
	() => import("@/pages/dashboard/SessionDetailPage"),
	"SessionDetailPage",
);
const SettingsLayout = lazyNamed(
	() => import("@/features/settings/SettingsLayout"),
	"SettingsLayout",
);
const WorkspaceSettingsPage = lazyNamed(
	() => import("@/features/settings/workspace/WorkspaceSettingsPage"),
	"WorkspaceSettingsPage",
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
const PresetBaselinePage = lazyNamed(
	() => import("@/app/system/PresetBaselinePage"),
	"PresetBaselinePage",
);
const LEGACY_DASHBOARDY_PATH = "/dashboardy";

function DashboardRouteLoadingScreen() {
	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
		>
			<div className="h-6 w-32 animate-pulse rounded-md bg-muted" />
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
				<div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
				<div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
			</div>
			<div className="h-[26rem] animate-pulse rounded-xl border border-border bg-card" />
			<p className="text-sm text-muted-foreground">Loading…</p>
		</div>
	);
}

function LazyRoute({
	Component,
	fallback = <DashboardRouteLoadingScreen />,
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

export function AppRouter({
	rootRedirectTarget,
}: {
	rootRedirectTarget: string | null;
}) {
	return (
		<Routes>
			<Route
				path="/"
				element={<RootWorkspaceRedirect target={rootRedirectTarget} />}
			/>
			<Route
				path="/invitation/:invitationId"
				element={<AcceptInvitationPage />}
			/>
			<Route
				path="/team/invite/:token"
				element={<LazyRoute Component={TeamInviteAcceptPage} />}
			/>
			<Route
				path="/__preset-baseline"
				element={<LazyRoute Component={PresetBaselinePage} />}
			/>
			<Route
				path="/dashboard"
				element={<LegacyWorkspaceRedirect route="dashboard" />}
			/>
			<Route
				path="/dashboard/sessions"
				element={<LegacyWorkspaceRedirect route="sessions" />}
			/>
			<Route
				path="/dashboard/sessions/:sessionId"
				element={<LegacyWorkspaceRedirect route="session-detail" />}
			/>
			<Route
				path={LEGACY_DASHBOARDY_PATH}
				element={<LegacyWorkspaceRedirect route="dashboard" />}
			/>
			<Route path="/team" element={<LegacyWorkspaceRedirect route="team" />} />
			<Route
				path="/settings"
				element={<LegacyWorkspaceRedirect route="settings" />}
			/>
			<Route
				path="/settings/workspace"
				element={<LegacyWorkspaceRedirect route="settings-workspace" />}
			/>
			<Route
				path="/settings/members"
				element={<LegacyWorkspaceRedirect route="settings-members" />}
			/>
			<Route
				path="/settings/invitations"
				element={<LegacyWorkspaceRedirect route="settings-invitations" />}
			/>
			<Route
				path="/settings/account"
				element={<LegacyWorkspaceRedirect route="settings-account" />}
			/>
			<Route
				path="/settings/create-workspace"
				element={<LegacyWorkspaceRedirect route="settings-create-workspace" />}
			/>
			<Route path="/:orgSlug" element={<WorkspaceRouteBoundary />}>
				<Route element={<AppShellLayout />}>
					<Route index element={<LazyRoute Component={DashboardPage} />} />
					<Route
						path="sessions"
						element={<LazyRoute Component={SessionsListPage} />}
					/>
					<Route
						path="sessions/:sessionId"
						element={<LazyRoute Component={SessionDetailPage} />}
					/>
					<Route path="team" element={<LazyRoute Component={TeamPage} />} />
					<Route
						path="settings"
						element={<LazyRoute Component={SettingsLayout} />}
					>
						<Route index element={<SettingsIndexRedirect />} />
						<Route
							path={settingsRouteSegments.workspace}
							element={<LazyRoute Component={WorkspaceSettingsPage} />}
						/>
						<Route
							path={settingsRouteSegments.members}
							element={<LazyRoute Component={MembersSettingsPage} />}
						/>
						<Route
							path={settingsRouteSegments.invitations}
							element={
								<WorkspaceSettingsAliasRedirect
									target="account"
									defaultHash="#workspace-invitations"
								/>
							}
						/>
						<Route
							path={settingsRouteSegments.account}
							element={<LazyRoute Component={AccountSettingsPage} />}
						/>
						<Route
							path={settingsRouteSegments["create-workspace"]}
							element={
								<WorkspaceSettingsAliasRedirect
									target="workspace"
									defaultHash="#new-workspace"
								/>
							}
						/>
					</Route>
				</Route>
			</Route>
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}
