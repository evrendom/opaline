import type {
	GitHubRepositoryConnectionStatus,
	RepositorySettings,
} from "@rudel/api-routes";
import type { ReactNode } from "react";
import { CardContent } from "@/app/ui/card";
import { AppearanceCard } from "@/features/settings/account/components/AppearanceCard";
import { ProfileOverviewCard } from "@/features/settings/account/components/ProfileOverviewCard";
import { SettingsSectionCard } from "@/features/settings/components/settings-section";
import { GitHubRepositoryList } from "@/features/settings/github/GitHubRepositoryList";
import { SettingsSectionTab } from "@/features/settings/SettingsLayout";
import { SessionsSettingsView } from "@/features/settings/sessions/sessions-settings-view";
import { BillingManagementCard } from "@/features/settings/workspace/components/BillingManagementCard";
import { GitHubConnectionCard } from "@/features/settings/workspace/components/GitHubConnectionCard";
import { WorkspaceDangerZoneCard } from "@/features/settings/workspace/components/WorkspaceDangerZoneCard";
import { WorkspaceIdentityCard } from "@/features/settings/workspace/components/WorkspaceIdentityCard";
import { WorkspaceInviteMemberForm } from "@/features/settings/workspace/components/WorkspaceInviteMemberForm";
import { WorkspaceMembersTable } from "@/features/settings/workspace/components/WorkspaceMembersTable";
import { WorkspaceSettingsGroup } from "@/features/settings/workspace/components/workspace-settings-group";
import { TeamInviteLinkSurface } from "@/features/team/components/TeamInviteLinkSurface";
import type { TeamPageMemberRow } from "@/features/team/use-team-page-data";
import { Group, Specimen, State } from "./kit";
import { demoPortraits, seed } from "./providers";

const NOOP = () => {};
const DISCONNECTED = async () => false;

// The demo workspace's three members, in the shapes the members page passes.
const MEMBERS = [
	["Rafa", "member", null],
	["Evren", "owner", demoPortraits[0]],
	["Marc", "admin", null],
] as const;
const MEMBER_ROWS = MEMBERS.map(([name, role, image], index) => ({
	id: `member-${index}`,
	role,
	user: {
		email: `${name.toLowerCase()}.demo@opaline.so`,
		id: `user-${index}`,
		image,
		name,
	},
}));
const ACTIVITY = new Map<string, TeamPageMemberRow>(
	MEMBER_ROWS.map((member, index) => [
		member.user.id,
		{
			activeDays: 12,
			cost: [283, 760, 1950][index] ?? 0,
			displayName: member.user.name,
			email: member.user.email,
			favoriteModel: "gpt-5.5",
			hasActivity: true,
			imageUrl: member.user.image,
			inputTokens: 0,
			lastActiveDate: new Date().toISOString(),
			outputTokens: 0,
			role: member.role,
			totalSessions: [37, 38, 34][index] ?? 0,
			totalTokens: [264e6, 630e6, 1e9][index] ?? 0,
			userId: member.user.id,
		},
	]),
);

// The repositories the sessions settings list, one per upload state.
const REPORTED = "2026-08-31T12:00:00Z";
type UploadRepository = RepositorySettings["repositories"][number];
type UploadState = UploadRepository["reports"][number]["state"];
const report = (installationId: string, state: UploadState) => ({
	installationId,
	reportedAt: REPORTED,
	state,
});
const UPLOAD_REPOSITORIES: UploadRepository[] = [
	...seed.navigation.map(
		(repo, index): UploadRepository => ({
			key: repo.identity.repoKey,
			name: repo.identity.repoLabel,
			reports:
				index === 0
					? [report("mac-1", "enabled"), report("mac-2", "disabled")]
					: [report("mac-1", index === 1 ? "enabled" : "needs_attention")],
			sessionCount: repo.sessionCount,
		}),
	),
	{ key: "local:scratch", name: "scratch", reports: [], sessionCount: 3 },
	{
		key: "remote:github.com/acme/docs",
		name: "acme/docs",
		reports: [report("mac-1", "disabled")],
		sessionCount: 9,
	},
];

