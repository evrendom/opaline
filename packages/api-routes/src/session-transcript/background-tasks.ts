// Calls that finish in the background. Claude Code moves a Bash call that
// outlives its timeout to the background, or starts one there when asked
// (`run_in_background`, background agents); the call's result is then only a
// hand-off, and how the work really ended comes later as a
// `<task-notification>` naming the call by its tool use id. Its output stays
// in a file on the member's machine, not in the transcript.

export const BACKGROUND_RESULT_MAX_CHARS = 20_000;

export type BackgroundHandOff = {
	taskId: string;
	timedOut: boolean;
};

export type TaskNotification = {
	taskId: string;
	toolUseId: string | null;
	status: string | null;
	summary: string | null;
	exitCode: number | null;
	result: string | null;
};

const HANDS_OFF = new Set(["Bash", "PowerShell"]);

export function parseBackgroundHandOff(
	toolName: string | undefined,
	text: string,
): BackgroundHandOff | null {
	if (!toolName || !HANDS_OFF.has(toolName)) return null;
	const moved =
		/did not complete within its \d+\s*m?s timeout and was moved to the background \(ID: ([\w-]+)\)/u.exec(
			text,
		);
	if (moved?.[1]) return { taskId: moved[1], timedOut: true };
	const started = /^Command running in background with ID: ([\w-]+)/mu.exec(
		text,
	);
	if (started?.[1]) return { taskId: started[1], timedOut: false };
	return null;
}

/** The subagent a launch's result text names (`agentId: …`), for a launch
 * whose record leaves out `toolUseResult`: Claude Code writes none for one a
 * subagent makes. Read from the text's end, where it's written, so an id the
 * subagent's own report mentions isn't taken for its own. */
export function launchedAgentIdInText(text: string): string | undefined {
	return /\bagentId:\s*([A-Za-z0-9_-]+)/u.exec(text.slice(-2_048))?.[1];
}

function tag(text: string, name: string): string | null {
	const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(text);
	const value = match?.[1]?.trim();
	return value ? value : null;
}

export function parseTaskNotification(text: string): TaskNotification | null {
	if (!/^\s*<task-notification(?:\s|>)/iu.test(text)) return null;
	const taskId = tag(text, "task-id");
	if (!taskId) return null;
	const summary = tag(text, "summary");
	const exitCode = summary
		? /\(exit code (-?\d+)\)/u.exec(summary)?.[1]
		: undefined;
	const result = tag(text, "result");
	return {
		exitCode: exitCode === undefined ? null : Number(exitCode),
		result: result ? result.slice(0, BACKGROUND_RESULT_MAX_CHARS) : null,
		status: tag(text, "status")?.slice(0, 64) ?? null,
		summary: summary ? summary.slice(0, 1_000) : null,
		taskId: taskId.slice(0, 200),
		toolUseId: tag(text, "tool-use-id"),
	};
}
