import { useMemo } from "react";
import { CardContent } from "@/app/ui/card";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { SettingsPageReveal } from "@/features/settings/components/settings-page-skeleton";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";
import { CreateWorkspaceCard } from "@/features/settings/workspace/components/CreateWorkspaceCard";
import { WorkspaceEmptyStateCard } from "@/features/settings/workspace/components/WorkspaceEmptyStateCard";
import { WorkspaceMembersList } from "@/features/settings/workspace/components/WorkspaceMembersList";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { useWorkspaceSettingsData } from "@/features/settings/workspace/use-workspace-settings-data";
import { useTeamPageData } from "@/features/team/use-team-page-data";

export function MembersSettingsSection() {
	const data = useWorkspaceSettingsData();
	const selfHost = useSelfHost();
	const team = useTeamPageData();
	const activity = useMemo(
		() =>
			team.isPending
				? undefined
				: new Map(team.teamMemberRows.map((row) => [row.userId, row])),
		[team.isPending, team.teamMemberRows],
	);

	if (!data.state.isPending && !data.state.hasOrganization) {
		return (
			<div className="settings-page">
				<WorkspaceEmptyStateCard />
				<div id="new-workspace" className="scroll-mt-24">
					<CreateWorkspaceCard
						title="Create your first workspace"
						description="Start a workspace for your team, client, or project."
					/>
				</div>
			</div>
		);
	}

	return (
		<SettingsPageReveal routeId="members" loading={data.state.isPending}>
			{() => (
				<div className="settings-page">
					{!data.state.isPending && data.state.isError ? (
						<SettingsSectionCard>
							<CardContent className="text-body-xl text-ink-3">
								Member data couldn&apos;t be loaded right now.
							</CardContent>
						</SettingsSectionCard>
					) : null}

					{!data.state.isPending && !data.state.isError && data.activeOrg ? (
						<WorkspaceSettingsGroup
							title="People"
							description="Admins and owners can manage members. Usage covers the last 12 months."
						>
							<WorkspaceMembersList
								members={data.fullOrg?.members ?? []}
								activity={activity}
								canManage={data.canManage}
								onInvalidate={data.invalidate}
								signInLinks={
									selfHost && data.canManage
										? {
												viewerId: data.currentUserId,
												viewerRole: data.currentUserRole,
											}
										: null
								}
							/>
						</WorkspaceSettingsGroup>
					) : null}
				</div>
			)}
		</SettingsPageReveal>
	);
}
