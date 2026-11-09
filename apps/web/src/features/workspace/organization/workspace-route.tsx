import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { NotFoundPage } from "@/app/system/NotFoundPage";
import { ProductLoadingScreen } from "@/features/shell/product-loading-screen";
import { authClient } from "@/lib/auth-client";
import { useOrganization } from "./useOrganization";

export function WorkspaceRoute({ children }: { children: ReactNode }) {
	const { workspaceSlug } = useParams();
	if (!workspaceSlug || !validateOrgSlug(workspaceSlug))
		return <NotFoundPage />;
	return (
		<WorkspaceRouteContent key={workspaceSlug} slug={workspaceSlug}>
			{children}
		</WorkspaceRouteContent>
	);
}

function WorkspaceRouteContent({
	slug,
	children,
}: {
	slug: string;
	children: ReactNode;
}) {
	const { state } = useOrganization();
	const { isRefetching: isRefreshingOrganizations } =
		authClient.useListOrganizations();
	if (state.activeOrg?.slug === slug) return children;
	if (state.isLoading || isRefreshingOrganizations)
		return <ProductLoadingScreen />;
	return <NotFoundPage />;
}
