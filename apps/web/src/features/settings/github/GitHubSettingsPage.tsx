import { Navigate } from "react-router-dom";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { showsGitHubSettings } from "@/features/self-hosted/surfaces";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { settingsRouteMap } from "@/features/settings/config/settings-routes";
import { useGitHubConnection } from "@/features/settings/github/use-github-connection";
import { WorkspaceGitHubConnection } from "@/features/settings/workspace/components/WorkspaceGitHubConnection";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

export function GitHubSettingsPage() {
	const { state } = useOrganization();
	const organizationId = state.activeOrg?.id ?? null;
	const { query } = useGitHubConnection(organizationId);
	const getShellRoutePath = useShellRoutePath();
	const selfHost = useSelfHost();

	if (state.isLoading || (organizationId && query.isPending)) {
		return <SettingsPageSkeleton routeId="workspace" />;
	}
	// The page exists only while GitHub is enabled for this workspace.
	if (!organizationId || !showsGitHubSettings(selfHost, query.data)) {
		return (
			<Navigate
				replace
				to={getShellRoutePath(settingsRouteMap.workspace.path)}
			/>
		);
	}
	return (
		<div className="workspace-settings-page">
			<WorkspaceGitHubConnection organizationId={organizationId} />
		</div>
	);
}
