import { IconLink, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Button } from "@/app/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/ui/dialog";
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
import { LastActive } from "@/features/team/components/TeamMemberOverviewTable";
import type { TeamPageMemberRow } from "@/features/team/use-team-page-data";
import {
	formatCompactWholeCurrency,
	formatCompactWholeNumber,
} from "@/lib/format";

function getInitials(name: string, email: string) {
	const source = name.trim() || email.trim() || "R";
	return source
		.split(" ")
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

function MemberActivity({ row }: { row: TeamPageMemberRow | undefined }) {
	if (!row?.hasActivity) {
		return (
			<p className="settings-member-activity">
				No sessions in the last 12 months
			</p>
		);
	}
	return (
		<p className="settings-member-activity">
			<span>
				{formatCompactWholeNumber(row.totalSessions)}{" "}
				{row.totalSessions === 1 ? "session" : "sessions"}
			</span>
			<span>{formatCompactWholeNumber(row.totalTokens)} tokens</span>
			{row.cost === null ? null : (
				<span>{formatCompactWholeCurrency(row.cost)}</span>
			)}
			<LastActive lastActiveDate={row.lastActiveDate} />
		</p>
	);
}

type MemberRow = {
	id: string;
	role: string;
	user: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	};
};

export function WorkspaceMembersTable({
	members,
	activity,
	canEdit,
	pendingKey,
	onRoleChange,
	onRemove,
	signInLink,
}: {
	members: readonly MemberRow[];
	canEdit: boolean;
	pendingKey: string | null;
	onRoleChange: (memberId: string, role: "member" | "admin") => void;
	onRemove: (memberId: string) => void;
	activity?: ReadonlyMap<string, TeamPageMemberRow>;
	signInLink?: {
		canCopy: (member: MemberRow) => boolean;
		onCopy: (member: MemberRow) => void;
	} | null;
}) {
	const [removing, setRemoving] = useState<(typeof members)[number] | null>(
		null,
	);
	if (members.length === 0) {
		return (
			<p className="settings-empty">
				No members are visible for this workspace yet.
			</p>
		);
	}

	return (
		<>
			<ul className="settings-list" aria-label="Workspace members">
				{members.map((member) => (
					<li key={member.id}>
						<WorkspaceSettingsRow
							label={
								// Member row: name with the email beside it.
								<div className="settings-member-identity">
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
									<div className="settings-member-text">
										<div className="settings-member-copy">
											<span>{member.user.name || member.user.email}</span>
											<span>{member.user.email}</span>
										</div>
										{activity ? (
											<MemberActivity row={activity.get(member.user.id)} />
										) : (
											<p
												className="settings-member-activity"
												aria-hidden="true"
											>
												 
											</p>
										)}
									</div>
								</div>
							}
						>
							<div className="settings-role">
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
									<span className="settings-status">
										<WorkspaceRoleLabel
											value={member.role === "admin" ? "admin" : "member"}
										/>
									</span>
								)}
							</div>
							{signInLink ? (
								signInLink.canCopy(member) ? (
									<Button
										type="button"
										variant="quiet"
										size="icon-sm"
										className="settings-icon-button"
										aria-label={
											pendingKey === `link:${member.id}`
												? `Making a sign-in link for ${member.user.name || member.user.email}`
												: `Copy a sign-in link for ${member.user.name || member.user.email}`
										}
										title="Copy sign-in link"
										onClick={() => signInLink.onCopy(member)}
										disabled={Boolean(pendingKey)}
									>
										<IconLink aria-hidden="true" />
									</Button>
								) : (
									<span aria-hidden="true" className="settings-icon-slot" />
								)
							) : null}
							{canEdit && member.role === "owner" ? (
								<span aria-hidden="true" className="settings-icon-slot" />
							) : null}
							{canEdit && member.role !== "owner" ? (
								<Button
									type="button"
									variant="quiet"
									size="icon-sm"
									className="settings-icon-button"
									aria-label={
										pendingKey === `remove:${member.id}`
											? `Removing ${member.user.name || member.user.email}`
											: `Remove ${member.user.name || member.user.email}`
									}
									title="Remove member"
									onClick={() => setRemoving(member)}
									disabled={Boolean(pendingKey)}
								>
									<IconTrash aria-hidden="true" />
								</Button>
							) : null}
						</WorkspaceSettingsRow>
					</li>
				))}
			</ul>
			<Dialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove member?</DialogTitle>
						<DialogDescription>
							{removing?.user.name || removing?.user.email} will lose access to
							this workspace.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="bordered"
							size="md"
							onClick={() => setRemoving(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="md"
							onClick={() => {
								if (removing) onRemove(removing.id);
								setRemoving(null);
							}}
						>
							Remove member
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
