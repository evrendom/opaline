import { Skeleton } from "@/app/ui/skeleton";
import type { PrimarySettingsRouteId } from "@/features/settings/config/settings-routes";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";

function MemberRowSkeleton() {
	return (
		<WorkspaceSettingsRow
			label={
				<div className="workspace-settings-member-identity">
					<Skeleton className="size-8 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="h-4 w-28 rounded" />
						<Skeleton className="h-4 w-40 max-w-full rounded" />
					</div>
				</div>
			}
		>
			<Skeleton />
		</WorkspaceSettingsRow>
	);
}

export function SettingsPageSkeleton({
	routeId,
}: {
	routeId: PrimarySettingsRouteId;
}) {
	return (
		<div
			className="workspace-settings-page"
			aria-busy="true"
			data-slot="settings-page-skeleton"
		>
			<output className="sr-only">Loading {routeId} settings</output>
			{routeId === "sessions" ? (
				<div className="flex flex-col gap-6">
					<Skeleton className="h-24 w-full" />
					{[1, 2, 3].map((key) => (
						<Skeleton key={key} className="h-12 w-full" />
					))}
				</div>
			) : routeId === "workspace" ? (
				<>
					<WorkspaceSettingsGroup title="Workspace" hideTitle>
						{["Name", "Slug"].map((label) => (
							<WorkspaceSettingsRow key={label} label={label}>
								<Skeleton />
							</WorkspaceSettingsRow>
						))}
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup title="Danger zone">
						<WorkspaceSettingsRow
							label="Delete workspace"
							description="Permanently delete this workspace and its session data for every member. This cannot be undone."
						>
							<Skeleton className="max-w-34" />
						</WorkspaceSettingsRow>
					</WorkspaceSettingsGroup>
				</>
			) : routeId === "members" ? (
				<>
					<WorkspaceSettingsGroup title="Members" hideTitle>
						{["first", "second", "third", "fourth"].map((key) => (
							<MemberRowSkeleton key={key} />
						))}
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Invite member"
						description="Invite a teammate by email and choose their workspace role."
					>
						{["Email", "Role"].map((label) => (
							<WorkspaceSettingsRow key={label} label={label}>
								<Skeleton />
							</WorkspaceSettingsRow>
						))}
						<div className="workspace-settings-actions">
							<Skeleton />
						</div>
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Invite link"
						description="Share a link that lets teammates join this workspace as members."
					>
						<div className="workspace-settings-link-surface">
							<div className="workspace-settings-link-actions">
								<Skeleton />
								<Skeleton />
							</div>
						</div>
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Outgoing invitations"
						description="Pending invitations that haven't been accepted yet."
					>
						<div className="workspace-settings-empty">
							<Skeleton className="h-5 w-64 max-w-full rounded" />
						</div>
					</WorkspaceSettingsGroup>
				</>
			) : (
				<>
					<WorkspaceSettingsGroup title="Profile">
						<WorkspaceSettingsRow label="Profile photo">
							<Skeleton className="max-w-8 rounded-full" />
						</WorkspaceSettingsRow>
						{["Name", "Email"].map((label) => (
							<WorkspaceSettingsRow key={label} label={label}>
								<Skeleton />
							</WorkspaceSettingsRow>
						))}
						<WorkspaceSettingsRow
							label="Session"
							description="Sign out from this device without affecting other sessions."
						>
							<Skeleton className="max-w-20" />
						</WorkspaceSettingsRow>
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Linked accounts"
						description="Manage the sign-in methods connected to your account."
					>
						{["Email & password", "Google", "GitHub"].map((label) => (
							<WorkspaceSettingsRow key={label} label={label}>
								<Skeleton className="max-w-20" />
							</WorkspaceSettingsRow>
						))}
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Workspace invitations"
						description="Accept or decline workspace invites sent to your account."
					>
						<div className="workspace-settings-empty">
							<Skeleton className="h-5 w-64 max-w-full rounded" />
						</div>
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup title="Danger zone">
						<WorkspaceSettingsRow
							label="Delete account"
							description="Permanently delete your account and all related data. This cannot be undone."
						>
							<Skeleton className="max-w-34" />
						</WorkspaceSettingsRow>
					</WorkspaceSettingsGroup>
				</>
			)}
		</div>
	);
}
