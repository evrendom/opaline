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
