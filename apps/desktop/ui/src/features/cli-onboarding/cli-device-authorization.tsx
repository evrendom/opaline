import { Fragment, useState } from "react";
import { submitCliDeviceDecision } from "./cli-onboarding-auth";
import { WelcomeProgress } from "./welcome-panel";

type DeviceAuthorizationStatus = "pending" | "approved" | "denied";
type DeviceDecision = "approve" | "deny";

export function CliDeviceAuthorization({ userCode }: { userCode: string }) {
	const normalizedCode = userCode.replaceAll("-", "");
	const codeCells = Array.from(normalizedCode).map((character, index) => ({
		character,
		id: normalizedCode.slice(0, index + 1),
	}));
	const separatorIndex = Math.ceil(codeCells.length / 2);
	const [status, setStatus] = useState<DeviceAuthorizationStatus>("pending");
	const [processingAction, setProcessingAction] =
		useState<DeviceDecision | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function submit(action: DeviceDecision) {
		if (processingAction) return;
		setProcessingAction(action);
		setError(null);
		try {
			await submitCliDeviceDecision(userCode, action);
			setStatus(action === "approve" ? "approved" : "denied");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not process this CLI login. Please try again.",
			);
		} finally {
			setProcessingAction(null);
		}
	}

	if (status === "approved") {
		return (
			<div className="cli-welcome-step-content" data-device-status="approved">
				<WelcomeProgress step={1} />
				<h2>Terminal connected</h2>
				<p>
					You can return to your terminal to finish choosing your workspace.
				</p>
			</div>
		);
	}

	if (status === "denied") {
		return (
			<div className="cli-welcome-step-content" data-device-status="denied">
				<WelcomeProgress step={1} />
				<h2>Request denied</h2>
				<p>This terminal was not authorized. You can close this page.</p>
			</div>
		);
	}

	return (
		<div className="cli-welcome-step-content" data-device-status="pending">
			<WelcomeProgress step={1} />
			<h2>Connect your terminal</h2>
			<p>
				Approve this request only if you started it with Opaline in your
				terminal.
			</p>
			<div className="cli-device-code">
				<span className="sr-only">CLI code {userCode}</span>
				<div className="cli-device-code-value" aria-hidden="true">
					{codeCells.map(({ character, id }, index) => (
						<Fragment key={id}>
							{index === separatorIndex ? (
								<span className="cli-device-code-separator" aria-hidden="true">
									–
								</span>
							) : null}
							<span className="cli-device-code-character" aria-hidden="true">
								{character}
							</span>
						</Fragment>
					))}
				</div>
			</div>
			{error ? (
				<p className="cli-onboarding-error" role="alert">
					{error}
				</p>
			) : null}
			<div className="cli-welcome-actions">
				<button
					className="cli-onboarding-text-button"
					type="button"
					disabled={processingAction !== null}
					onClick={() => void submit("deny")}
				>
					{processingAction === "deny" ? "Denying…" : "Deny request"}
				</button>
				<button
					className="cli-onboarding-primary"
					type="button"
					disabled={processingAction !== null}
					onClick={() => void submit("approve")}
				>
					{processingAction === "approve"
						? "Connecting…"
						: "Approve and continue"}
				</button>
			</div>
		</div>
	);
}
