import { AccountDangerZoneCard } from "@/features/settings/account/components/AccountDangerZoneCard";
import { AppearanceCard } from "@/features/settings/account/components/AppearanceCard";
import { EmailDigestsSample } from "@/features/settings/account/components/EmailDigestsCard";
import { ProfileLinkedAccountsCard } from "@/features/settings/account/components/ProfileLinkedAccountsCard";
import { ProfileOverviewCard } from "@/features/settings/account/components/ProfileOverviewCard";
import { WorkspaceDangerZoneCard } from "@/features/settings/workspace/components/WorkspaceDangerZoneCard";
import { WorkspaceIdentityCard } from "@/features/settings/workspace/components/WorkspaceIdentityCard";
import { WorkspaceIncomingInvitationsCard } from "@/features/settings/workspace/components/WorkspaceIncomingInvitationsCard";
import { WorkspaceInviteMemberForm } from "@/features/settings/workspace/components/WorkspaceInviteMemberForm";
import { WorkspaceMembersList } from "@/features/settings/workspace/components/WorkspaceMembersList";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { TeamInviteLinkActionsSample } from "@/features/team/components/TeamInviteLinkSurface";

const NOOP = () => {};
const RESOLVED = async () => {};
const SAMPLE_USER = { email: "you@example.com", name: "Your Name" };
const SAMPLE_PROVIDERS = new Set(["credential"]);
const SAMPLE_ORGANIZATION = {
	id: "sample",
	name: "Your workspace",
	slug: "your-workspace",
};
const SAMPLE_MEMBERS = [
	["Alex Morgan", "owner"],
	["Sam Lee", "owner"],
	["Jordan Patel", "admin"],
	["Riley Chen", "admin"],
	["Casey Brooks", "admin"],
	["Taylor Kim", "member"],
	["Morgan Diaz", "admin"],
	["Jamie Fox", "member"],
	["Avery Stone", "admin"],
].map(([name, role], index) => ({
	id: `sample-${index}`,
	role,
	user: {
		email: `${name.split(" ")[0].toLowerCase()}@example.com`,
		id: `sample-user-${index}`,
		image: null,
		name,
	},
}));

export function AccountSettingsSample() {
	return (
		<>
			<ProfileOverviewCard
				email={SAMPLE_USER.email}
				image={null}
				isSigningOut={false}
				name={SAMPLE_USER.name}
				onSignOut={NOOP}
			/>
			<AppearanceCard />
			<EmailDigestsSample />
			<ProfileLinkedAccountsCard
				isPending={false}
				linkedProviders={SAMPLE_PROVIDERS}
				linkingProvider={null}
				onLinkProvider={NOOP}
			/>
			<WorkspaceIncomingInvitationsCard
				title="Workspace invitations"
				description="Accept or decline workspace invites sent to your account."
				invitations={[]}
				isPending={false}
				processingId={null}
				onAccept={NOOP}
				onDecline={NOOP}
			/>
			<AccountDangerZoneCard user={SAMPLE_USER} onDeleted={RESOLVED} />
		</>
	);
}

export function WorkspaceSettingsSample() {
	return (
		<>
			<WorkspaceIdentityCard
				organization={SAMPLE_ORGANIZATION}
				canManage
				onInvalidate={NOOP}
			/>
			<WorkspaceDangerZoneCard organization={SAMPLE_ORGANIZATION} canManage />
		</>
	);
}

export function MembersSettingsSample() {
	return (
		<>
			<WorkspaceSettingsGroup
				title="Members"
				description="Invite teammates by email. Admins and owners can manage members."
			>
				<WorkspaceInviteMemberForm canManage onInvalidate={NOOP} />
				<WorkspaceMembersList
					members={SAMPLE_MEMBERS}
					canManage
					onInvalidate={NOOP}
				/>
			</WorkspaceSettingsGroup>
			<WorkspaceSettingsGroup
				title="Invite link"
				description="Share a link that lets teammates join this workspace as members."
			>
				<TeamInviteLinkActionsSample layout="settings" />
			</WorkspaceSettingsGroup>
		</>
	);
}
