import { describe, expect, test } from "bun:test";
import {
	readClaudeBackgroundHandOff,
	readTaskNotification,
} from "./background-tasks.js";
import { readClaudeHookError } from "./exit-code.js";
import { splitSessionTranscript } from "./split-transcript.js";

const OUTPUT = "/private/tmp/claude-501/-repo/s1/tasks";

function line(record: Record<string, unknown>): string {
	return JSON.stringify({
		cwd: "/repo",
		isSidechain: false,
		sessionId: "s1",
		version: "2.1.293",
		...record,
	});
}

function call(at: string, id: string, command: string): string {
	return line({
		type: "assistant",
		timestamp: at,
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
		},
	});
}

function result(
	at: string,
	id: string,
	text: string,
	extra: Record<string, unknown> = {},
): string {
	return line({
		type: "user",
		timestamp: at,
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: text,
					is_error: extra.isError === true,
				},
			],
		},
		toolUseResult: extra.toolUseResult ?? { stdout: "", stderr: "" },
	});
}

function prompt(at: string, text: string): string {
	return line({
		type: "user",
		timestamp: at,
		message: { role: "user", content: text },
	});
}

function split(lines: readonly string[]) {
	return [
		...splitSessionTranscript({
			content: `${lines.join("\n")}\n`,
			sessionDate: "2026-10-14T05:00:00.000Z",
			source: "claude_code",
		}),
	];
}

describe("background tasks", () => {
	test("a killed background command's notification carries its call, task and status", () => {
		const rows = split([
			prompt("2026-10-14T05:40:00.000Z", "show me in mail lab"),
			call("2026-10-14T05:41:37.911Z", "toolu_lab", "vite > lab.log 2>&1"),
			result(
				"2026-10-14T05:41:37.990Z",
				"toolu_lab",
				`Command running in background with ID: burijxy65. Output is being written to: ${OUTPUT}/burijxy65.output. You will be notified when it completes.`,
				{ toolUseResult: { backgroundTaskId: "burijxy65" } },
			),
			prompt("2026-10-14T05:50:00.000Z", "now the next thing"),
			prompt(
				"2026-10-14T06:11:00.000Z",
				`<task-notification>\n<task-id>burijxy65</task-id>\n<tool-use-id>toolu_lab</tool-use-id>\n<status>killed</status>\n<summary>Background command "Start the email lab dev server" was stopped after reaching its background time limit</summary>\n</task-notification>`,
			),
		]);
		const handOff = rows.find(
			(row) => row.kind === "tool_result" && row.callId === "toolu_lab",
		);
		expect(handOff?.subtype).toBe("running");
		expect(handOff?.facts.extra.task_id).toBe("burijxy65");
		const notification = rows.find(
			(row) => row.subtype === "task_notification",
		);
		// The notification lands in a later run and still names the call.
		expect(notification?.kind).toBe("injected_context");
		expect(notification?.callId).toBe("toolu_lab");
		expect(notification?.turnIdx).toBe(2);
		expect(handOff?.turnIdx).toBe(1);
		expect(notification?.facts.extra.background_status).toBe("killed");
		// The outcome is in the record's own columns too.
		expect(notification?.isError).toBe(true);
		expect(notification?.facts.interrupted).toBe(true);
		expect(handOff?.filePath).toBe(`${OUTPUT}/burijxy65.output`);
	});

	test("a notification that names no tool use resolves its call through the task id", () => {
		const rows = split([
			prompt("2026-10-14T05:40:00.000Z", "run the tests"),
			call("2026-10-14T05:41:00.000Z", "toolu_tests", "bun test"),
			result(
				"2026-10-14T05:43:00.000Z",
				"toolu_tests",
				`Command did not complete within its 120s timeout and was moved to the background (ID: bslow6789). Output is being written to: ${OUTPUT}/bslow6789.output.`,
			),
			prompt(
				"2026-10-14T05:47:00.000Z",
				`<task-notification>\n<task-id>bslow6789</task-id>\n<status>completed</status>\n<summary>Background command "bun test" completed (exit code 0)</summary>\n</task-notification>`,
			),
		]);
		const notification = rows.find(
			(row) => row.subtype === "task_notification",
		);
		expect(notification?.callId).toBe("toolu_tests");
		expect(notification?.facts.extra.background_exit_code).toBe("0");
		expect(notification?.exitCode).toBe(0);
		expect(notification?.isError).toBe(false);
		expect(notification?.facts.interrupted).toBe(false);
		expect(
			rows.find((row) => row.kind === "tool_result")?.facts.extra
				.background_launch,
		).toBe("timeout");
	});

	test("a notification naming several unresolved tasks names no call", () => {
		const parsed = readTaskNotification(
			"<task-notification>\n<task-id>a60cde8316f63fe3b</task-id>\n<task-id>a8caf38afd9adefbc</task-id>\n<status>stopped</status>\n<summary>2 background agents didn't finish before the previous session ended</summary>\n</task-notification>",
		);
		expect(parsed?.taskIds).toEqual(["a60cde8316f63fe3b", "a8caf38afd9adefbc"]);
		expect(parsed?.toolUseId).toBeUndefined();
		expect(parsed?.status).toBe("stopped");
		const rows = split([
			prompt(
				"2026-10-14T05:40:00.000Z",
				"<task-notification>\n<task-id>a60cde8316f63fe3b</task-id>\n<task-id>a8caf38afd9adefbc</task-id>\n<status>stopped</status>\n</task-notification>",
			),
		]);
		expect(rows[0]?.subtype).toBe("task_notification");
		expect(rows[0]?.callId).toBe("");
	});

	test("command output that mentions a background id is no hand-off", () => {
		expect(
			readClaudeBackgroundHandOff(
				"build ok\nCommand running in background with ID: b1",
				{ stdout: "" },
				"Bash",
			),
		).toBeUndefined();
		expect(
			readClaudeBackgroundHandOff(
				"ok",
				{ isAsync: true, agentId: "a1" },
				"Agent",
			),
		).toEqual({ launch: "agent", taskId: "a1", outputFile: undefined });
		expect(
			readClaudeBackgroundHandOff("ok", { taskId: "bmon1" }, "Monitor"),
		).toEqual({ launch: "monitor", taskId: "bmon1", outputFile: undefined });
	});
});

