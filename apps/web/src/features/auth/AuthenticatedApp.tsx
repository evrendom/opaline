import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import {
	appRoutes,
	getWorkspaceAppPath,
	getWorkspaceRelativePath,
} from "@/app/routes";
import { ProductLoadingScreen } from "@/features/shell/product-loading-screen";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { getAuthenticatedRootPath } from "./authenticated-root-path";

export function AuthenticatedApp({
	rootRedirectTarget,
}: {
	rootRedirectTarget: string | null;
}) {
	const { state } = useOrganization();
	const { pathname, search, hash } = useLocation();
	const isRootEntry =
		(pathname === "/" || pathname === "/login") && !rootRedirectTarget;
	const setupStatus = useQuery({
		...orpc.cli.setupStatus.queryOptions({}),
		enabled: isRootEntry,
	});

	if (isRootEntry) {
		if (state.isLoading || setupStatus.isPending)
			return <ProductLoadingScreen />;

		const workspace = state.activeOrg ?? state.organizations[0];
		return (
			<Navigate
				to={getAuthenticatedRootPath({
					hasUploadedSessions: setupStatus.data?.hasUploadedSessions === true,
					workspaceSlug: workspace?.slug ?? null,
				})}
				replace
			/>
		);
	}

	const destination =
		(pathname === "/" || pathname === "/login") && rootRedirectTarget
			? rootRedirectTarget
			: `${pathname}${search}${hash}`;
	// API pages (such as the MCP connection consent) are not SPA routes.
	if (destination.startsWith("/api/")) {
		return <ApiPageRedirect to={destination} />;
	}
	if (getWorkspaceRelativePath(destination) !== null) {
		if (state.isLoading) return <ProductLoadingScreen />;
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

function ApiPageRedirect({ to }: { to: string }) {
	useEffect(() => {
		window.location.replace(to);
	}, [to]);
	return <ProductLoadingScreen />;
}