const GITHUB_STATUS: GitHubRepositoryConnectionStatus = {
	accountLogin: "acme",
	accountType: "Organization",
	canManage: true,
	configurationError: null,
	configured: true,
	connected: true,
	dashboard: "visible",
	installationId: "1",
	manageUrl: "https://github.com/organizations/acme/settings/installations/1",
	repositories: seed.navigation.map((repo, index) => ({
		defaultBranch: "main",
		isPrivate: index !== 0,
		name: repo.identity.repoName ?? repo.identity.repoLabel,
		nodeId: `node-${index}`,
		owner: "acme",
		repositoryId: String(index + 1),
		sync:
			index === 2
				? { progress: 0.4, state: "syncing" as const }
				: { state: "ready" as const },
	})),
	repositorySelection: "selected",
	suspended: false,
};

/** The members list as Settings → Members renders it for an admin: invite
 *  form above, rows with the role select, the owner badge and remove. */
export function MembersTableControl() {
	return (
		<WorkspaceSettingsGroup
			title="People"
			description="Invite teammates by email. Admins and owners can manage members. Usage covers the last 12 months."
		>
			<WorkspaceInviteMemberForm canManage onInvalidate={NOOP} />
			<WorkspaceMembersTable
				members={MEMBER_ROWS}
				activity={ACTIVITY}
				canEdit
				pendingKey={null}
				onRoleChange={NOOP}
				onRemove={NOOP}
			/>
		</WorkspaceSettingsGroup>
	);
}

/** Settings → Account → Appearance: the theme's segmented control. */
export function AppearanceControl() {
	return <AppearanceCard />;
}

function Column({ children }: { children: ReactNode }) {
	return (
		<div className="settings-page w-full max-w-[40rem] pb-zero">{children}</div>
	);
}

