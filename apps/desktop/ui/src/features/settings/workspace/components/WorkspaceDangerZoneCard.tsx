import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { Button } from "@/app/ui/button";
import { DeleteWorkspaceDialog } from "@/features/settings/workspace/components/DeleteWorkspaceDialog";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";
import { queryClient } from "@/lib/query-client";

export function WorkspaceDangerZoneCard({
	canManage,
	organization,
}: {
	canManage: boolean;
	organization: { id: string; name: string };
}) {
	const navigate = useNavigate();
	const { state } = useOrganization();
	const { refetch: refetchOrganizations } = authClient.useListOrganizations();
	const [open, setOpen] = useState(false);

	const handleDeleted = async () => {
		const nextOrg = state.organizations.find((o) => o.id !== organization.id);
		// Refresh membership before visiting the unscoped entry point. Otherwise
		// its redirect can briefly resolve to the workspace we just deleted.
		await refetchOrganizations();
		if (nextOrg) {
			await authClient.organization.setActive({ organizationId: nextOrg.id });
		} else {
			await authClient.organization.setActive({ organizationId: null });
		}
		await queryClient.cancelQueries();
		queryClient.clear();
		refreshAuthClientState();
		navigate(
			nextOrg
				? getWorkspaceAppPath(nextOrg.slug, appRoutes.settingsWorkspace())
				: appRoutes.settingsWorkspace(),
			{ replace: true },
		);
		setOpen(false);
		toast.success(`Workspace "${organization.name}" deleted`);
	};

	return (
		<>
			<WorkspaceSettingsGroup title="Danger zone" tone="danger">
				<WorkspaceSettingsRow
					label="Delete workspace"
					description="Permanently delete this workspace and its session data for every member. This cannot be undone."
				>
					<Button
						type="button"
						variant="danger"
						size="md"
						onClick={() => setOpen(true)}
						disabled={!canManage}
					>
						<IconTrash aria-hidden="true" />
						Delete workspace
					</Button>
				</WorkspaceSettingsRow>
			</WorkspaceSettingsGroup>
			<DeleteWorkspaceDialog
				open={open}
				onOpenChange={setOpen}
				organization={organization}
				onDeleted={handleDeleted}
			/>
		</>
	);
}
