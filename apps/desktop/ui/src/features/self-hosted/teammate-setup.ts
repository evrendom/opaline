import {
	CLI_PACKAGE_COMMAND,
	cliLoginCommand,
	MCP_INSTALL_COMMAND,
} from "./cli-commands";

export interface TeammateSetupStep {
	readonly id: "login" | "upload" | "mcp";
	readonly title: string;
	readonly description: string;
	readonly command: string;
}

export function teammateSetupSteps(origin: string): TeammateSetupStep[] {
	return [
		{
			id: "login",
			title: "Sign in from your terminal",
			description: "Approve the request it opens in this browser.",
			command: cliLoginCommand(origin),
		},
		{
			id: "upload",
			title: "Choose repositories to upload",
			description:
				"Past sessions upload now; new ones follow as each session ends.",
			command: `${CLI_PACKAGE_COMMAND} upload`,
		},
		{
			id: "mcp",
			title: "Give your agents the Opaline MCP",
			description: `Registers this server in Claude Code, Codex and Cursor. Without a global install, run ${CLI_PACKAGE_COMMAND} mcp install.`,
			command: MCP_INSTALL_COMMAND,
		},
	];
}

export interface SelfHostedWelcomeStatus {
	readonly pending: boolean;
	readonly hasUploadedSessions: boolean;
	readonly hasCliLogin: boolean;
}

export interface SelfHostedWelcomeCopy {
	readonly title: string;
	readonly body: string;
	readonly forTeammates: boolean;
	readonly steps: TeammateSetupStep[];
}

export function selfHostedWelcomeCopy(
	origin: string,
	status: SelfHostedWelcomeStatus,
	localApp: boolean,
): SelfHostedWelcomeCopy {
	if (localApp)
		return {
			title: status.pending
				? "Checking your sessions…"
				: status.hasUploadedSessions
					? "Your sessions are arriving"
					: "Waiting for your sessions",
			body: "Opaline imports the Claude Code and Codex sessions on this Mac and shows them here as they arrive. Nothing leaves this Mac.",
			forTeammates: false,
			steps: [],
		};
	const connected = status.hasUploadedSessions || status.hasCliLogin;
	return {
		title: status.pending
			? "Checking your setup…"
			: status.hasUploadedSessions
				? "Your sessions are arriving"
				: connected
					? "Your terminal is connected"
					: "Connect your terminal",
		body: connected
			? "Sessions upload from this computer as each one ends. Teammates set up their own computers with these commands."
			: "Run these on each computer whose coding sessions you want in Opaline.",
		forTeammates: connected,
		steps: teammateSetupSteps(origin),
	};
}
