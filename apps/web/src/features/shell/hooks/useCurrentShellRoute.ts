import { useLocation } from "react-router-dom";
import {
	getCurrentShellRoute,
	type ShellRouteDefinition,
} from "@/features/shell/config/shell-routes";
import { useWorkspaceSlug } from "@/features/workspace/routing/workspace-routes";

export function useCurrentShellRoute(): ShellRouteDefinition {
	const orgSlug = useWorkspaceSlug();
	const location = useLocation();

	return getCurrentShellRoute(location.pathname, orgSlug);
}
