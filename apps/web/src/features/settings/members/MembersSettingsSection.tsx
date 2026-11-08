import { useMemo } from "react";
import { CardContent } from "@/app/ui/card";
import { useTrackProductPageView } from "@/features/analytics/tracking/useTrackProductPageView";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";
import { buildMembersSettingsTracking } from "@/features/settings/settings-page-tracking";
import { CreateWorkspaceCard } from "@/features/settings/workspace/components/CreateWorkspaceCard";
import { WorkspaceEmptyStateCard } from "@/features/settings/workspace/components/WorkspaceEmptyStateCard";
import { WorkspaceInviteMemberForm } from "@/features/settings/workspace/components/WorkspaceInviteMemberForm";
import { WorkspaceMembersList } from "@/features/settings/workspace/components/WorkspaceMembersList";
import { WorkspaceSentInvitations } from "@/features/settings/workspace/components/WorkspaceSentInvitations";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { useWorkspaceSettingsData } from "@/features/settings/workspace/use-workspace-settings-data";
import { TeamInviteLinkSurface } from "@/features/team/components/TeamInviteLinkSurface";
import { useTeamPageData } from "@/features/team/use-team-page-data";

export function MembersSettingsSection() {
	const data = useWorkspaceSettingsData();
	const team = useTeamPageData();
	const activity = useMemo(
		() =>
			team.isPending
				? undefined
				: new Map(team.teamMemberRows.map((row) => [row.userId, row])),
		[team.isPending, team.teamMemberRows],
	);
	const memberCount = data.fullOrg?.members.length ?? 0;
	const pendingOutgoingInvitationCount = data.pendingInvitations.length;

	useTrackProductPageView(
		buildMembersSettingsTracking({
			hasOrganization: data.state.hasOrganization,
			hasWorkspaceData: data.state.hasData,
			isPending: data.state.isPending,
			isError: data.state.isError,
			memberCount,
			pendingOutgoingInvitationCount,
			canManage: data.canManage,
		}),
	);

	if (data.state.isPending) return <SettingsPageSkeleton routeId="members" />;

	if (!data.state.hasOrganization) {
		return (
			<div className="workspace-settings-page">
				<WorkspaceEmptyStateCard />
				<div id="new-workspace" className="scroll-mt-24">
					<CreateWorkspaceCard
						title="Create your first workspace"
						description="Start a workspace before inviting members."
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="workspace-settings-page">
			{!data.state.isPending && data.state.isError ? (
				<SettingsSectionCard>
					<CardContent className="text-sm text-muted-foreground">
						Member data couldn&apos;t be loaded right now.
					</CardContent>
				</SettingsSectionCard>
			) : null}

			{!data.state.isPending && !data.state.isError && data.activeOrg ? (
				<>
					{/* Members card: invite, then the roster, then any
					    invitations still pending. */}
					<WorkspaceSettingsGroup
						title="People"
						description="Invite teammates by email. Admins and owners can manage members. Usage covers the last 12 months."
					>
						<WorkspaceInviteMemberForm
							canManage={data.canManage}
							onInvalidate={data.invalidate}
						/>
						<WorkspaceMembersList
							members={data.fullOrg?.members ?? []}
							activity={activity}
							canManage={data.canManage}
							onInvalidate={data.invalidate}
						/>
						<WorkspaceSentInvitations
							invitations={data.pendingInvitations}
							canCancel={data.canManage}
							onInvalidate={data.invalidate}
						/>
					</WorkspaceSettingsGroup>
					<WorkspaceSettingsGroup
						title="Invite link"
						description="Share a link that lets teammates join this workspace as members."
					>
						{data.canManage ? (
							<TeamInviteLinkSurface
								key={data.activeOrg.id}
								layout="settings"
								organizationId={data.activeOrg.id}
							/>
						) : (
							<p className="workspace-settings-empty">
								Only admins and owners can manage invite links.
							</p>
						)}
					</WorkspaceSettingsGroup>
				</>
			) : null}
		</div>
	);
}
