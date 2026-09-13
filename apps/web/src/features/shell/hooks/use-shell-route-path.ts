import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { getWorkspaceAppPath, getWorkspaceSlugFromPath } from "@/app/routes";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";

export function useShellRoutePath() {
	const demo = useDemoRuntime();
	const activeWorkspaceSlug = useOptionalOrganization()?.state.activeOrg?.slug;
	const location = useLocation();
	const workspaceSlug =
		getWorkspaceSlugFromPath(location.pathname) ?? activeWorkspaceSlug;
	return useCallback(
		(canonicalPath: string) => {
			if (!demo && workspaceSlug)
				return getWorkspaceAppPath(workspaceSlug, canonicalPath);
			return canonicalPath;
		},
		[demo, workspaceSlug],
	);
}
