import { IconTrash } from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/ui/select";
import {
	WorkspaceOwnerBadge,
	WorkspaceRoleLabel,
} from "@/features/settings/workspace/components/workspace-role-label";
import { WorkspaceSettingsRow } from "@/features/settings/workspace/components/workspace-settings-group";

function getInitials(name: string, email: string) {
	const source = name.trim() || email.trim() || "R";
	return source
		.split(" ")
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

export function WorkspaceMembersTable({
	members,
	canEdit,
	pendingKey,
	onRoleChange,
	onRemove,
}: {
	members: readonly {
		id: string;
		role: string;
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	}[];
	canEdit: boolean;
	pendingKey: string | null;
	onRoleChange: (memberId: string, role: "member" | "admin") => void;
	onRemove: (memberId: string) => void;
}) {
	if (members.length === 0) {
		return (
			<p className="workspace-settings-empty">
				No members are visible for this workspace yet.
			</p>
		);
	}

	return (
		<ul className="workspace-settings-list" aria-label="Workspace members">
			{members.map((member) => (
				<li key={member.id}>
					<WorkspaceSettingsRow
						label={
							// Member row: name with the email beside it.
							<div className="workspace-settings-member-identity">
								<Avatar size="sm">
									{member.user.image ? (
										<AvatarImage
											src={member.user.image}
											alt={member.user.name}
										/>
									) : null}
									<AvatarFallback>
										{getInitials(member.user.name, member.user.email)}
									</AvatarFallback>
								</Avatar>
								<div className="workspace-settings-member-copy">
									<span>{member.user.name || member.user.email}</span>
									<span>{member.user.email}</span>
								</div>
							</div>
						}
					>
						{member.role === "owner" ? (
							<WorkspaceOwnerBadge />
						) : canEdit ? (
							<Select
								value={member.role}
								onValueChange={(value) => {
									if (value === "member" || value === "admin") {
										onRoleChange(member.id, value);
									}
								}}
								disabled={Boolean(pendingKey)}
							>
								<SelectTrigger
									size="sm"
									aria-label={`Role for ${member.user.name || member.user.email}`}
								>
									<SelectValue>
										{pendingKey === `role:${member.id}` ? (
											"Saving…"
										) : (
											<WorkspaceRoleLabel
												value={member.role === "admin" ? "admin" : "member"}
											/>
										)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="admin">
										<WorkspaceRoleLabel value="admin" />
									</SelectItem>
									<SelectItem value="member">
										<WorkspaceRoleLabel value="member" />
									</SelectItem>
								</SelectContent>
							</Select>
						) : (
							<span className="workspace-settings-status">
								<WorkspaceRoleLabel
									value={member.role === "admin" ? "admin" : "member"}
								/>
							</span>
						)}
						{canEdit && member.role !== "owner" ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="workspace-settings-icon-button"
								aria-label={
									pendingKey === `remove:${member.id}`
										? `Removing ${member.user.name || member.user.email}`
										: `Remove ${member.user.name || member.user.email}`
								}
								title="Remove member"
								onClick={() => onRemove(member.id)}
								disabled={Boolean(pendingKey)}
							>
								<IconTrash aria-hidden="true" />
							</Button>
						) : null}
					</WorkspaceSettingsRow>
				</li>
			))}
		</ul>
	);
}
