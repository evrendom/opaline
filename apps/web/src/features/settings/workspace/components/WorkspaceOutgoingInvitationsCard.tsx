import { useState } from "react";
import { toast } from "sonner";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { WorkspaceOutgoingInvitationsTable } from "@/features/settings/workspace/components/WorkspaceOutgoingInvitationsTable";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { authClient } from "@/lib/auth-client";

export function WorkspaceOutgoingInvitationsCard({
	invitations,
	canCancel,
	onInvalidate,
}: {
	invitations: readonly {
		id: string;
		email: string;
		role: string | null;
		status: string;
		createdAt?: string;
	}[];
	canCancel: boolean;
	onInvalidate: () => void;
}) {
	const { trackOrganizationAction } = useAnalyticsTracking({
		pageName: "organization",
	});
	const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(
		null,
	);

	const cancelInvitation = async (invitationId: string) => {
		setPendingInvitationId(invitationId);
		trackOrganizationAction({
			actionName: "cancel_invitation",
			targetType: "invitation",
			sourceComponent: "workspace_settings_section",
			targetId: invitationId,
		});

		try {
			await authClient.organization.cancelInvitation({ invitationId });
			onInvalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to cancel invitation",
			);
		} finally {
			setPendingInvitationId(null);
		}
	};

	return (
		<WorkspaceSettingsGroup
			title="Outgoing invitations"
			description="Pending invitations that haven't been accepted yet."
		>
			<WorkspaceOutgoingInvitationsTable
				invitations={invitations}
				canCancel={canCancel}
				pendingInvitationId={pendingInvitationId}
				onCancel={(invitationId) => void cancelInvitation(invitationId)}
			/>
		</WorkspaceSettingsGroup>
	);
}
