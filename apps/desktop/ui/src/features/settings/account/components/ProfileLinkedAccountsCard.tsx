import { Button } from "@/app/ui/button";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { linkableProviders } from "@/features/self-hosted/surfaces";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";

const providerDefinitions: Array<{ id: "google" | "github"; label: string }> = [
	{ id: "google", label: "Google" },
	{ id: "github", label: "GitHub" },
];

export function ProfileLinkedAccountsCard({
	isPending,
	linkedProviders,
	linkingProvider,
	onLinkProvider,
}: {
	isPending: boolean;
	linkedProviders: Set<string>;
	linkingProvider: string | null;
	onLinkProvider: (provider: "google" | "github") => void;
}) {
	const linkable = new Set(
		linkableProviders(
			useSelfHost(),
			providerDefinitions.map((provider) => provider.id),
		),
	);
	return (
		<WorkspaceSettingsGroup
			title="Linked accounts"
			description="Manage the sign-in methods connected to your account."
		>
			<WorkspaceSettingsRow label="Email & password">
				<span className="settings-status">
					{linkedProviders.has("credential") ? "Connected" : "Not linked"}
				</span>
			</WorkspaceSettingsRow>
			{providerDefinitions
				.filter(
					(provider) =>
						linkable.has(provider.id) || linkedProviders.has(provider.id),
				)
				.map((provider) => (
					<WorkspaceSettingsRow key={provider.id} label={provider.label}>
						{linkedProviders.has(provider.id) ? (
							<span className="settings-status">Connected</span>
						) : (
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={`Link ${provider.label}`}
								onClick={() => onLinkProvider(provider.id)}
								disabled={isPending || linkingProvider !== null}
							>
								{linkingProvider === provider.id ? "Linking…" : "Link"}
							</Button>
						)}
					</WorkspaceSettingsRow>
				))}
		</WorkspaceSettingsGroup>
	);
}
