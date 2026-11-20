import { Link } from "react-router-dom";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { buttonVariants } from "@/app/ui/button";

import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";

export function NotFoundPage() {
	const workspace = useOptionalOrganization()?.state.activeOrg;
	return (
		<div className="flex min-h-screen items-center justify-center px-xxl py-[calc(var(--space-xxl)*2)]">
			<div className="flex max-w-md flex-col items-center gap-xl text-center">
				{/* design-escape-ok: an uppercase eyebrow opens its tracking; no step holds it */}
				<div className="text-body-xl font-medium uppercase tracking-[0.18em] text-ink-3">
					404
				</div>
				<h1 className="text-display-s font-heavy text-ink">Page not found</h1>
				<p className="text-body-xl text-ink-3">
					The page you’re looking for does not exist or is no longer available.
				</p>
				<Link
					to={
						workspace
							? getWorkspaceAppPath(workspace.slug, appRoutes.dashboard())
							: appRoutes.dashboard()
					}
					className={buttonVariants()}
				>
					Go to dashboard
				</Link>
			</div>
		</div>
	);
}
