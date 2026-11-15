import { CardContent } from "@/app/ui/card";
import { useTrackProductPageView } from "@/features/analytics/tracking/useTrackProductPageView";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { showsBilling } from "@/features/self-hosted/surfaces";
import { SettingsPageReveal } from "@/features/settings/components/settings-page-skeleton";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";
import { buildWorkspaceSettingsTracking } from "@/features/settings/settings-page-tracking";
import { BillingManagementCard } from "@/features/settings/workspace/components/BillingManagementCard";
import { BillingSandboxCard } from "@/features/settings/workspace/components/BillingSandboxCard";
import { CreateWorkspaceCard } from "@/features/settings/workspace/components/CreateWorkspaceCard";
import { WorkspaceDangerZoneCard } from "@/features/settings/workspace/components/WorkspaceDangerZoneCard";
import { WorkspaceEmptyStateCard } from "@/features/settings/workspace/components/WorkspaceEmptyStateCard";
import { WorkspaceIdentityCard } from "@/features/settings/workspace/components/WorkspaceIdentityCard";
import { useWorkspaceSettingsData } from "@/features/settings/workspace/use-workspace-settings-data";

export function WorkspaceSettingsSection() {
	const data = useWorkspaceSettingsData();
	const selfHost = useSelfHost();
	const memberCount = data.fullOrg?.members.length ?? 0;
	const pendingOutgoingInvitationCount = data.pendingInvitations.length;

	useTrackProductPageView(
		buildWorkspaceSettingsTracking({
			hasOrganization: data.state.hasOrganization,
			isPending: data.state.isPending,
			isError: data.state.isError,
			memberCount,
			pendingOutgoingInvitationCount,
		}),
	);

	if (!data.state.isPending && !data.state.hasOrganization) {
		return (
			<div className="workspace-settings-page">
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
		<SettingsPageReveal routeId="workspace" loading={data.state.isPending}>
			{() => (
				<div className="workspace-settings-page">
					{!data.state.isPending && data.state.isError ? (
						<SettingsSectionCard>
							<CardContent className="text-sm text-muted-foreground">
								Organization data couldn&apos;t be loaded right now.
							</CardContent>
						</SettingsSectionCard>
					) : null}

					{!data.state.isPending && !data.state.isError && data.activeOrg ? (
						<>
							<WorkspaceIdentityCard
								organization={data.activeOrg}
								canManage={data.canManage}
								onInvalidate={data.invalidate}
							/>
							{data.currentUserRole === "owner" && showsBilling(selfHost) ? (
								<>
									<BillingManagementCard
										organizationId={data.activeOrg.id}
										workspaceSlug={data.activeOrg.slug}
									/>
									<BillingSandboxCard organizationId={data.activeOrg.id} />
								</>
							) : null}
							<WorkspaceDangerZoneCard
								organization={data.activeOrg}
								canManage={data.canManage}
							/>
						</>
					) : null}
				</div>
			)}
		</SettingsPageReveal>
	);
}
