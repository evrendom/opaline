import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { appRoutes } from "@/app/routes";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { PasswordCard } from "@/features/self-hosted/PasswordCard";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { AccountDangerZoneCard } from "@/features/settings/account/components/AccountDangerZoneCard";
import { AppearanceCard } from "@/features/settings/account/components/AppearanceCard";
import { ProfileLinkedAccountsCard } from "@/features/settings/account/components/ProfileLinkedAccountsCard";
import { ProfileOverviewCard } from "@/features/settings/account/components/ProfileOverviewCard";
import { useAccountSettingsData } from "@/features/settings/account/use-account-settings-data";
import { SettingsPageReveal } from "@/features/settings/components/settings-page-skeleton";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { authClient, signOut } from "@/lib/auth-client";

export function AccountSettingsSection() {
	const navigate = useNavigate();
	const selfHost = useSelfHost();
	const localApp = useLocalDesktopApp();
	const getShellRoutePath = useShellRoutePath();
	const data = useAccountSettingsData();
	const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
	const [isSigningOut, setIsSigningOut] = useState(false);

	const handleLinkProvider = (provider: "google" | "github") => {
		setLinkingProvider(provider);
		authClient.linkSocial({
			provider,
			callbackURL: `${window.location.origin}${getShellRoutePath(appRoutes.settingsAccount())}`,
		});
	};

	const handleSignOut = async () => {
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
	const handleAccountDeleted = async () => {
		try {
			await signOut();
		} catch (error) {
			void error;
		}
		navigate("/");
		toast.success("Account deleted");
	};

	return (
		<SettingsPageReveal routeId="account" loading={data.state.isPending}>
			{() => (
				<div className="workspace-settings-page">
					<ProfileOverviewCard
						name={data.user.name}
						email={data.user.email}
						image={data.user.image}
						isSigningOut={isSigningOut}
						onSignOut={localApp ? undefined : () => void handleSignOut()}
					/>
					{selfHost && !localApp ? <PasswordCard /> : null}
					<AppearanceCard />
					{localApp ? null : (
						<>
							<ProfileLinkedAccountsCard
								isPending={data.state.isPending}
								linkedProviders={data.linkedProviders}
								linkingProvider={linkingProvider}
								onLinkProvider={handleLinkProvider}
							/>
							{data.state.hasData ? (
								<div id="delete-account" className="scroll-mt-24">
									<AccountDangerZoneCard
										user={{ email: data.user.email, name: data.user.name }}
										onDeleted={handleAccountDeleted}
									/>
								</div>
							) : null}
						</>
					)}
				</div>
			)}
		</SettingsPageReveal>
	);
}
