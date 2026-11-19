import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import {
	GITHUB_CALLBACK_MESSAGES,
	type readGitHubCallbackResult,
} from "@/features/settings/workspace/components/WorkspaceGitHubConnection";

/** The step is offered only to workspace admins on a deployment with GitHub. */
export function isGitHubOnboardingAvailable(
	status: GitHubRepositoryEvidenceStatus | undefined,
): boolean {
	return (
		status?.visibility === "visible" &&
		status.connection.canManage &&
		status.connection.configured
	);
}

export function WelcomeGitHubStep({
	status,
	result,
	connected,
	busy,
	error,
	onConnect,
	onSkip,
	onContinue,
}: {
	status: GitHubRepositoryEvidenceStatus | undefined;
	result: ReturnType<typeof readGitHubCallbackResult>;
	connected: boolean;
	busy: boolean;
	error: string | null;
	onConnect: () => void;
	onSkip: () => void;
	onContinue: () => void;
}) {
	const isConnected =
		connected ||
		result === "connected" ||
		(status?.visibility === "visible" && status.connection.connected);
	const resultMessage =
		result && result !== "connected"
			? GITHUB_CALLBACK_MESSAGES[result].message
			: null;
	return (
		<div
			className="cli-welcome-fields"
			data-github-step={isConnected ? "done" : "pending"}
		>
			<p className="cli-welcome-upload-note">
				Read-only. Files are read only when you open them, never stored.
			</p>
			{isConnected ? <output>GitHub is connected.</output> : null}
			{resultMessage ? (
				<p className="cli-onboarding-error" role="alert">
					{resultMessage}
				</p>
			) : null}
			{error ? (
				<p className="cli-onboarding-error" role="alert">
					{error}
				</p>
			) : null}
			<div className="cli-welcome-actions">
				{isConnected ? null : (
					<button
						type="button"
						className="cli-onboarding-text-button"
						disabled={busy}
						onClick={onSkip}
					>
						Skip for now
					</button>
				)}
				<button
					type="button"
					className="cli-onboarding-primary"
					disabled={busy}
					onClick={isConnected ? onContinue : onConnect}
				>
					{isConnected
						? "Continue"
						: busy
							? "Opening GitHub…"
							: "Connect GitHub"}
				</button>
			</div>
		</div>
	);
}
