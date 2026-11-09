import { useState } from "react";
import { toast } from "sonner";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { WorkspaceMembersTable } from "@/features/settings/workspace/components/WorkspaceMembersTable";
import type { TeamPageMemberRow } from "@/features/team/use-team-page-data";
import { useOptionalOrganization } from "@/features/workspace/organization/OrganizationProvider";
import { authClient } from "@/lib/auth-client";

export function WorkspaceMembersList({
	members,
	activity,
	canManage,
	onInvalidate,
}: {
	activity?: ReadonlyMap<string, TeamPageMemberRow>;
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
	canManage: boolean;
	onInvalidate: () => void;
}) {
	const { trackOrganizationAction } = useAnalyticsTracking({
		pageName: "organization",
	});
	const [pendingMemberKey, setPendingMemberKey] = useState<string | null>(null);
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;

	const removeMember = async (memberId: string) => {
		setPendingMemberKey(`remove:${memberId}`);
		trackOrganizationAction({
			actionName: "remove_member",
			targetType: "member",
			sourceComponent: "workspace_settings_section",
			targetId: memberId,
		});

		try {
			await authClient.organization.removeMember({
				memberIdOrEmail: memberId,
				organizationId,
			});
			onInvalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to remove member",
			);
		} finally {
			setPendingMemberKey(null);
		}
	};

	const updateRole = async (memberId: string, role: "member" | "admin") => {
		setPendingMemberKey(`role:${memberId}`);
		trackOrganizationAction({
			actionName: "update_member_role",
			targetType: "member",
			sourceComponent: "workspace_settings_section",
			targetId: memberId,
			targetRole: role,
		});

		try {
			await authClient.organization.updateMemberRole({
				memberId,
				role,
				organizationId,
			});
			onInvalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to update member role",
			);
		} finally {
			setPendingMemberKey(null);
		}
	};

	return (
		<WorkspaceMembersTable
			members={members}
			activity={activity}
			canEdit={canManage}
			pendingKey={pendingMemberKey}
			onRoleChange={(memberId, role) => void updateRole(memberId, role)}
			onRemove={(memberId) => void removeMember(memberId)}
		/>
	);
}
