import { CardContent } from "@/app/ui/card";
import { useTrackProductPageView } from "@/features/analytics/tracking/useTrackProductPageView";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import {
	SettingsSectionCard,
	SettingsSectionStack,
} from "@/features/settings/components/settings-section";
import { buildMembersSettingsTracking } from "@/features/settings/settings-page-tracking";
import { CreateWorkspaceCard } from "@/features/settings/workspace/components/CreateWorkspaceCard";
import { WorkspaceEmptyStateCard } from "@/features/settings/workspace/components/WorkspaceEmptyStateCard";
import { WorkspaceInviteMemberCard } from "@/features/settings/workspace/components/WorkspaceInviteMemberCard";
import { WorkspaceMembersCard } from "@/features/settings/workspace/components/WorkspaceMembersCard";
import { WorkspaceOutgoingInvitationsCard } from "@/features/settings/workspace/components/WorkspaceOutgoingInvitationsCard";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { useWorkspaceSettingsData } from "@/features/settings/workspace/use-workspace-settings-data";
import { TeamInviteLinkSurface } from "@/features/team/components/TeamInviteLinkSurface";

export function MembersSettingsSection() {
	const data = useWorkspaceSettingsData();
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
			<SettingsSectionStack>
				<WorkspaceEmptyStateCard />
				<div id="new-workspace" className="scroll-mt-24">
					<CreateWorkspaceCard
						title="Create your first workspace"
						description="Start a workspace before inviting members."
					/>
				</div>
			</SettingsSectionStack>
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
					<WorkspaceMembersCard
						members={data.fullOrg?.members ?? []}
						canManage={data.canManage}
						onInvalidate={data.invalidate}
					/>
					<WorkspaceInviteMemberCard
						canManage={data.canManage}
						onInvalidate={data.invalidate}
					/>
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
					<WorkspaceOutgoingInvitationsCard
						invitations={data.pendingInvitations}
						canCancel={data.canManage}
						onInvalidate={data.invalidate}
					/>
				</>
			) : null}
		</div>
	);
}
