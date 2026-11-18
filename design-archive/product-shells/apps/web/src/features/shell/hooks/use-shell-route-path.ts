import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
	getBottomRailPreviewPath,
	getCenteredSidebarPreviewPath,
	getFloatingRowPreviewPath,
	getLeftSidebarPreviewPath,
	getLeftSidebarThreadPreviewPath,
	getOlivettiRailPreviewPath,
	getWorkspaceAppPath,
	getWorkspaceSlugFromPath,
	isBottomRailPreviewPath,
	isCenteredSidebarPreviewPath,
	isFloatingRowPreviewPath,
	isLeftSidebarPreviewPath,
	isLeftSidebarThreadPreviewPath,
	isOlivettiRailPreviewPath,
} from "@/app/routes";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";

export function useShellRoutePath() {
	const demo = useDemoRuntime();
	const activeWorkspaceSlug = useOptionalOrganization()?.state.activeOrg?.slug;
	const location = useLocation();
	const workspaceSlug =
		getWorkspaceSlugFromPath(location.pathname) ?? activeWorkspaceSlug;
	const isBottomRailPreview = isBottomRailPreviewPath(location.pathname);
	const isCenteredSidebarPreview = isCenteredSidebarPreviewPath(
		location.pathname,
	);
	const isOlivettiRailPreview = isOlivettiRailPreviewPath(location.pathname);
	const isFloatingRowPreview = isFloatingRowPreviewPath(location.pathname);
	const isLeftSidebarPreview = isLeftSidebarPreviewPath(location.pathname);
	const isLeftSidebarThreadPreview = isLeftSidebarThreadPreviewPath(
		location.pathname,
	);

	return useCallback(
		(canonicalPath: string) => {
			if (isCenteredSidebarPreview) {
				return getCenteredSidebarPreviewPath(canonicalPath);
			}

			if (isOlivettiRailPreview) {
				return getOlivettiRailPreviewPath(canonicalPath);
			}

			if (isFloatingRowPreview) {
				return getFloatingRowPreviewPath(canonicalPath);
			}

			if (isBottomRailPreview) {
				return getBottomRailPreviewPath(canonicalPath);
			}

			if (isLeftSidebarPreview) {
				return getLeftSidebarPreviewPath(canonicalPath);
			}

			if (isLeftSidebarThreadPreview) {
				return getLeftSidebarThreadPreviewPath(canonicalPath);
			}

			if (!demo && workspaceSlug)
				return getWorkspaceAppPath(workspaceSlug, canonicalPath);
			return canonicalPath;
		},
		[
			demo,
			workspaceSlug,
			isBottomRailPreview,
			isCenteredSidebarPreview,
			isFloatingRowPreview,
			isLeftSidebarPreview,
			isLeftSidebarThreadPreview,
			isOlivettiRailPreview,
		],
	);
}
