export const cliSetupCommands = [
	{
		alternateCommand: undefined,
		alternateCommandCaption: undefined,
		advanceLabel: "I installed and logged in",
		command:
			"npm install -g opaline@latest && opaline login --api-base https://opaline.so",
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

export type CliSetupStepId = (typeof cliSetupCommands)[number]["id"];
