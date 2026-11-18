import { cliInstallAndLoginCommand } from "@/features/self-hosted/cli-commands";

export function getCliSetupCommands(origin: string) {
	return [
		{
			alternateCommand: undefined,
			alternateCommandCaption: undefined,
			advanceLabel: "I installed and logged in",
			command: cliInstallAndLoginCommand(origin),
			commandCaption: "Install globally + log in on this machine",
			description: undefined,
			id: "install-and-login",
			title: "Set up Opaline in your terminal",
		},
		{
			advanceLabel: "I enabled auto-upload",
			alternateCommand: "opaline upload /path/to/session.jsonl",
			alternateCommandCaption:
				"Upload one session without enabling automatic uploads",
			command: "opaline upload",
			commandCaption:
				"Run from any directory; choose repositories to upload past sessions and enable automatic uploads",
			description: undefined,
			id: "enable-auto-upload",
			title: "Upload sessions",
		},
	] as const;
}

export type CliSetupStepId = ReturnType<
	typeof getCliSetupCommands
>[number]["id"];
