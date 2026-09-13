import { Button } from "@/app/ui/button";
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
	return (
		<WorkspaceSettingsGroup
			title="Linked accounts"
			description="Manage the sign-in methods connected to your account."
		>
			<WorkspaceSettingsRow label="Email & password">
				<span className="workspace-settings-status">
					{linkedProviders.has("credential") ? "Connected" : "Not linked"}
				</span>
			</WorkspaceSettingsRow>
			{providerDefinitions.map((provider) => (
				<WorkspaceSettingsRow key={provider.id} label={provider.label}>
					{linkedProviders.has(provider.id) ? (
						<span className="workspace-settings-status">Connected</span>
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
