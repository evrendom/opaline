export const cliSetupCommands = [
	{
		alternateCommand: undefined,
		alternateCommandCaption: undefined,
		advanceLabel: "I installed and logged in",
		command: "npm install -g @opalinehq/cli && opaline login",
		commandCaption: "Install globally + log in on this machine",
		description: undefined,
		id: "install-and-login",
		title: "Set up Opaline in your terminal",
	},
	{
		advanceLabel: "I enabled auto-upload",
		alternateCommand: "opaline upload",
		alternateCommandCaption:
			"Manually select sessions in a given repo with no auto upload in the future",
		command: "opaline enable",
		commandCaption: "Auto upload + upload historical sessions in a given repo",
		description: undefined,
		id: "enable-auto-upload",
		title: "Upload sessions",
	},
] as const;

export type CliSetupStepId = (typeof cliSetupCommands)[number]["id"];
