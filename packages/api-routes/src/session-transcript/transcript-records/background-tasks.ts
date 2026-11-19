/**
 * Claude Code background tasks. A Bash call run in the background or moved
 * there by its timeout, an async Agent and a Monitor return a hand-off result
 * at once and report their end (and Monitor events) later in a
 * `<task-notification>`, which can arrive in a later run. The notification
 * names the task and usually the tool use that started it; when it does not,
 * the task id the hand-off announced links it back.
 */

import { readString } from "./line-items.js";

/** How a call's work left the foreground. */
export type BackgroundLaunch = "requested" | "timeout" | "agent" | "monitor";

export interface BackgroundHandOff {
	readonly launch: BackgroundLaunch;
	readonly taskId: string;
	/** The file the task writes its output to, when the result names it. */
	readonly outputFile: string | undefined;
	/**
	 * For a timeout hand-off, the limit its text names (`within its 600s
	 * timeout`) in milliseconds; undefined when the text names it otherwise.
	 */
	readonly timeoutMs?: number;
}

export interface TaskNotification {
	/** Every `<task-id>` it names (a stopped batch names several). */
	readonly taskIds: readonly string[];
	readonly toolUseId: string | undefined;
	/** `<status>` as written: completed, failed, killed, stopped. */
	readonly status: string | undefined;
	/** The exit code its summary reports (`… (exit code 1)`). */
	readonly exitCode: number | null;
	/** A Monitor event (`<event>`), which reports progress, not an end. */
	readonly event: boolean;
	readonly outputFile: string | undefined;
}

const TASK_ID = "[A-Za-z0-9_-]{1,64}";
const REQUESTED_PATTERN = new RegExp(
	`^\\s*Command running in background with ID: (${TASK_ID})`,
	"u",
);
const TIMEOUT_PATTERN = new RegExp(
	`^\\s*Command did not complete within its [^\\n]{0,40}? timeout and was moved to the background \\(ID: (${TASK_ID})\\)`,
	"u",
);
/** The limit a timeout hand-off names, in whole seconds as Claude Code writes it (`within its 600s timeout`). */
const TIMEOUT_SECONDS_PATTERN = /within its (\d{1,7})s timeout/u;
const NOTIFICATION_PATTERN =
	/<task-notification>([\s\S]*?)<\/task-notification>/u;
const SUMMARY_EXIT_PATTERN = /\(exit code (-?\d{1,10})\)/u;
const OUTPUT_FILE_PATTERN =
	/Output is being written to: (\/[^\s]{1,1000}?\/tasks\/[A-Za-z0-9_-]{1,64}\.output)\b/u;

/**
 * The background hand-off a Claude Code tool result reports, or undefined
 * when the call ran in the foreground. Read from the start of the result text
 * and the result's own task fields, never from the command's output.
 */
export function readClaudeBackgroundHandOff(
	resultText: string,
	toolUseResult: Record<string, unknown> | undefined,
	toolName: string,
): BackgroundHandOff | undefined {
	const head = resultText.slice(0, 256);
	const outputFile =
		OUTPUT_FILE_PATTERN.exec(resultText.slice(0, 2_048))?.[1] ??
		readString(toolUseResult?.outputFile);
	const handOff = (launch: BackgroundLaunch, taskId: string | undefined) =>
		taskId === undefined ? undefined : { launch, taskId, outputFile };
	const timeout = TIMEOUT_PATTERN.exec(head);
	const timedOut = timeout?.[1];
	if (timedOut !== undefined) {
		const seconds = TIMEOUT_SECONDS_PATTERN.exec(timeout?.[0] ?? "")?.[1];
		const timeoutMs =
			seconds === undefined ? undefined : Number(seconds) * 1_000;
		const found = handOff("timeout", timedOut);
		return found === undefined ||
			timeoutMs === undefined ||
			!Number.isSafeInteger(timeoutMs) ||
			timeoutMs > 0xffff_ffff
			? found
			: { ...found, timeoutMs };
	}
	const requested =
		REQUESTED_PATTERN.exec(head)?.[1] ??
		readTaskId(toolUseResult?.backgroundTaskId);
	if (requested !== undefined) return handOff("requested", requested);
	const lowered = toolName.toLowerCase();
	if (lowered === "monitor")
		return handOff("monitor", readTaskId(toolUseResult?.taskId));
	if (
		(lowered === "agent" || lowered === "task") &&
		toolUseResult?.isAsync === true
	)
		return handOff("agent", readTaskId(toolUseResult.agentId));
	return undefined;
}

/** The `<task-notification>` a user-role text carries, or undefined. */
export function readTaskNotification(
	text: string,
): TaskNotification | undefined {
	if (!text.includes("<task-notification>")) return undefined;
	const body = NOTIFICATION_PATTERN.exec(text)?.[1];
	if (body === undefined) return undefined;
	const taskIds = elements(body, "task-id").filter((id) =>
		new RegExp(`^${TASK_ID}$`, "u").test(id),
	);
	const summary = elements(body, "summary")[0] ?? "";
	const code = SUMMARY_EXIT_PATTERN.exec(summary)?.[1];
	const exitCode = code === undefined ? null : Number(code);
	return {
		taskIds,
		toolUseId: elements(body, "tool-use-id")[0],
		status: elements(body, "status")[0]?.toLowerCase(),
		exitCode:
			exitCode !== null && Number.isSafeInteger(exitCode) ? exitCode : null,
		event: elements(body, "event").length > 0,
		outputFile: elements(body, "output-file")[0],
	};
}

function elements(body: string, name: string): string[] {
	const values: string[] = [];
	const pattern = new RegExp(`<${name}>([^<]{0,512})</${name}>`, "gu");
	for (const match of body.matchAll(pattern)) {
		const value = match[1]?.trim();
		if (value) values.push(value);
	}
	return values;
}

function readTaskId(value: unknown): string | undefined {
	const id = readString(value);
	return id !== undefined && new RegExp(`^${TASK_ID}$`, "u").test(id)
		? id
		: undefined;
}
