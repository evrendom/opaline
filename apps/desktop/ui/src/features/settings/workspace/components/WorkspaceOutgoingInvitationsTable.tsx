import { Avatar, AvatarFallback } from "@/app/ui/avatar";
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
					{/* Sent invitation: who, their role, and revoke. */}
					<WorkspaceSettingsRow
						label={
							<div className="workspace-settings-member-identity">
								<Avatar size="sm">
									<AvatarFallback>
										{invitation.email.slice(0, 2).toUpperCase()}
									</AvatarFallback>
								</Avatar>
								<div className="workspace-settings-member-copy">
									<span className="break-all">{invitation.email}</span>
									<span>Sent {formatDate(invitation.createdAt)}</span>
								</div>
							</div>
						}
					>
						<span className="workspace-settings-badge capitalize">
							{invitation.role || "member"}
						</span>
						{canCancel ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={`Revoke invitation to ${invitation.email}`}
								onClick={() => onCancel(invitation.id)}
								disabled={pendingInvitationId !== null}
							>
								{pendingInvitationId === invitation.id ? "Revoking…" : "Revoke"}
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