export function SettingsGroup() {
	return (
		<Group title="Settings">
			<Specimen
				name="SettingsSectionTab"
				source="features/settings/SettingsLayout.tsx"
				where="The settings sidebar: one per section, the open one on a sliding card."
			>
				<ul className="flex w-[168px] flex-col gap-xs">
					<SettingsSectionTab
						routeId="workspace"
						to="#workspace"
						active={false}
					/>
					<SettingsSectionTab routeId="github" to="#github" active={false} />
					<SettingsSectionTab
						routeId="sessions"
						to="#sessions"
						active={false}
					/>
					<SettingsSectionTab routeId="reports" to="#reports" active={false} />
					<SettingsSectionTab routeId="members" to="#members" active={false} />
					<SettingsSectionTab routeId="account" to="#account" active />
				</ul>
			</Specimen>

			<Specimen
				name="Settings page title (.settings-page-title)"
				source="features/settings/SettingsLayout.tsx"
				where="Above every settings section: display-xs, medium."
			>
				<h1 className="settings-page-title">Account</h1>
			</Specimen>

			<Specimen
				name="WorkspaceIdentityCard (WorkspaceSettingsGroup, WorkspaceSettingsRow, Input)"
				source="features/settings/workspace/components/WorkspaceIdentityCard.tsx"
				where="Settings → Workspace → General: the name and the workspace URL field."
			>
				<Column>
					<WorkspaceIdentityCard
						organization={seed.organization}
						canManage
						onInvalidate={NOOP}
					/>
				</Column>
			</Specimen>

			<Specimen
				name="ProfileOverviewCard"
				source="features/settings/account/components/ProfileOverviewCard.tsx"
				where="Settings → Account → Profile: photo, read-only name and email, sign out."
			>
				<Column>
					<ProfileOverviewCard
						email="evren.demo@opaline.so"
						image={demoPortraits[0]}
						isSigningOut={false}
						name="Evren"
						onSignOut={NOOP}
					/>
				</Column>
			</Specimen>

			<Specimen
				name="AppearanceCard (ThemeSwitcher)"
				source="features/settings/account/components/AppearanceCard.tsx"
				where="Settings → Account → Appearance: system, light or dark."
			>
				<Column>
					<AppearanceControl />
				</Column>
			</Specimen>

			<Specimen
				name="WorkspaceInviteMemberForm, WorkspaceMembersTable"
				source="features/settings/workspace/components/WorkspaceMembersTable.tsx"
				where="Settings → Members → People: invite by email, then each member with usage, role select (size sm), owner badge and remove."
			>
				<Column>
					<MembersTableControl />
				</Column>
			</Specimen>

			<Specimen
				name="WorkspaceMembersTable, no members (.settings-empty)"
				source="features/settings/workspace/components/WorkspaceMembersTable.tsx"
				where="Settings → Members when no member is visible."
			>
				<Column>
					<WorkspaceSettingsGroup title="People">
						<WorkspaceMembersTable
							members={[]}
							canEdit
							pendingKey={null}
							onRoleChange={NOOP}
							onRemove={NOOP}
						/>
					</WorkspaceSettingsGroup>
				</Column>
			</Specimen>

			<Specimen
				name="TeamInviteLinkSurface (layout settings)"
				source="features/team/components/TeamInviteLinkSurface.tsx"
				where="Settings → Members → Invite link, before a link is made."
			>
				<Column>
					<WorkspaceSettingsGroup
						title="Invite link"
						description="Share a link that lets teammates join this workspace as members."
					>
						<TeamInviteLinkSurface
							layout="settings"
							organizationId={seed.organization.id}
						/>
					</WorkspaceSettingsGroup>
				</Column>
			</Specimen>

			<Specimen
				name="SessionsSettingsView (command copy field, RepositorySearchField, upload table)"
				source="features/settings/sessions/sessions-settings-view.tsx"
				where="Settings → Sessions: the upload command, then repositories with each upload state."
			>
				<State label="loaded" className="w-full max-w-[40rem]">
					<SessionsSettingsView
						copied={false}
						error={false}
						fetching={false}
						onCopy={NOOP}
						onRefresh={NOOP}
						onSearch={NOOP}
						pending={false}
						repositories={UPLOAD_REPOSITORIES}
						search=""
						visible={UPLOAD_REPOSITORIES}
					/>
				</State>
				<State label="could not load" className="w-full max-w-[40rem]">
					<SessionsSettingsView
						copied
						error
						fetching={false}
						onCopy={NOOP}
						onRefresh={NOOP}
						onSearch={NOOP}
						pending={false}
						repositories={undefined}
						search=""
						visible={[]}
					/>
				</State>
			</Specimen>

			<Specimen
				name="GitHubConnectionCard"
				source="features/settings/workspace/components/GitHubConnectionCard.tsx"
				where="Settings → GitHub → Connection: account, dashboard, CI history and disconnect rows."
			>
				<Column>
					<GitHubConnectionCard
						status={GITHUB_STATUS}
						isPending={false}
						isError={false}
						isConnecting={false}
						actionError={null}
						onConnect={NOOP}
						onDisconnect={DISCONNECTED}
						onRetry={NOOP}
					/>
				</Column>
			</Specimen>

			<Specimen
				name="GitHubRepositoryList"
				source="features/settings/github/GitHubRepositoryList.tsx"
				where="Settings → GitHub → Repositories: search, visibility and sync."
			>
				<Column>
					<GitHubRepositoryList status={GITHUB_STATUS} />
				</Column>
			</Specimen>

			<Specimen
				name="BillingManagementCard"
				source="features/settings/workspace/components/BillingManagementCard.tsx"
				where="Settings → Workspace → Billing; shows .settings-error when billing can't load, as in the demo."
			>
				<Column>
					<BillingManagementCard
						organizationId={seed.organization.id}
						workspaceSlug={seed.organization.slug}
					/>
				</Column>
			</Specimen>

			<Specimen
				name="WorkspaceDangerZoneCard (tone danger)"
				source="features/settings/workspace/components/WorkspaceDangerZoneCard.tsx"
				where="Settings → Workspace → Danger zone: destructive sm button."
			>
				<State label="admin" className="w-full max-w-[40rem]">
					<Column>
						<WorkspaceDangerZoneCard
							organization={seed.organization}
							canManage
						/>
					</Column>
				</State>
				<State label="member (disabled)" className="w-full max-w-[40rem]">
					<Column>
						<WorkspaceDangerZoneCard
							organization={seed.organization}
							canManage={false}
						/>
					</Column>
				</State>
			</Specimen>

			<Specimen
				name="SettingsSectionCard"
				source="features/settings/components/settings-section.tsx"
				where="Settings → Reports and Members when their data can't load."
			>
				<Column>
					<SettingsSectionCard>
						<CardContent className="text-body-xl text-ink-3">
							Reports couldn&apos;t be loaded right now.
						</CardContent>
					</SettingsSectionCard>
				</Column>
			</Specimen>
		</Group>
	);
}
