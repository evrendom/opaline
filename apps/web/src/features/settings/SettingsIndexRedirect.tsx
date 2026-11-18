import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { getSettingsPathFromLegacyTab } from "@/features/settings/config/settings-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";

export function SettingsIndexRedirect() {
	const { hash } = useLocation();
	const [searchParams] = useSearchParams();
	const getShellRoutePath = useShellRoutePath();
	const nextSearchParams = new URLSearchParams(searchParams);
	const nextPath = getShellRoutePath(
		getSettingsPathFromLegacyTab(searchParams.get("tab")),
	);

	nextSearchParams.delete("tab");

	const queryString = nextSearchParams.toString();
	const [pathname, targetHash] = nextPath.split("#", 2);

	return (
		<Navigate
			replace
			to={`${pathname}${queryString ? `?${queryString}` : ""}${targetHash ? `#${targetHash}` : hash}`}
		/>
	);
}
