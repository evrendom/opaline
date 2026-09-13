import { Button } from "@/app/ui/button";
import { WorkspaceSettingsRow } from "@/features/settings/workspace/components/workspace-settings-group";

function formatDate(value?: string) {
	if (!value) return "Unknown date";
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? "Unknown date"
		: date.toLocaleDateString();
}

export function WorkspaceOutgoingInvitationsTable({
	invitations,
	canCancel,
	pendingInvitationId,
	onCancel,
}: {
	invitations: readonly {
		id: string;
		email: string;
		role: string | null;
		status: string;
		createdAt?: string;
	}[];
	canCancel: boolean;
	pendingInvitationId: string | null;
	onCancel: (invitationId: string) => void;
}) {
	if (invitations.length === 0) {
		return (
			<p className="workspace-settings-empty">
				No outgoing invitations are pending.
			</p>
		);
	}

	return (
		<ul className="workspace-settings-list" aria-label="Outgoing invitations">
			{invitations.map((invitation) => (
				<li key={invitation.id}>
					<WorkspaceSettingsRow
						label={<span className="break-all">{invitation.email}</span>}
						description={`${invitation.role || "Member"} · Sent ${formatDate(invitation.createdAt)}`}
					>
						{canCancel ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={`Cancel invitation to ${invitation.email}`}
								onClick={() => onCancel(invitation.id)}
								disabled={pendingInvitationId !== null}
							>
								{pendingInvitationId === invitation.id
									? "Canceling…"
									: "Cancel"}
							</Button>
						) : (
							<span className="workspace-settings-status">Pending</span>
						)}
					</WorkspaceSettingsRow>
				</li>
			))}
		</ul>
	);
}
