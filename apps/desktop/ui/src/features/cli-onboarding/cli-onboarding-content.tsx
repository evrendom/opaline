import { createPortal } from "react-dom";
import { useDesktop } from "@/features/desktop/desktop-bridge";
import { DesktopRepositoryPicker } from "@/features/desktop/desktop-repository-picker";
import { useShellOnboardingPanel } from "@/features/shell/shell-onboarding-panel";
import type { CliConnectionSnapshot } from "../../../../../../packages/api-routes/src/cli-connection";
import type { CliAuthorization } from "./cli-authorization";
import { CliSignIn } from "./cli-sign-in";
import { WelcomeCommandButton } from "./welcome-command-button";
import { WelcomePanel, WelcomeProgress } from "./welcome-panel";
import { WelcomeSessionPreview } from "./welcome-session-preview";
import "./cli-onboarding.css";
import "./welcome.css";

export function CliOnboardingContent({
	snapshot,
	authorization,
	invitedWorkspaceId,
	deviceUserCode,
	connectionError,
	displayCommand,
	onCopy,
	onPrepareCode,
	onFinish,
}: {
	snapshot: CliConnectionSnapshot | null;
	authorization: CliAuthorization | null;
	invitedWorkspaceId: string | null;
	deviceUserCode: string | null;
	connectionError: string | null;
	displayCommand: string;
	onCopy: () => Promise<boolean>;
	onPrepareCode: () => Promise<string | null>;
	onFinish: () => void;
}) {
	const panel = useShellOnboardingPanel();
	const desktop = useDesktop();
	const stopped =
		snapshot && ["failed", "cancelled", "expired"].includes(snapshot.state);
	const needsReconnect = Boolean(connectionError || stopped);
	const hasDeviceAuthorization = deviceUserCode !== null;
	return (
		<>
			{panel &&
				createPortal(
					<WelcomePanel>
						{hasDeviceAuthorization ? (
							<CliSignIn mode="device" userCode={deviceUserCode} />
						) : !needsReconnect && snapshot && authorization ? (
							<CliSignIn
								mode="paired"
								snapshot={snapshot}
								authorization={authorization}
								invitedWorkspaceId={invitedWorkspaceId}
								onFinish={onFinish}
							/>
						) : (
							<>
								<WelcomeProgress step={1} />
								<h1>
									{needsReconnect
										? "Connection timeout"
										: snapshot?.state === "awaiting_login"
											? "Continue to sign in"
											: "Ready for your sessions"}
								</h1>
								<p>
									{desktop
										? needsReconnect
											? "Choose your repositories again to reconnect this Mac."
											: "Choose which repositories on this Mac sync with Opaline."
										: needsReconnect
											? "Copy and run the command again to reconnect your terminal."
											: !snapshot
												? "Checking your connection…"
												: snapshot.state === "awaiting_login"
													? "Open the sign-in link from your terminal to continue here."
													: "Copy and run the command, then choose your repositories in the terminal."}
								</p>
								{desktop ? (
									<DesktopRepositoryPicker
										bridge={desktop}
										mode="setup"
										getCode={onPrepareCode}
									/>
								) : needsReconnect || snapshot?.state !== "awaiting_login" ? (
									<WelcomeCommandButton
										displayCommand={displayCommand}
										onCopy={onCopy}
									/>
								) : null}
							</>
						)}
					</WelcomePanel>,
					panel,
				)}
			<WelcomeSessionPreview
				snapshot={hasDeviceAuthorization || needsReconnect ? null : snapshot}
			/>
		</>
	);
}
