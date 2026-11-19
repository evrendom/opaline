import { Reveal } from "@/app/ui/bones";
import { Button } from "@/app/ui/button";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";

function formatDate(value: string | Date) {
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime())
		? "Unknown date"
		: date.toLocaleDateString();
}

export function WorkspaceIncomingInvitationsCard({
	description = "Accept or decline invites from other workspaces without leaving settings.",
	invitations,
	isPending,
	onAccept,
	onDecline,
	processingId,
	title = "Pending invitations",
}: {
	description?: string;
	invitations: readonly {
		createdAt: string | Date;
		id: string;
		organizationName: string;
		role: string;
	}[];
	isPending: boolean;
	onAccept: (invitationId: string) => void;
	onDecline: (invitationId: string) => void;
	processingId: string | null;
	title?: string;
}) {
	return (
		<WorkspaceSettingsGroup title={title} description={description}>
			{!isPending && invitations.length === 0 ? (
				<p className="workspace-settings-empty">
					No pending invitations right now.
				</p>
			) : (
				<Reveal
					label="Loading invitations"
					loading={isPending}
					sample={
						<p className="workspace-settings-empty">
							No pending invitations right now.
						</p>
					}
					sampleId="incoming-invitations"
				>
					{() => (
						<ul className="workspace-settings-list" aria-label={title}>
							{invitations.map((invitation) => (
								<li key={invitation.id}>
									<WorkspaceSettingsRow
										label={invitation.organizationName}
										description={`${invitation.role} · Invited ${formatDate(invitation.createdAt)}`}
									>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => onDecline(invitation.id)}
											disabled={processingId !== null}
										>
											{processingId === invitation.id ? "Working…" : "Decline"}
										</Button>
										<Button
											type="button"
											size="sm"
											onClick={() => onAccept(invitation.id)}
											disabled={processingId !== null}
										>
											{processingId === invitation.id ? "Working…" : "Accept"}
										</Button>
									</WorkspaceSettingsRow>
								</li>
							))}
						</ul>
					)}
				</Reveal>
			)}
		</WorkspaceSettingsGroup>
	);
}
