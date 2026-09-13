import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { NotFoundPage } from "@/app/system/NotFoundPage";
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
	slug: string | undefined;
	children: ReactNode;
}) {
	const { state } = useOrganization();
	const { isRefetching: isRefreshingOrganizations } =
		authClient.useListOrganizations();
	const organization = state.organizations.find((item) => item.slug === slug);
	const [attempted, setAttempted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const needsSwitch = organization && state.activeOrg?.id !== organization.id;
	useEffect(() => {
		if (!state.isLoading && organization && !needsSwitch && attempted) {
			setAttempted(false);
			return;
		}
		if (state.isLoading || !needsSwitch || !organization || attempted) return;
		setAttempted(true);
		void authClient.organization
			.setActive({ organizationId: organization.id })
			.then((result) => {
				if (result.error)
					setError("Could not open this workspace. Please try again.");
			})
			.catch(() =>
				setError("Could not open this workspace. Please try again."),
			);
	}, [state.isLoading, needsSwitch, organization, attempted]);
	if (error)
		return (
			<div className="p-6">
				<p role="alert">{error}</p>
				<button
					type="button"
					onClick={() => {
						setError(null);
						setAttempted(false);
					}}
				>
					Retry
				</button>
			</div>
		);
	if (state.isLoading || (!organization && isRefreshingOrganizations))
		return <output className="p-6">Opening your workspace…</output>;
	if (!organization) return <NotFoundPage />;
	if (needsSwitch)
		return <output className="p-6">Opening your workspace…</output>;
	return children;
}
