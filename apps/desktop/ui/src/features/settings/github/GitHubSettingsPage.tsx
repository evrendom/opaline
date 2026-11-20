import { Navigate } from "react-router-dom";
import { showsGitHubSettings } from "@/features/self-hosted/surfaces";
import { SettingsPageReveal } from "@/features/settings/components/settings-page-skeleton";
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

	const loading = state.isLoading || Boolean(organizationId && query.isPending);
	if (!loading && (!organizationId || !showsGitHubSettings(query.data))) {
		return (
			<Navigate
				replace
				to={getShellRoutePath(settingsRouteMap.workspace.path)}
			/>
		);
	}
	return (
		<SettingsPageReveal routeId="workspace" loading={loading}>
			{() =>
				organizationId ? (
					<div className="workspace-settings-page">
						<WorkspaceGitHubConnection organizationId={organizationId} />
					</div>
				) : null
			}
		</SettingsPageReveal>
	);
}
