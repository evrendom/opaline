import { useState } from "react";
import { toast } from "sonner";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { WorkspaceOutgoingInvitationsTable } from "@/features/settings/workspace/components/WorkspaceOutgoingInvitationsTable";
import { authClient } from "@/lib/auth-client";

// "Invitations sent": listed under the members, only
// while some are pending.
export function WorkspaceSentInvitations({
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

	if (invitations.length === 0) {
		return null;
	}

	return (
		<div className="workspace-settings-subsection">
			<h3>Invitations sent</h3>
			<WorkspaceOutgoingInvitationsTable
				invitations={invitations}
				canCancel={canCancel}
				pendingInvitationId={pendingInvitationId}
				onCancel={(invitationId) => void cancelInvitation(invitationId)}
			/>
		</div>
	);
}
