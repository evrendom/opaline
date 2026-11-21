export interface SelfHostedWelcomeStatus {
	readonly pending: boolean;
	readonly hasUploadedSessions: boolean;
}

export interface SelfHostedWelcomeCopy {
	readonly title: string;
	readonly body: string;
}

/** Sessions reach Opaline only from the Mac app, which imports them itself. */
export function selfHostedWelcomeCopy(
	status: SelfHostedWelcomeStatus,
	localApp: boolean,
): SelfHostedWelcomeCopy {
	return {
		title: status.pending
			? "Checking your sessions…"
			: status.hasUploadedSessions
				? "Your sessions are arriving"
				: "Waiting for your sessions",
		body: localApp
			? "Opaline imports the Claude Code and Codex sessions on this Mac and shows them here as they arrive. Nothing leaves this Mac."
			: "The Opaline app imports the Claude Code and Codex sessions on its Mac and shows them here as they arrive.",
	};
}
