import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { getSettingsPathFromLegacyTab } from "@/features/settings/config/settings-routes";
import { useWorkspaceSlug } from "@/features/workspace/routing/workspace-routes";

export function SettingsIndexRedirect() {
	const orgSlug = useWorkspaceSlug();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const nextSearchParams = new URLSearchParams(searchParams);
	const nextTarget = getSettingsPathFromLegacyTab(
		searchParams.get("tab"),
		orgSlug,
	);
	const [nextPath, defaultHash] = nextTarget.split("#", 2);

	nextSearchParams.delete("tab");

	const queryString = nextSearchParams.toString();

	return (
		<Navigate
			replace
			to={{
				pathname: nextPath,
				search: queryString ? `?${queryString}` : "",
				hash: location.hash || (defaultHash ? `#${defaultHash}` : ""),
			}}
		/>
	);
}
