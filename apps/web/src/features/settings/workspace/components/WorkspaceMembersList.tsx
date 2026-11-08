import { useState } from "react";
import { toast } from "sonner";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import {
	canCopySignInLink,
	describeLinkLifetime,
	requestSignInLink,
} from "@/features/self-hosted/account-recovery";
import { WorkspaceMembersTable } from "@/features/settings/workspace/components/WorkspaceMembersTable";
import type { TeamPageMemberRow } from "@/features/team/use-team-page-data";
import { authClient } from "@/lib/auth-client";
import { copyTextToClipboardWithResult } from "@/lib/clipboard";

export function WorkspaceMembersList({
	members,
	activity,
	canManage,
	onInvalidate,
	signInLinks,
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
	signInLinks?: { viewerId: string; viewerRole: string | null } | null;
}) {
	const { trackOrganizationAction } = useAnalyticsTracking({
		pageName: "organization",
	});
	const [pendingMemberKey, setPendingMemberKey] = useState<string | null>(null);

	const removeMember = async (memberId: string) => {
		setPendingMemberKey(`remove:${memberId}`);
		trackOrganizationAction({
			actionName: "remove_member",
			targetType: "member",
			sourceComponent: "workspace_settings_section",
			targetId: memberId,
		});

		try {
			await authClient.organization.removeMember({ memberIdOrEmail: memberId });
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
			await authClient.organization.updateMemberRole({ memberId, role });
			onInvalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to update member role",
			);
		} finally {
			setPendingMemberKey(null);
		}
	};

	const copySignInLink = async (member: (typeof members)[number]) => {
		const name = member.user.name || member.user.email;
		setPendingMemberKey(`link:${member.id}`);
		try {
			const link = await requestSignInLink(member.user.email);
			const lifetime = describeLinkLifetime(link.expiresAt, Date.now());
			const result = await copyTextToClipboardWithResult(link.loginUrl, {
				allowPromptFallback: true,
				promptMessage: `Sign-in link for ${name}. ${lifetime}`,
			});
			if (result === "copied")
				toast.success(`Sign-in link for ${name} copied. ${lifetime}`);
			else if (result === "failed")
				toast.error(`Could not copy the sign-in link for ${name}.`);
		} catch (cause) {
			toast.error(
				cause instanceof Error
					? cause.message
					: "Could not make a sign-in link.",
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
			signInLink={
				signInLinks
					? {
							canCopy: (member) =>
								canCopySignInLink(
									{ id: signInLinks.viewerId, role: signInLinks.viewerRole },
									member,
								),
							onCopy: (member) => void copySignInLink(member),
						}
					: null
			}
		/>
	);
}
