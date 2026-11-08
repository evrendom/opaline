import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { appRoutes } from "@/app/routes";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { useTrackProductPageView } from "@/features/analytics/tracking/useTrackProductPageView";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { sendsEmail } from "@/features/self-hosted/surfaces";
import { AccountDangerZoneCard } from "@/features/settings/account/components/AccountDangerZoneCard";
import { AppearanceCard } from "@/features/settings/account/components/AppearanceCard";
import { EmailDigestsCard } from "@/features/settings/account/components/EmailDigestsCard";
import { ProfileLinkedAccountsCard } from "@/features/settings/account/components/ProfileLinkedAccountsCard";
import { ProfileOverviewCard } from "@/features/settings/account/components/ProfileOverviewCard";
import { useAccountSettingsData } from "@/features/settings/account/use-account-settings-data";
import { SettingsPageSkeleton } from "@/features/settings/components/settings-page-skeleton";
import { useInvitationsSettingsData } from "@/features/settings/invitations/use-invitations-settings-data";
import { buildAccountSettingsTracking } from "@/features/settings/settings-page-tracking";
import { WorkspaceIncomingInvitationsCard } from "@/features/settings/workspace/components/WorkspaceIncomingInvitationsCard";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { resolveWorkspaceAppPath } from "@/features/workspace/organization/workspace-navigation";
import { authClient, signOut } from "@/lib/auth-client";

export function AccountSettingsSection() {
	const navigate = useNavigate();
	const selfHost = useSelfHost();
	const getShellRoutePath = useShellRoutePath();
	const data = useAccountSettingsData();
	const invitationsData = useInvitationsSettingsData();
	const { trackAuthenticationAction } = useAnalyticsTracking();
	const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
	const [processingInvitationId, setProcessingInvitationId] = useState<
		string | null
	>(null);
	const [isSigningOut, setIsSigningOut] = useState(false);

	const handleLinkProvider = (provider: "google" | "github") => {
		trackAuthenticationAction({
			actionName: "link_provider",
			sourceComponent: "account_settings_section",
			targetId: provider,
			authMethod: provider,
		});
		setLinkingProvider(provider);
		authClient.linkSocial({
			provider,
			callbackURL: `${window.location.origin}${getShellRoutePath(appRoutes.settingsAccount())}`,
		});
	};

	const handleSignOut = async () => {
		trackAuthenticationAction({
			actionName: "sign_out",
			sourceComponent: "account_settings_section",
			authMethod: "session",
		});
		setIsSigningOut(true);
		try {
			await signOut();
			navigate("/");
		} catch (cause) {
			setIsSigningOut(false);
			toast.error(
				cause instanceof Error ? cause.message : "Failed to sign out",
			);
		}
	};
	const handleAcceptInvitation = async (invitationId: string) => {
		trackAuthenticationAction({
			actionName: "accept_invitation",
			sourceComponent: "account_settings_section",
			authMethod: "invitation",
			targetId: invitationId,
		});
		setProcessingInvitationId(invitationId);

		try {
			const response = await authClient.organization.acceptInvitation({
				invitationId,
			});
			if (response.data) {
				try {
					navigate(
						await resolveWorkspaceAppPath(
							response.data.member.organizationId,
							appRoutes.settingsAccount(),
						),
					);
				} catch (cause) {
					toast.error(
						cause instanceof Error
							? cause.message
							: "Invitation accepted but workspace switch failed",
					);
				}
			}
			invitationsData.invalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to accept invitation",
			);
		} finally {
			setProcessingInvitationId(null);
		}
	};

	const handleAccountDeleted = async () => {
		try {
			await signOut();
		} catch (error) {
			void error;
		}
		navigate("/");
		toast.success("Account deleted");
	};

	const handleDeclineInvitation = async (invitationId: string) => {
		trackAuthenticationAction({
			actionName: "decline_invitation",
			sourceComponent: "account_settings_section",
			authMethod: "invitation",
			targetId: invitationId,
		});
		setProcessingInvitationId(invitationId);

		try {
			await authClient.organization.rejectInvitation({ invitationId });
			invitationsData.invalidate();
		} catch (cause) {
			toast.error(
				cause instanceof Error ? cause.message : "Failed to decline invitation",
			);
		} finally {
			setProcessingInvitationId(null);
		}
	};

	useTrackProductPageView(
		buildAccountSettingsTracking({
			isAccountPending: data.state.isPending,
			hasAccountData: data.state.hasData,
			linkedProviderCount: data.linkedProviders.size,
			isInvitationsPending: invitationsData.state.isPending,
			hasInvitationsData: invitationsData.state.hasData,
			invitationCount: invitationsData.count,
		}),
	);

	if (data.state.isPending) return <SettingsPageSkeleton routeId="account" />;

	return (
		<div className="workspace-settings-page">
			<ProfileOverviewCard
				name={data.user.name}
				email={data.user.email}
				image={data.user.image}
				isSigningOut={isSigningOut}
				onSignOut={() => void handleSignOut()}
			/>
			<AppearanceCard />
			{sendsEmail(selfHost) ? (
				<div id="email-digests" className="scroll-mt-24">
					<EmailDigestsCard />
				</div>
			) : null}
			<ProfileLinkedAccountsCard
				isPending={data.state.isPending}
				linkedProviders={data.linkedProviders}
				linkingProvider={linkingProvider}
				onLinkProvider={handleLinkProvider}
			/>
			<div id="workspace-invitations" className="scroll-mt-24">
				<WorkspaceIncomingInvitationsCard
					title="Workspace invitations"
					description="Accept or decline workspace invites sent to your account."
					invitations={invitationsData.invitations}
					isPending={invitationsData.state.isPending}
					processingId={processingInvitationId}
					onAccept={(invitationId) => void handleAcceptInvitation(invitationId)}
					onDecline={(invitationId) =>
						void handleDeclineInvitation(invitationId)
					}
				/>
			</div>
			{data.state.hasData ? (
				<div id="delete-account" className="scroll-mt-24">
					<AccountDangerZoneCard
						user={{ email: data.user.email, name: data.user.name }}
						onDeleted={handleAccountDeleted}
					/>
				</div>
			) : null}
		</div>
	);
}