describe("hook errors", () => {
	test("a PreToolUse hook block is a refusal, not a failed command", () => {
		const rows = split([
			prompt("2026-10-14T06:50:00.000Z", "run the admin tests"),
			call("2026-10-14T06:53:05.608Z", "toolu_vitest", "bunx vitest run"),
			result(
				"2026-10-14T06:53:05.700Z",
				"toolu_vitest",
				"PreToolUse:Bash hook error: [/home/me/.local/bin/package-command-policy]: STOP: This command cannot install or download packages.\n\nUse safe-install.",
				{ isError: true, toolUseResult: "Error: PreToolUse:Bash hook error" },
			),
		]);
		const blocked = rows.find((row) => row.kind === "tool_result");
		expect(blocked?.isError).toBe(true);
		expect(blocked?.exitCode).toBeNull();
		expect(blocked?.facts.denialKind).toBe("hook");
		expect(blocked?.facts.extra.hook_event).toBe("PreToolUse");
		expect(blocked?.facts.extra.denial_reason).toBe(
			"STOP: This command cannot install or download packages.",
		);
	});

	test("a PostToolUse hook error ran after the call and is no refusal", () => {
		expect(
			readClaudeHookError(
				"PostToolUse:Edit hook error: [biome check]: Found 2 errors",
			),
		).toEqual({
			event: "PostToolUse",
			blocked: false,
			command: "biome check",
			message: "Found 2 errors",
		});
		const rows = split([
			prompt("2026-10-14T06:50:00.000Z", "fix it"),
			call("2026-10-14T06:53:00.000Z", "toolu_post", "echo hi"),
			result(
				"2026-10-14T06:53:01.000Z",
				"toolu_post",
				"PostToolUse:Bash hook error: [notify]: exit 1",
				{ isError: true },
			),
		]);
		const row = rows.find((candidate) => candidate.kind === "tool_result");
		expect(row?.facts.denialKind).toBe("");
		expect(row?.facts.extra.hook_event).toBe("PostToolUse");
	});

	test("output that quotes a hook error later in the text is not one", () => {
		expect(
			readClaudeHookError("Exit code 1\nPreToolUse:Bash hook error: [x]: y"),
		).toBeUndefined();
	});
});

describe("forked skill subagents", () => {
	test("a forked skill's opening meta task is its delegation, so its work has runs", () => {
		const content = [
			JSON.stringify({
				type: "user",
				isSidechain: true,
				isMeta: true,
				agentId: "afork1",
				sessionId: "s1",
				timestamp: "2026-10-12T12:00:00.000Z",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "Review target: `origin/main...HEAD high`" },
					],
				},
			}),
			JSON.stringify({
				type: "assistant",
				isSidechain: true,
				agentId: "afork1",
				sessionId: "s1",
				timestamp: "2026-10-12T12:00:05.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_diff",
							name: "Bash",
							input: { command: "git diff" },
						},
					],
				},
			}),
			JSON.stringify({
				type: "user",
				isSidechain: true,
				isMeta: true,
				agentId: "afork1",
				sessionId: "s1",
				timestamp: "2026-10-12T12:00:06.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "later harness note" }],
				},
			}),
		].join("\n");
		const rows = [
			...splitSessionTranscript({
				content: "",
				subagents: { afork1: content },
				sessionDate: "2026-10-12T12:00:00.000Z",
				source: "claude_code",
			}),
		].filter((row) => row.agentId === "afork1");
		expect(rows[0]?.kind).toBe("user_prompt");
		expect(rows[0]?.subtype).toBe("delegation");
		expect(rows.find((row) => row.kind === "tool_call")?.turnIdx).toBe(1);
		// Once the task started a run, later meta stays injected context.
		expect(rows.at(-1)?.kind).toBe("injected_context");
	});
});

describe("coordinator messages", () => {
	test("a coordinator's message that starts a subagent's run is a delegation, not a person's prompt", () => {
		const line = (record: Record<string, unknown>) =>
			JSON.stringify({
				isSidechain: true,
				agentId: "awork1",
				sessionId: "s1",
				...record,
			});
		const content = [
			line({
				type: "user",
				timestamp: "2026-10-13T10:00:00.000Z",
				message: { role: "user", content: "Fix the lint errors." },
			}),
			line({
				type: "assistant",
				timestamp: "2026-10-13T10:00:05.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Done." }],
				},
			}),
			line({
				type: "attachment",
				timestamp: "2026-10-13T10:05:00.000Z",
				attachment: {
					type: "queued_command",
					prompt:
						"The coordinator sent a message while you were working:\nReview results are in; fix batch 2.",
				},
			}),
		].join("\n");
		const prompts = [
			...splitSessionTranscript({
				content: "",
				subagents: { awork1: content },
				sessionDate: "2026-10-13T10:00:00.000Z",
				source: "claude_code",
			}),
		].filter((row) => row.kind === "user_prompt");
		expect(prompts.map((row) => [row.turnIdx, row.subtype])).toEqual([
			[1, "delegation"],
			[2, "delegation"],
		]);
	});
});
