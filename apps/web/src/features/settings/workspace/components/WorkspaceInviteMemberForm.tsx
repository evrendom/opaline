import { IconMail } from "@tabler/icons-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/app/ui/button";
import { Input } from "@/app/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/ui/select";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { WorkspaceRoleLabel } from "@/features/settings/workspace/components/workspace-role-label";
import {
	WorkspaceSettingsField,
	WorkspaceSettingsFields,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { authClient } from "@/lib/auth-client";

// Invite row: email, role and Invite at the top of the
// Members card.
export function WorkspaceInviteMemberForm({
	canManage,
	onInvalidate,
}: {
	canManage: boolean;
	onInvalidate: () => void;
}) {
	const { trackOrganizationAction } = useAnalyticsTracking({
		pageName: "organization",
	});
	const emailId = useId();
	const roleId = useId();
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
	const [isInviting, setIsInviting] = useState(false);
	const [inviteLink, setInviteLink] = useState<string | null>(null);
	const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
	const [copiedInviteLink, setCopiedInviteLink] = useState(false);

	const inviteMember = async (event: FormEvent) => {
		event.preventDefault();
		const email = inviteEmail.trim();
		if (!email) {
			return;
		}

		trackOrganizationAction({
			actionName: "invite_member",
			targetType: "invitation",
			sourceComponent: "workspace_settings_section",
			targetRole: inviteRole,
		});
		setIsInviting(true);
		const response = await authClient.organization.inviteMember({
			email,
			role: inviteRole,
		});
		setIsInviting(false);

		if (response.error) {
			toast.error(response.error.message ?? "Failed to invite member");
			return;
		}

		if (response.data) {
			setInviteLink(`${window.location.origin}/invitation/${response.data.id}`);
			setInvitedEmail(email);
			setInviteEmail("");
			setCopiedInviteLink(false);
			onInvalidate();
		}
	};

	const copyInviteLink = async () => {
		if (!inviteLink) {
			return;
		}

		trackOrganizationAction({
			actionName: "copy_invite_link",
			targetType: "invitation",
			sourceComponent: "workspace_settings_section",
		});

		try {
			await navigator.clipboard.writeText(inviteLink);
			setCopiedInviteLink(true);
			toast.success("Invite link copied");
		} catch {
			toast.error("Failed to copy invite link");
		}
	};

	return (
		<form onSubmit={inviteMember}>
			{!canManage ? (
				<p className="workspace-settings-empty">
					Only admins and owners can invite new members.
				</p>
			) : null}
			<WorkspaceSettingsFields>
				<WorkspaceSettingsField label="Email" controlId={emailId}>
					<Input
						id={emailId}
						type="email"
						value={inviteEmail}
						onChange={(event) => {
							setInviteEmail(event.target.value);
							if (inviteLink) {
								setInviteLink(null);
								setInvitedEmail(null);
							}
						}}
						placeholder="teammate@company.com"
						disabled={!canManage || isInviting}
						required
					/>
				</WorkspaceSettingsField>
				<WorkspaceSettingsField label="Role" controlId={roleId} size="compact">
					<Select
						value={inviteRole}
						onValueChange={(value) => {
							if (value === "member" || value === "admin") setInviteRole(value);
						}}
						disabled={!canManage || isInviting}
					>
						<SelectTrigger id={roleId}>
							<SelectValue>
								<WorkspaceRoleLabel value={inviteRole} />
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="member">
								<WorkspaceRoleLabel value="member" />
							</SelectItem>
							<SelectItem value="admin">
								<WorkspaceRoleLabel value="admin" />
							</SelectItem>
						</SelectContent>
					</Select>
				</WorkspaceSettingsField>
				<Button
					type="submit"
					size="sm"
					disabled={!canManage || isInviting || inviteEmail.trim().length === 0}
				>
					<IconMail aria-hidden="true" />
					{isInviting ? "Inviting…" : "Invite"}
				</Button>
			</WorkspaceSettingsFields>
			{inviteLink ? (
				<div className="workspace-settings-link-surface">
					<p className="workspace-settings-status">
						{invitedEmail
							? `Share this link with ${invitedEmail}.`
							: "Share this link with the invited member."}
					</p>
					<div className="workspace-settings-link-value">
						<Input
							aria-label="Email invitation link"
							value={inviteLink}
							readOnly
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void copyInviteLink()}
						>
							{copiedInviteLink ? "Copied" : "Copy link"}
						</Button>
					</div>
					<div className="workspace-settings-link-actions">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setInviteLink(null);
								setInvitedEmail(null);
								setCopiedInviteLink(false);
							}}
						>
							Dismiss
						</Button>
					</div>
				</div>
			) : null}
		</form>
	);
}
