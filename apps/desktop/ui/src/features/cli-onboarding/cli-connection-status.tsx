import type { CliConnectionSnapshot } from "../../../../../../packages/api-routes/src/cli-connection";
import type { CliConnectionTone } from "./cli-connection-state";
import "./cli-connection-status.css";

interface CliConnectionStatusProps {
	snapshot: CliConnectionSnapshot | null;
	tone: CliConnectionTone;
	opening: boolean;
}

export function CliConnectionStatus({
	snapshot,
	tone,
	opening,
}: CliConnectionStatusProps) {
	const selected =
		snapshot?.repositories.filter((repository) => repository.enabled) ?? [];
	const sessions = selected.reduce((sum, repo) => sum + repo.sessionCount, 0);
	return (
		<>
			<strong>
				{tone === "interrupted"
					? snapshot?.state === "cancelled"
						? "Setup cancelled"
						: snapshot?.state === "expired"
							? "Connection expired"
							: "Connection interrupted"
					: opening
						? "Opening your dashboard…"
						: !snapshot
							? "Checking your connection…"
							: snapshot.state === "awaiting_login"
								? "Sign in to upload your sessions"
								: snapshot.state === "ready"
									? "Connected — preparing your upload…"
									: snapshot.state === "uploading"
										? "Uploading your sessions…"
										: snapshot.state === "completed"
											? "Your sessions are ready"
											: "Choose your repositories in the terminal"}
			</strong>
			{selected.length > 0 ? (
				<span>
					{selected.length}{" "}
					{selected.length === 1 ? "repository" : "repositories"}
					{" · "}
					{sessions} {sessions === 1 ? "session" : "sessions"}
				</span>
			) : null}
		</>
	);
}
