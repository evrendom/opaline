import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppLoadingScreen } from "@/app/bootstrap/AppLoadingScreen";
import { appRoutes, getWorkspaceSlugFromPath } from "@/app/routes";
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { resolvePostAuthDestinationForOrganization } from "@/features/auth/auth-route-utils";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

export type LegacyWorkspaceRoute =
	| "dashboard"
	| "sessions"
	| "session-detail"
	| "team"
	| "settings"
	| "settings-account"
	| "settings-create-workspace"
	| "settings-invitations"
	| "settings-members"
	| "settings-workspace";

export function RootWorkspaceRedirect({ target }: { target: string | null }) {
	const { state } = useOrganization();

	if (target) {
		const resolvedTarget =
			state.activeOrg && validateOrgSlug(state.activeOrg.slug)
				? resolvePostAuthDestinationForOrganization(
						state.activeOrg.slug,
						target,
					)
				: target;
		return <Navigate replace to={resolvedTarget} />;
	}

	if (state.isLoading) {
		return <AppLoadingScreen />;
	}

	if (!state.activeOrg || !validateOrgSlug(state.activeOrg.slug)) {
		return <NotFoundPage />;
	}

	return (
		<Navigate
			replace
			to={resolvePostAuthDestinationForOrganization(state.activeOrg.slug, "/")}
		/>
	);
}

export function WorkspaceRouteBoundary() {
	const location = useLocation();
	const { actions, state } = useOrganization();
	const pendingOrganizationId = useRef<string | null>(null);
	const [failedOrganizationId, setFailedOrganizationId] = useState<
		string | null
	>(null);
	const orgSlug = getWorkspaceSlugFromPath(location.pathname);
	const requestedOrganization = orgSlug
		? state.organizations.find((organization) => organization.slug === orgSlug)
		: undefined;

	useEffect(() => {
		setFailedOrganizationId((currentOrganizationId) =>
			currentOrganizationId === requestedOrganization?.id
				? currentOrganizationId
				: null,
		);
	}, [requestedOrganization?.id]);

	useEffect(() => {
		if (
			state.isLoading ||
			!requestedOrganization ||
			state.activeOrg?.id === requestedOrganization.id ||
			failedOrganizationId === requestedOrganization.id ||
			pendingOrganizationId.current === requestedOrganization.id
		) {
			return;
		}

		pendingOrganizationId.current = requestedOrganization.id;
		void actions
			.switchOrganization(requestedOrganization.id)
			.then((didSwitch) => {
				if (!didSwitch) {
					setFailedOrganizationId(requestedOrganization.id);
				}
			})
			.finally(() => {
				if (pendingOrganizationId.current === requestedOrganization.id) {
					pendingOrganizationId.current = null;
				}
			});
	}, [
		actions,
		failedOrganizationId,
		requestedOrganization,
		state.activeOrg?.id,
		state.isLoading,
	]);

	if (!orgSlug) {
		return <NotFoundPage />;
	}

	if (state.isLoading) {
		return <AppLoadingScreen />;
	}

	if (
		!requestedOrganization ||
		failedOrganizationId === requestedOrganization.id
	) {
		return <NotFoundPage />;
	}

	if (state.activeOrg?.id !== requestedOrganization.id) {
		return <AppLoadingScreen />;
	}

	return <Outlet />;
}

export function LegacyWorkspaceRedirect({
	route,
}: {
	route: LegacyWorkspaceRoute;
}) {
	const location = useLocation();
	const { state } = useOrganization();

	if (state.isLoading) {
		return <AppLoadingScreen />;
	}

	if (!state.activeOrg || !validateOrgSlug(state.activeOrg.slug)) {
		return <NotFoundPage />;
	}

	const legacyPathname =
		route === "dashboard" ? appRoutes.legacyDashboard() : location.pathname;
	const target = resolvePostAuthDestinationForOrganization(
		state.activeOrg.slug,
		`${legacyPathname}${location.search}${location.hash}`,
	);

	return <Navigate replace to={target} />;
}

export function WorkspaceSettingsAliasRedirect({
	defaultHash,
	target,
}: {
	defaultHash: string;
	target: "account" | "workspace";
}) {
	const location = useLocation();
	const orgSlug = useWorkspaceSlug();
	const targetPath =
		target === "account"
			? appRoutes.settingsAccount(orgSlug)
			: appRoutes.settingsWorkspace(orgSlug);

	return (
		<Navigate
			replace
			to={`${targetPath}${location.search}${location.hash || defaultHash}`}
		/>
	);
}

export function useWorkspaceSlug(): string {
	const location = useLocation();
	const orgSlug = getWorkspaceSlugFromPath(location.pathname);
	if (!orgSlug) {
		throw new Error(
			"Workspace route rendered without a valid organization slug",
		);
	}

	return orgSlug;
}
