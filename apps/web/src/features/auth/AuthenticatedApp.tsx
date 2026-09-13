import { Navigate, useLocation } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import {
	appRoutes,
	getWorkspaceAppPath,
	getWorkspaceRelativePath,
} from "@/app/routes";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

export function AuthenticatedApp({
	rootRedirectTarget,
}: {
	rootRedirectTarget: string | null;
}) {
	const { state } = useOrganization();
	const { pathname, search, hash } = useLocation();
	const destination =
		pathname === "/" && rootRedirectTarget
			? rootRedirectTarget
			: `${pathname}${search}${hash}`;
	if (getWorkspaceRelativePath(destination) !== null) {
		if (state.isLoading)
			return <output className="p-6">Opening your workspace…</output>;
		const workspace = state.activeOrg ?? state.organizations[0];
		if (workspace)
			return (
				<Navigate
					to={getWorkspaceAppPath(workspace.slug, destination)}
					replace
				/>
			);
		// Account and workspace creation remain reachable after deleting the last
		// workspace. Once one exists, these entry points redirect to its URL too.
		if (
			!pathname.startsWith(`${appRoutes.settings()}/`) &&
			pathname !== appRoutes.settings()
		)
			return <Navigate to={appRoutes.settingsWorkspace()} replace />;
	}
	return <AppRouter rootRedirectTarget={rootRedirectTarget} />;
}
