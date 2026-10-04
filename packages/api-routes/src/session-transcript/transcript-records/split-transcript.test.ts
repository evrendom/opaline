import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import {
	createSplitStats,
	decodeTranscriptLine,
	splitSessionTranscript,
	splitTranscript,
} from "./split-transcript.js";
import {
	TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS,
	type TranscriptRecordDraft,
} from "./types.js";

const SESSION_DATE = "2026-08-01T10:00:00.000Z";
const SCREENSHOT_SHA256 =
	"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SCREENSHOT_MARKER = `opaline-image-omitted:v1;sha256=${SCREENSHOT_SHA256};bytes=87119;type=image/png`;
const SCREENSHOT_LABEL = "[screenshot image/png 85.1 KB sha256:0123456789ab]";

const fixtureUrl = (name: string) =>
	new URL(`../__fixtures__/${name}`, import.meta.url);

async function readFixture(name: string) {
	return Bun.file(fixtureUrl(name)).text();
}

function claudeRows(
	lines: readonly unknown[],
	options: { agentId?: string; textMaxChars?: number } = {},
) {
	return [
		...splitTranscript({
			agentId: options.agentId,
			content: lines.map(jsonLine).join("\n"),
			fallbackTs: SESSION_DATE,
			source: "claude_code",
			textMaxChars: options.textMaxChars,
		}),
	];
}

function codexRows(content: string) {
	return [
		...splitTranscript({
			content,
			fallbackTs: SESSION_DATE,
			source: "codex",
		}),
	];
}

function jsonLine(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function claudeUser(content: unknown, extra: Record<string, unknown> = {}) {
	return {
		message: { content, role: "user" },
		timestamp: "2026-08-01T10:00:01.000Z",
		type: "user",
		...extra,
	};
}

function claudeAssistant(
	content: unknown[],
	timestamp = "2026-08-01T10:00:02.000Z",
) {
	return {
		message: { content, role: "assistant" },
		timestamp,
		type: "assistant",
	};
}

function ofKind(rows: readonly TranscriptRecordDraft[], kind: string) {
	return rows.filter((row) => row.kind === kind);
}

describe("Claude Code records", () => {
	test("turns start only at genuine human prompts", () => {
		const rows = claudeRows([
			claudeUser(
				"<system_instruction>\nYou are working inside Conductor.\n</system_instruction>",
			),
			claudeUser(
				"<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\nfix the login bug",
			),
			claudeAssistant([{ text: "Looking.", type: "text" }]),
			claudeUser("<system-reminder>todo list changed</system-reminder>"),
			claudeUser("<command-name>/clear</command-name>"),
			claudeUser("<local-command-stdout>ok</local-command-stdout>"),
			claudeUser("injected by tooling", { isMeta: true }),
			claudeUser("[Request interrupted by user]"),
			claudeUser("summary of earlier work", { isCompactSummary: true }),
			claudeUser(
				"<task-notification>\n<task-id>b1</task-id>\n<summary>done</summary>\n</task-notification>",
			),
			claudeAssistant([{ text: "Done.", type: "text" }]),
			claudeUser([{ text: "now add a test", type: "text" }]),
		]);

		const prompts = ofKind(rows, "user_prompt");
		expect(
			prompts.map((row) => [row.recordIdx, row.turnIdx, row.text]),
		).toEqual([
			[2, 1, "fix the login bug"],
			[12, 2, "now add a test"],
		]);
		expect(
			ofKind(rows, "injected_context").map((row) => [
				row.recordIdx,
				row.subtype,
			]),
		).toEqual([
			[1, "system_instruction"],
			// The instructions that came with the prompt stay readable after it.
			[2, "system_instruction"],
			[4, "system_reminder"],
			[5, "slash_command"],
			[6, "local_command"],
			[7, "meta"],
			[10, "task_notification"],
		]);
		expect(ofKind(rows, "compaction").map((row) => row.recordIdx)).toEqual([9]);
		expect(
			rows.filter((row) => row.subtype === "interrupt").map((row) => row.kind),
		).toEqual(["meta"]);
		const promptWithInstructions = rows.filter((row) => row.recordIdx === 2);
		expect(
			promptWithInstructions.map((row) => [row.blockIdx, row.kind, row.text]),
		).toEqual([
			[0, "user_prompt", "fix the login bug"],
			[
				1,
				"injected_context",
				"<system_instruction>\nYou are working inside Conductor.\n</system_instruction>",
			],
		]);
		// Injected context and compaction summaries keep their text, not just a head.
		expect(ofKind(rows, "compaction")[0]?.text).toBe("summary of earlier work");
		expect(rows.find((row) => row.subtype === "system_reminder")?.text).toBe(
			"<system-reminder>todo list changed</system-reminder>",
		);
	});

	test("records before the first prompt belong to turn zero and prompts without a reply share a turn", () => {
		const rows = claudeRows([
			claudeAssistant([{ text: "hello", type: "text" }]),
			claudeUser("first"),
			claudeUser("second, sent before any reply"),
			claudeAssistant([{ text: "ok", type: "text" }]),
			claudeUser("third"),
		]);

		expect(rows.map((row) => [row.kind, row.turnIdx])).toEqual([
			["assistant_text", 0],
			["user_prompt", 1],
			["user_prompt", 1],
			["assistant_text", 1],
			["user_prompt", 2],
		]);
	});

	test("pairs tool results with calls and reads Claude error exit codes", () => {
		const rows = claudeRows([
			claudeUser("run the checks"),
			claudeAssistant([
				{
					id: "toolu_test",
					input: { command: "bun run test:integration" },
					name: "Bash",
					type: "tool_use",
				},
				{
					id: "toolu_git",
					input: { command: "git status" },
					name: "Bash",
					type: "tool_use",
				},
			]),
			claudeUser([
				{
					content: "Exit code 1\n3 tests failed",
					is_error: true,
					tool_use_id: "toolu_test",
					type: "tool_result",
				},
				{
					content: [{ text: "clean", type: "text" }],
					tool_use_id: "toolu_git",
					type: "tool_result",
				},
			]),
		]);

		const calls = ofKind(rows, "tool_call");
		expect(
			calls.map((row) => [row.toolName, row.commandClass, row.callId]),
		).toEqual([
			["Bash", "test", "toolu_test"],
			["Bash", "git", "toolu_git"],
		]);
		expect(calls.map((row) => row.blockIdx)).toEqual([0, 1]);
		const results = ofKind(rows, "tool_result");
		expect(
			results.map((row) => [
				row.callId,
				row.toolName,
				row.commandClass,
				row.isError,
				row.exitCode,
			]),
		).toEqual([
			["toolu_test", "Bash", "test", true, 1],
			["toolu_git", "Bash", "git", false, null],
		]);
		expect(results[1]?.text).toBe("clean");
		// Results are not prompts, so the turn is unchanged.
		expect(
			rows.every((row) => row.turnIdx === 1 || row.kind === "user_prompt"),
		).toBe(true);
	});

	test("conditional and index-only shell commands are inferred, not working-tree changes", () => {
		const rows = claudeRows([
			claudeUser("tidy up"),
			claudeAssistant([
				{
					id: "b1",
					input: { command: "true || rm src/keep.ts" },
					name: "Bash",
					type: "tool_use",
				},
				{
					id: "b2",
					input: { command: "git rm --cached src/tracked.ts" },
					name: "Bash",
					type: "tool_use",
				},
				{
					id: "b3",
					input: { command: "git add src/a.ts && rm src/real.ts" },
					name: "Bash",
					type: "tool_use",
				},
			]),
		]);

		expect(
			ofKind(rows, "file_change").map((row) => [
				row.fileOp,
				row.filePath,
				row.subtype,
				row.callId,
			]),
		).toEqual([
			["inferred_delete", "src/keep.ts", "shell_conditional", "b1"],
			["inferred_delete", "src/tracked.ts", "shell_index", "b2"],
			["delete", "src/real.ts", "shell", "b3"],
		]);
	});

	test.each([
		"function unused { :; rm src/keep.ts; }; echo ok",
		"time if false; then :; rm src/keep.ts; fi",
	])("successful unexecuted shell bodies never become definitive file changes: %s", (command) => {
		const rows = claudeRows([
			claudeUser("leave the file alone"),
			claudeAssistant([
				{ id: "unused", input: { command }, name: "Bash", type: "tool_use" },
			]),
			{
				type: "user",
				timestamp: SESSION_DATE,
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "unused",
							content: "ok\nExit code: 0",
						},
					],
				},
			},
		]);
		expect(
			ofKind(rows, "file_change").map((row) => [
				row.fileOp,
				row.filePath,
				row.subtype,
			]),
		).toEqual([["inferred_delete", "src/keep.ts", "shell_conditional"]]);
	});

	test("native edits and shell commands yield file changes", () => {
		const rows = claudeRows([
			claudeUser("edit things"),
			claudeAssistant([
				{
					id: "e1",
					input: { file_path: "src/a.ts", new_string: "b", old_string: "a" },
					name: "Edit",
					type: "tool_use",
				},
				{
					id: "w1",
					input: { content: "hello", file_path: "src/new.ts" },
					name: "Write",
					type: "tool_use",
				},
				{
					id: "r1",
					input: { file_path: "src/read.ts" },
					name: "Read",
					type: "tool_use",
				},
				{
					id: "b1",
					input: {
						command:
							"sed -i '' 's/a/b/' src/c.ts && mv src/old.ts src/moved.ts && echo hi > notes.txt && rm src/gone.ts",
					},
					name: "Bash",
					type: "tool_use",
				},
			]),
		]);

		const changes = ofKind(rows, "file_change").map((row) => [
			row.fileOp,
			row.filePath,
			row.subtype,
			row.callId,
		]);
		expect(changes).toEqual([
			["edit", "src/a.ts", "native", "e1"],
			["write", "src/new.ts", "native", "w1"],
			["edit", "src/c.ts", "shell", "b1"],
			["delete", "src/old.ts", "shell", "b1"],
			["write", "src/moved.ts", "shell", "b1"],
			["write", "notes.txt", "shell", "b1"],
			["delete", "src/gone.ts", "shell", "b1"],
		]);
		const editChange = ofKind(rows, "file_change")[0];
		expect(JSON.parse(editChange?.text ?? "")).toEqual({
			file_path: "src/a.ts",
			new_string: "b",
			old_string: "a",
		});
		const reads = ofKind(rows, "tool_call").filter(
			(row) => row.fileOp === "read",
		);
		expect(reads.map((row) => row.filePath)).toEqual(["src/read.ts"]);
	});

	test("subagent launches surface the spawned agent id on the result", () => {
		const rows = claudeRows([
			claudeUser("delegate it"),
			claudeAssistant([
				{
					id: "task1",
					input: { description: "explore", prompt: "look around" },
					name: "Task",
					type: "tool_use",
				},
			]),
			claudeUser(
				[
					{
						content: [{ text: "done", type: "text" }],
						tool_use_id: "task1",
						type: "tool_result",
					},
				],
				{ toolUseResult: { agentId: "a1b2c3", status: "completed" } },
			),
		]);

		expect(ofKind(rows, "tool_result")[0]?.spawnedAgentId).toBe("a1b2c3");
	});

	test("bookkeeping, system, and malformed lines keep their place without text", () => {
		const rows = claudeRows([
			{ operation: "enqueue", type: "queue-operation" },
			{ subtype: "compact_boundary", type: "system" },
			{ subtype: "turn_duration", type: "system" },
			"{not json",
			{ type: "attachment" },
		]);

		expect(rows.map((row) => [row.recordIdx, row.kind, row.subtype])).toEqual([
			[1, "meta", "queue-operation"],
			[2, "compaction", "compact_boundary"],
			[3, "meta", "system:turn_duration"],
			[4, "meta", "unparseable"],
			[5, "meta", "attachment"],
		]);
	});

	test("an image-only message is a prompt and records carry forward timestamps", () => {
		const rows = claudeRows([
			claudeUser([{ source: {}, type: "image" }]),
			{ message: { content: "no timestamp", role: "user" }, type: "user" },
		]);

		expect(rows[0]?.text).toBe("[image attachment]");
		expect(rows[0]?.ts).toBe("2026-08-01T10:00:01.000Z");
		expect(rows[1]?.ts).toBe("2026-08-01T10:00:01.000Z");
	});

	test("marked screenshots keep their type, size and hash in prompts and tool results", () => {
		const rows = claudeRows([
			claudeUser([
				{
					source: {
						data: SCREENSHOT_MARKER,
						media_type: "image/png",
						type: "base64",
					},
					type: "image",
				},
			]),
			claudeAssistant([
				{ id: "toolu_shot", input: {}, name: "screenshot", type: "tool_use" },
			]),
			claudeUser([
				{
					content: [
						{ text: "captured", type: "text" },
						{
							source: {
								data: SCREENSHOT_MARKER,
								media_type: "image/png",
								type: "base64",
							},
							type: "image",
						},
						{ source: {}, type: "image" },
					],
					tool_use_id: "toolu_shot",
					type: "tool_result",
				},
			]),
		]);

		expect(ofKind(rows, "user_prompt")[0]?.text).toBe(SCREENSHOT_LABEL);
		expect(ofKind(rows, "tool_result")[0]?.text).toBe(
			`captured\n${SCREENSHOT_LABEL}\n[image]`,
		);
	});

	test("byte ranges are exact for multi-byte text and blank lines", () => {
		const lines = [
			jsonLine(claudeUser("héllo wörld 日本語 🚀")),
			"",
			jsonLine(claudeAssistant([{ text: "ответ", type: "text" }])),
			jsonLine({ type: "queue-operation" }),
		];
		const content = `${lines.join("\n")}\n`;
		const rows = [
			...splitTranscript({
				content,
				fallbackTs: SESSION_DATE,
				source: "claude_code",
			}),
		];
		const bytes = Buffer.from(content, "utf8");

		expect(rows.map((row) => row.recordIdx)).toEqual([1, 3, 4]);
		for (const row of rows) {
			const raw = bytes
				.subarray(row.byteStart, row.byteStart + row.byteLen)
				.toString("utf8");
			expect(lines[row.recordIdx - 1]).toBe(raw);
		}
	});

	test("a BOM on the first line is counted in offsets but does not break parsing", () => {
		const first = `﻿${jsonLine(claudeUser("hello"))}`;
		const second = jsonLine(claudeAssistant([{ text: "hi", type: "text" }]));
		const rows = [
			...splitTranscript({
				content: `${first}\n${second}`,
				fallbackTs: SESSION_DATE,
				source: "claude_code",
			}),
		];

		expect(rows[0]?.kind).toBe("user_prompt");
		expect(rows[0]?.byteLen).toBe(Buffer.byteLength(first, "utf8"));
		expect(rows[1]?.byteStart).toBe(Buffer.byteLength(first, "utf8") + 1);
	});
});

describe("huge records", () => {
	test("text is capped while excerpts, char counts, and byte ranges stay exact", () => {
		const body = `${"x".repeat(3_000)}MIDDLE${"y".repeat(3_000)}`;
		const lines = [
			jsonLine(claudeUser("go")),
			jsonLine(
				claudeUser([
					{ content: body, tool_use_id: "missing", type: "tool_result" },
				]),
			),
		];
		const rows = claudeRows(lines, { textMaxChars: 100 });

		const result = ofKind(rows, "tool_result")[0];
		expect(result?.textChars).toBe(body.length);
		expect(result?.text).toBe(body.slice(0, 100));
		expect(result?.head).toBe(body.slice(0, 1_024));
		expect(result?.tail).toBe(body.slice(-1_024));
		expect(result?.subtype).toBe("orphan");
		expect(result?.byteLen).toBe(Buffer.byteLength(lines[1] ?? "", "utf8"));
	});

	test("short records have an empty tail and no duplicated excerpt", () => {
		const rows = claudeRows([claudeUser("short prompt")]);

		expect(rows[0]?.head).toBe("short prompt");
		expect(rows[0]?.tail).toBe("");
		expect(rows[0]?.text).toBe("short prompt");
	});

	test("lines above the parse limit are indexed by byte range and excerpts only", () => {
		const huge = jsonLine(claudeUser(`${"a".repeat(500)}${"b".repeat(500)}`));
		const small = jsonLine(claudeUser("after"));
		const stats = createSplitStats();
		const rows = [
			...splitTranscript(
				{
					content: `${huge}\n${small}`,
					fallbackTs: SESSION_DATE,
					maxParseLineBytes: 600,
					source: "claude_code",
				},
				stats,
			),
		];

		expect(rows.map((row) => [row.recordIdx, row.kind])).toEqual([
			[1, "oversized"],
			[2, "user_prompt"],
		]);
		expect(rows[0]?.byteLen).toBe(Buffer.byteLength(huge, "utf8"));
		expect(rows[0]?.text).toBe("");
		expect(stats.oversizedLineCount).toBe(1);
	});

	test("an exhausted session budget keeps a short head, and tool results their tail", () => {
		const cause = "Error: ENOENT: no such file, open 'config.json'";
		const rows = [
			...splitSessionTranscript({
				content: [
					jsonLine(claudeUser("z".repeat(2_000))),
					jsonLine(
						claudeUser([
							{
								content: `${"log line\n".repeat(300)}${cause}`,
								is_error: true,
								tool_use_id: "missing",
								type: "tool_result",
							},
						]),
					),
				].join("\n"),
				sessionDate: SESSION_DATE,
				source: "claude_code",
				textBudgetChars: 10,
			}),
		];

		expect(rows[0]).toMatchObject({ text: "", tail: "", textChars: 2_000 });
		expect(rows[0]?.head).toBe("z".repeat(256));
		expect(rows[1]?.text).toBe("");
		expect(rows[1]?.head).toStartWith("log line");
		expect(rows[1]?.head.length).toBe(256);
		expect(rows[1]?.tail).toEndWith(cause);
		expect(rows[1]?.tail.length).toBe(512);
	});

	test("a record over its allowance keeps both excerpts and as much text as fits", () => {
		const body = "a".repeat(5_000);
		const [row] = [
			...splitSessionTranscript({
				content: jsonLine(claudeUser(body)),
				sessionDate: SESSION_DATE,
				source: "claude_code",
				textBudgetChars: 3_000,
			}),
		];
		expect(row?.head.length).toBe(1_024);
		expect(row?.tail.length).toBe(1_024);
		expect(row?.text.length).toBe(3_000 - 2_048);
	});

	test("pacing keeps late turns and subagent transcripts from being starved", () => {
		const early = Array.from({ length: 10 }, (_, index) =>
			jsonLine(
				claudeUser([
					{
						content: `${index}`.repeat(20_000),
						tool_use_id: `t${index}`,
						type: "tool_result",
					},
				]),
			),
		);
		const late = Array.from({ length: 10 }, (_, index) =>
			jsonLine(claudeUser(`late prompt ${index} ${"q".repeat(1_500)}`)),
		);
		const child = jsonLine(
			claudeAssistant([
				{ text: `child finding ${"c".repeat(1_500)}`, type: "text" },
			]),
		);
		const rows = [
			...splitSessionTranscript({
				content: [...early, ...late].join("\n"),
				sessionDate: SESSION_DATE,
				source: "claude_code",
				subagents: { "agent-1": child },
				textBudgetChars: 100_000,
			}),
		];
		const latePrompts = ofKind(rows, "user_prompt");
		expect(latePrompts).toHaveLength(10);
		// Without pacing the early tool results would spend the whole budget and
		// every later record would keep a 256-character head.
		for (const prompt of latePrompts)
			expect(prompt.head.length).toBeGreaterThan(256);
		const childText = rows.find((row) => row.agentId === "agent-1");
		expect(childText?.head.length).toBeGreaterThan(256);
		const spent = rows.reduce(
			(total, row) =>
				total + row.text.length + row.head.length + row.tail.length,
			0,
		);
		expect(spent).toBeLessThanOrEqual(100_000 + 256 * rows.length);
	});
});

describe("subagent transcripts", () => {
	test("native Codex delegation and Claude Task/Agent prompts start the same turns", async () => {
		for (const [source, fixture] of [
			["codex", "codex-subagent-turns.jsonl"],
			["claude_code", "claude-subagent-turns.jsonl"],
		] as const) {
			const content = await readFixture(fixture);
			for (const agentId of ["", "synthetic-worker"]) {
				const rows = [
					...splitTranscript({
						agentId,
						content,
						fallbackTs: SESSION_DATE,
						source,
					}),
				];
				expect(
					ofKind(rows, "user_prompt").map((row) => [
						row.turnIdx,
						row.subtype,
						row.text,
					]),
				).toEqual([
					[1, "delegation", "Inspect the synthetic parser."],
					[2, "delegation", "Now test the synthetic fix."],
				]);
				expect(ofKind(rows, "tool_call").map((row) => row.turnIdx)).toEqual([
					1,
				]);
				expect(ofKind(rows, "tool_result").map((row) => row.turnIdx)).toEqual([
					1,
				]);
				expect(
					ofKind(rows, "assistant_text").map((row) => row.turnIdx),
				).toEqual([2]);
				if (source === "codex") {
					expect(
						rows
							.filter((row) => row.recordIdx < 4)
							.every((row) => row.turnIdx === 0),
					).toBe(true);
					expect(rows.find((row) => row.recordIdx === 8)).toMatchObject({
						kind: "meta",
						subtype: "agent_message",
						turnIdx: 1,
					});
				}
			}
		}
	});

	test("Codex subagent metadata works across native and older session shapes", async () => {
		const body = (await readFixture("codex-subagent-turns.jsonl"))
			.trim()
			.split("\n")
			.slice(1);
		for (const metadata of [
			{ thread_source: "subagent" },
			{ source: "subagent" },
			{ source: { subagent: { other: "synthetic-worker" } } },
			{ source: { subagent: "synthetic-worker" } },
			{ parent_thread_id: "synthetic-parent" },
			{
				source: {
					subagent: {
						thread_spawn: {
							parent_thread_id: "synthetic-parent",
							agent_path: "/root/worker",
							depth: 1,
						},
					},
				},
			},
		]) {
			const content = [
				jsonLine({
					type: "session_meta",
					payload: {
						id: "synthetic-child",
						originator: "codex_exec",
						...metadata,
					},
				}),
				...body,
			].join("\n");
			expect(
				ofKind(codexRows(content), "user_prompt").map((row) => [
					row.turnIdx,
					row.subtype,
				]),
			).toEqual([
				[1, "delegation"],
				[2, "delegation"],
			]);
		}
	});

	test("Codex main-session messages and invalid hints do not masquerade as delegation", async () => {
		const body = (await readFixture("codex-subagent-turns.jsonl"))
			.trim()
			.split("\n")
			.slice(1);
		for (const metadata of [
			{ originator: "codex_exec", source: "cli" },
			{ originator: "codex_cli_rs", source: "cli" },
			{ forked_from_id: "synthetic-parent" },
			{ parent_thread_id: "synthetic-child" },
			{ source: { subagent: false } },
		]) {
			const content = [
				jsonLine({
					type: "session_meta",
					payload: { id: "synthetic-child", ...metadata },
				}),
				...body,
				jsonLine({
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "A real human prompt" }],
					},
				}),
			].join("\n");
			expect(
				ofKind(codexRows(content), "user_prompt").map((row) => [
					row.turnIdx,
					row.subtype,
					row.text,
				]),
			).toEqual([[1, "", "A real human prompt"]]);
		}
	});

	test("legacy unaddressed delegated tasks still advance after a response", () => {
		const rows = codexRows(
			[
				jsonLine({
					type: "session_meta",
					payload: {
						parent_thread_id: "synthetic-parent",
						id: "synthetic-child",
					},
				}),
				jsonLine({
					type: "response_item",
					payload: {
						type: "agent_message",
						content: [{ type: "input_text", text: "First task" }],
					},
				}),
				jsonLine({
					type: "response_item",
					payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "First answer" }],
					},
				}),
				jsonLine({
					type: "response_item",
					payload: {
						type: "agent_message",
						content: [{ type: "input_text", text: "Second task" }],
					},
				}),
			].join("\n"),
		);
		expect(
			ofKind(rows, "user_prompt").map((row) => [row.turnIdx, row.subtype]),
		).toEqual([
			[1, "delegation"],
			[2, "delegation"],
		]);
	});

	test("in-file Codex agents keep their delegated turns separate from the root", () => {
		const rows = codexRows(
			[
				jsonLine({
					type: "response_item",
					payload: {
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "Human root prompt" }],
					},
				}),
				jsonLine({
					type: "response_item",
					payload: {
						type: "agent_message",
						agent: { agent_name: "/root/worker" },
						author: "/root",
						recipient: "/root/worker",
						content: [{ type: "input_text", text: "Delegated child prompt" }],
					},
				}),
				jsonLine({
					type: "response_item",
					payload: {
						type: "message",
						agent: { agent_name: "/root/worker" },
						role: "assistant",
						content: [{ type: "output_text", text: "Child answer" }],
					},
				}),
			].join("\n"),
		);
		expect(
			rows.map((row) => [row.agentId, row.kind, row.turnIdx, row.subtype]),
		).toEqual([
			["", "user_prompt", 1, ""],
			["/root/worker", "user_prompt", 1, "delegation"],
			["/root/worker", "assistant_text", 1, ""],
		]);
	});

	test("empty, outgoing, and other recipients' agent messages cannot start a child turn", () => {
		const rows = codexRows(
			[
				jsonLine({
					type: "session_meta",
					payload: { thread_source: "subagent", agent_path: "/root/worker" },
				}),
				...[
					{ author: "/root", recipient: "/root/worker", text: " " },
					{
						author: "/root/worker",
						recipient: "/root",
						text: "Outgoing report",
					},
					{
						author: "/root",
						recipient: "/root/other",
						text: "Someone else's task",
					},
				].map(({ text, ...route }) =>
					jsonLine({
						type: "response_item",
						payload: {
							type: "agent_message",
							...route,
							content: [{ type: "input_text", text }],
						},
					}),
				),
			].join("\n"),
		);
		expect(ofKind(rows, "user_prompt")).toHaveLength(0);
		expect(rows.every((row) => row.turnIdx === 0)).toBe(true);
	});

	test("each subagent is its own stream with its own line numbers and delegated prompt", () => {
		const main = [
			jsonLine(claudeUser("build it")),
			jsonLine(claudeAssistant([{ text: "delegating", type: "text" }])),
		].join("\n");
		const subagent = [
			jsonLine(claudeUser("explore the repo and report")),
			jsonLine(claudeAssistant([{ text: "found it", type: "text" }])),
		].join("\n");
		const rows = [
			...splitSessionTranscript({
				content: main,
				sessionDate: SESSION_DATE,
				source: "claude_code",
				subagents: { "agent-b": subagent, "agent-a": subagent },
			}),
		];

		expect(
			rows.map((row) => [row.agentId, row.recordIdx, row.kind, row.subtype]),
		).toEqual([
			["", 1, "user_prompt", ""],
			["", 2, "assistant_text", ""],
			["agent-a", 1, "user_prompt", "delegation"],
			["agent-a", 2, "assistant_text", ""],
			["agent-b", 1, "user_prompt", "delegation"],
			["agent-b", 2, "assistant_text", ""],
		]);
		expect(
			rows
				.filter((row) => row.agentId !== "")
				.every((row) => row.turnIdx === 1),
		).toBe(true);
	});
});

describe("Codex records", () => {
	test("direct era strips injected context, reads exit codes, and expands patches", async () => {
		const rows = codexRows(await readFixture("codex-direct-era.jsonl"));

		const prompts = ofKind(rows, "user_prompt");
		expect(prompts.map((row) => [row.recordIdx, row.text])).toEqual([
			[3, "inspect the session"],
		]);
		expect(
			ofKind(rows, "injected_context").map((row) => [
				row.recordIdx,
				row.subtype,
			]),
		).toEqual([
			[2, "environment_context"],
			[3, "system_instruction"],
		]);

		const results = ofKind(rows, "tool_result");
		expect(
			results.map((row) => [row.callId, row.exitCode, row.isError]),
		).toEqual([
			["direct-read", 0, false],
			["direct-compound", 0, false],
			["direct-multi", 0, false],
			["direct-patch", null, false],
			["failure", 127, true],
		]);
		expect(results[0]?.toolName).toBe("exec_command");
		expect(results[0]?.text).toContain("source");

		expect(
			ofKind(rows, "file_change").map((row) => [
				row.fileOp,
				row.filePath,
				row.subtype,
			]),
		).toEqual([
			["write", "src/new.ts", "patch"],
			["delete", "src/old.ts", "patch"],
			["write", "src/moved.ts", "patch"],
			["delete", "src/gone.ts", "patch"],
		]);
		const patchCall = ofKind(rows, "tool_call").find(
			(row) => row.callId === "direct-patch",
		);
		expect(patchCall?.toolName).toBe("apply_patch");
		expect(patchCall?.text).toBe("");
		expect(ofKind(rows, "reasoning").map((row) => row.text)).toEqual([
			"",
			"Checking the parser",
		]);
	});

	test("end events supply exit codes and patch failures for the matching output", async () => {
		const rows = codexRows(await readFixture("codex-end-event-era.jsonl"));

		const byCall = new Map(
			ofKind(rows, "tool_result").map((row) => [row.callId, row]),
		);
		expect(byCall.get("structured-read")).toMatchObject({
			exitCode: 0,
			isError: false,
		});
		expect(byCall.get("structured-failure")).toMatchObject({
			exitCode: 127,
			isError: true,
		});
		expect(byCall.get("structured-patch")).toMatchObject({ isError: false });
		expect(byCall.get("failed-patch")).toMatchObject({
			exitCode: null,
			isError: true,
		});
		expect(
			rows.filter((row) => row.kind === "meta").map((row) => row.subtype),
		).toContain("exec_command_end");
		expect(rows.at(-1)?.subtype).toBe("thread_rolled_back");
	});

	test("custom exec scripts expose inner patches and compaction markers", async () => {
		const rows = codexRows(await readFixture("codex-custom-exec-era.jsonl"));

		expect(ofKind(rows, "user_prompt").map((row) => row.text)).toEqual([
			"inspect current cells",
		]);
		expect(
			ofKind(rows, "file_change").map((row) => [row.fileOp, row.filePath]),
		).toEqual([["write", "src/current.ts"]]);
		expect(ofKind(rows, "compaction")).toHaveLength(1);
		const scriptCall = ofKind(rows, "tool_call").find(
			(row) => row.callId === "script",
		);
		expect(scriptCall?.toolName).toBe("exec");
		expect(scriptCall?.commandClass).toBe("other");
	});

	test("structured output metadata and transport preambles yield exit codes", () => {
		const lines = [
			{
				payload: {
					content: [{ text: "fix the type errors", type: "input_text" }],
					role: "user",
					type: "message",
				},
				timestamp: "2026-03-02T04:29:38.636Z",
				type: "response_item",
			},
			{
				payload: {
					arguments: JSON.stringify({
						command: ["bash", "-lc", "tsc --noEmit"],
					}),
					call_id: "c1",
					name: "shell",
					type: "function_call",
				},
				timestamp: "2026-03-02T04:29:40.100Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "c1",
					output: JSON.stringify({
						metadata: { exit_code: 2 },
						output: "error TS2345",
					}),
					type: "function_call_output",
				},
				timestamp: "2026-03-02T04:29:41.200Z",
				type: "response_item",
			},
			{
				payload: {
					arguments: JSON.stringify({ command: ["cat", "src/index.ts"] }),
					call_id: "c2",
					name: "shell",
					type: "function_call",
				},
				timestamp: "2026-03-02T04:29:42.000Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "c2",
					output: JSON.stringify({
						metadata: { exit_code: 0 },
						output: "TypeError: only text that looks like an error",
					}),
					type: "function_call_output",
				},
				timestamp: "2026-03-02T04:29:43.000Z",
				type: "response_item",
			},
			{
				payload: {
					call_id: "c3",
					output: [
						{
							text: "Script completed\nWall time 0.2 seconds\nOutput:\n",
							type: "input_text",
						},
						{
							text: '{"chunk_id":"a","exit_code":1,"output":"boom"}',
							type: "input_text",
						},
					],
					type: "custom_tool_call_output",
				},
				timestamp: "2026-03-02T04:29:44.000Z",
				type: "response_item",
			},
		];
		const rows = codexRows(lines.map(jsonLine).join("\n"));

		const calls = ofKind(rows, "tool_call");
		expect(
			calls.map((row) => [row.toolName, row.commandClass, row.text]),
		).toEqual([
			["shell", "typecheck", "tsc --noEmit"],
			["shell", "other", "cat src/index.ts"],
		]);
		expect(
			ofKind(rows, "tool_result").map((row) => [
				row.callId,
				row.exitCode,
				row.isError,
				row.subtype,
			]),
		).toEqual([
			["c1", 2, true, ""],
			["c2", 0, false, ""],
			["c3", 1, true, "orphan"],
		]);
		expect(ofKind(rows, "tool_result")[0]?.text).toBe("error TS2345");
	});

	test("image outputs render marked screenshots as labels instead of raw JSON", () => {
		const output = (callId: string, value: unknown) => ({
			payload: { call_id: callId, output: value, type: "function_call_output" },
			timestamp: "2026-03-02T04:29:41.000Z",
			type: "response_item",
		});
		const blocks = [
			{ text: "captured-sidebar", type: "input_text" },
			{ detail: "original", image_url: SCREENSHOT_MARKER, type: "input_image" },
			{ image_url: "data:image/png;base64,AAAA", type: "input_image" },
		];
		const rows = codexRows(
			[output("array", blocks), output("encoded", JSON.stringify(blocks))]
				.map(jsonLine)
				.join("\n"),
		);

		expect(ofKind(rows, "tool_result").map((row) => row.text)).toEqual([
			`captured-sidebar\n${SCREENSHOT_LABEL}\n[image]`,
			`captured-sidebar\n${SCREENSHOT_LABEL}\n[image]`,
		]);
	});

	test("application output never overrides the transport exit code", () => {
		const output = (callId: string, text: unknown) => ({
			payload: { call_id: callId, output: text, type: "function_call_output" },
			timestamp: "2026-03-02T04:29:41.000Z",
			type: "response_item",
		});
		const rows = codexRows(
			[
				output("preamble", 'Process exited with code 0\n{"exit_code":1}'),
				output(
					"marker",
					'Chunk ID: a\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 9\nOutput:\nProcess exited with code 7\n{"exit_code":1}\nExit code: 3',
				),
				output(
					"envelope",
					JSON.stringify({
						metadata: { exit_code: 0 },
						output: 'Process exited with code 4\n{"exit_code":1}',
					}),
				),
				output("bare", '{"exit_code":1}'),
				output("prose", "the build said Process exited with code 2"),
				output("blocks", [
					{
						text: 'Process exited with code 0\n{"exit_code":1}',
						type: "input_text",
					},
				]),
			]
				.map(jsonLine)
				.join("\n"),
		);

		expect(
			ofKind(rows, "tool_result").map((row) => [
				row.callId,
				row.exitCode,
				row.isError,
			]),
		).toEqual([
			["preamble", 0, false],
			["marker", 0, false],
			["envelope", 0, false],
			["bare", null, false],
			["prose", null, false],
			["blocks", 0, false],
		]);
	});

	test("the event and response-item copies of one prompt count once", () => {
		const prompt = "ship the feature";
		const rows = codexRows(
			[
				{
					payload: {
						content: [
							{
								text: "<environment_context>cwd</environment_context>",
								type: "input_text",
							},
							{ text: prompt, type: "input_text" },
						],
						role: "user",
						type: "message",
					},
					timestamp: "2026-03-02T04:29:38.000Z",
					type: "response_item",
				},
				{
					payload: { message: prompt, type: "user_message" },
					timestamp: "2026-03-02T04:29:38.001Z",
					type: "event_msg",
				},
				{
					payload: {
						content: [{ text: "on it", type: "output_text" }],
						role: "assistant",
						type: "message",
					},
					timestamp: "2026-03-02T04:29:39.000Z",
					type: "response_item",
				},
				{
					payload: { message: prompt, type: "user_message" },
					timestamp: "2026-03-02T04:30:00.000Z",
					type: "event_msg",
				},
			]
				.map(jsonLine)
				.join("\n"),
		);

		expect(rows.map((row) => [row.kind, row.subtype, row.turnIdx])).toEqual([
			["user_prompt", "", 1],
			["injected_context", "environment_context", 1],
			["meta", "user_message_mirror", 1],
			["assistant_text", "", 1],
			["user_prompt", "", 2],
		]);
	});

	test("shell patches and in-file sub-agent attribution", () => {
		const patch =
			"*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch";
		const rows = codexRows(
			[
				{
					payload: {
						arguments: JSON.stringify({
							cmd: `apply_patch <<'EOF'\n${patch}\nEOF`,
						}),
						call_id: "p1",
						name: "exec_command",
						type: "function_call",
					},
					timestamp: "2026-03-02T04:29:38.000Z",
					type: "response_item",
				},
				{
					payload: {
						agent: { agent_name: "reviewer" },
						content: [{ text: "look at src/app.ts", type: "input_text" }],
						role: "user",
						type: "message",
					},
					timestamp: "2026-03-02T04:29:39.000Z",
					type: "response_item",
				},
			]
				.map(jsonLine)
				.join("\n"),
		);

		expect(
			ofKind(rows, "file_change").map((row) => [
				row.fileOp,
				row.filePath,
				row.text,
			]),
		).toEqual([["edit", "src/app.ts", "@@\n-a\n+b"]]);
		expect(ofKind(rows, "tool_call")[0]?.commandClass).toBe("");
		const delegated = ofKind(rows, "user_prompt")[0];
		expect([
			delegated?.agentId,
			delegated?.subtype,
			delegated?.turnIdx,
		]).toEqual(["reviewer", "delegation", 1]);
	});
});

describe("readable context", () => {
	test("Codex compaction keeps the summary it carried forward", () => {
		const rows = codexRows(
			[
				{
					payload: {
						compaction_response_id: null,
						message: "",
						replacement_history: [
							{
								content: [{ text: "Handoff: tests pass", type: "input_text" }],
								role: "user",
								type: "message",
							},
						],
					},
					timestamp: "2026-03-02T04:29:38.000Z",
					type: "compacted",
				},
			]
				.map(jsonLine)
				.join("\n"),
		);
		expect(rows[0]).toMatchObject({
			kind: "compaction",
			subtype: "compacted",
			text: "[user]\nHandoff: tests pass",
		});
	});

	test("injected context is capped at its own limit and a line decodes in full", () => {
		const memory = `Contents of /repo/CLAUDE.md:\n${"rule ".repeat(5_000)}`;
		const line = jsonLine(
			claudeUser(`<system-reminder>${memory}</system-reminder>`),
		);
		const [stored] = claudeRows([line]);
		expect(stored?.kind).toBe("injected_context");
		expect(stored?.text.length).toBe(TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS);
		expect(stored?.textChars).toBeGreaterThan(
			TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS,
		);
		const [decoded] = decodeTranscriptLine({
			agentId: "",
			line,
			source: "claude_code",
		});
		expect(decoded?.textChars).toBe(stored?.textChars);
		expect(decoded?.text.length).toBe(stored?.textChars);
		expect(decoded?.text.endsWith("rule </system-reminder>")).toBe(true);
	});
});

describe("Claude attachments, hooks and API errors", () => {
	const attachment = (value: Record<string, unknown>, second = 1) => ({
		attachment: value,
		timestamp: `2026-08-01T10:00:0${second}.000Z`,
		type: "attachment",
	});

	test("instructions, memory, MCP instructions and edited files keep their content", () => {
		const rows = claudeRows([
			attachment({
				files: [
					{
						content: "Always run the tests.",
						path: "/repo/CLAUDE.md",
						type: "Project",
					},
				],
				type: "instructions",
			}),
			attachment({
				content: {
					content: "Use bun.",
					contentDiffersFromDisk: false,
					path: "/repo/apps/api/CLAUDE.md",
					type: "Project",
				},
				displayPath: "apps/api/CLAUDE.md",
				path: "/repo/apps/api/CLAUDE.md",
				type: "nested_memory",
			}),
			attachment({
				addedBlocks: ["## linear\nUse the issue tools."],
				addedNames: ["linear"],
				removedNames: ["old-server"],
				type: "mcp_instructions_delta",
			}),
			attachment({
				filename: "/repo/src/app.ts",
				snippet: "12\tconst a = 1;",
				type: "edited_text_file",
			}),
			attachment({
				allowedTools: ["Bash", "Read"],
				type: "command_permissions",
			}),
			attachment({ text: "Tokens used: 1000", type: "total_tokens_reminder" }),
		]);
		expect(
			rows.map((row) => [row.kind, row.subtype, row.filePath, row.text]),
		).toEqual([
			[
				"injected_context",
				"instructions",
				"",
				"Contents of /repo/CLAUDE.md:\nAlways run the tests.",
			],
			[
				"injected_context",
				"nested_memory",
				"/repo/apps/api/CLAUDE.md",
				"Contents of /repo/apps/api/CLAUDE.md:\nUse bun.",
			],
			[
				"injected_context",
				"mcp_instructions",
				"",
				"## linear\nUse the issue tools.\n\nremoved: old-server",
			],
			[
				"injected_context",
				"edited_text_file",
				"/repo/src/app.ts",
				"12\tconst a = 1;",
			],
			["meta", "attachment:command_permissions", "", "Bash\nRead"],
			["meta", "attachment:total_tokens_reminder", "", "Tokens used: 1000"],
		]);
	});

	test("a queued prompt is a genuine prompt that starts a turn and counts once", () => {
		const rows = claudeRows([
			claudeUser("fix the build"),
			claudeAssistant([{ text: "Working on it.", type: "text" }]),
			attachment(
				{
					commandMode: "prompt",
					prompt: "also update the docs",
					source_uuid: "u-1",
					timestamp: "2026-08-01T10:00:03.000Z",
					type: "queued_command",
				},
				3,
			),
			attachment(
				{
					commandMode: "task-notification",
					prompt: "<task-notification>done</task-notification>",
					type: "queued_command",
				},
				4,
			),
			claudeAssistant([{ text: "Docs too.", type: "text" }]),
			// Some versions also write the queued prompt as a user message.
			claudeUser("also update the docs"),
		]);
		expect(
			ofKind(rows, "user_prompt").map((row) => [
				row.recordIdx,
				row.subtype,
				row.turnIdx,
				row.text,
			]),
		).toEqual([
			[1, "", 1, "fix the build"],
			[3, "queued", 2, "also update the docs"],
		]);
		expect(rows.at(-1)).toMatchObject({
			kind: "meta",
			subtype: "queued_prompt_mirror",
			turnIdx: 2,
		});
		expect(rows.find((row) => row.recordIdx === 4)).toMatchObject({
			kind: "injected_context",
			subtype: "task_notification",
		});
	});

	test("hook summaries, API errors and error messages keep what happened", () => {
		const rows = claudeRows([
			{
				hookAdditionalContext: [],
				hookCount: 1,
				hookErrors: ["lint hook exited 2: 3 problems"],
				hookInfos: [{ command: "bun run lint", durationMs: 145 }],
				level: "suggestion",
				preventedContinuation: true,
				stopReason: "Fix the lint errors first",
				subtype: "stop_hook_summary",
				timestamp: "2026-08-01T10:00:01.000Z",
				type: "system",
			},
			{
				error: {
					connection: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" },
					formatted: "Unable to connect to API (ENOTFOUND)",
					isNetworkDown: true,
					message: "Connection error.",
				},
				level: "error",
				maxRetries: 10,
				retryAttempt: 1,
				subtype: "api_error",
				timestamp: "2026-08-01T10:00:02.000Z",
				type: "system",
			},
			{
				error: "rate_limit",
				isApiErrorMessage: true,
				message: {
					content: [
						{
							text: "You've hit your session limit · resets 7pm",
							type: "text",
						},
					],
					role: "assistant",
				},
				timestamp: "2026-08-01T10:00:03.000Z",
				type: "assistant",
			},
		]);
		expect(
			rows.map((row) => [row.kind, row.subtype, row.isError, row.text]),
		).toEqual([
			[
				"meta",
				"system:stop_hook_summary:prevented",
				true,
				"preventedContinuation: true\nstopReason: Fix the lint errors first\nhookError: lint hook exited 2: 3 problems",
			],
			[
				"meta",
				"system:api_error",
				true,
				"Unable to connect to API (ENOTFOUND)",
			],
			[
				"meta",
				"api_error_message",
				true,
				"[rate_limit] You've hit your session limit · resets 7pm",
			],
		]);
		expect(ofKind(rows, "assistant_text")).toHaveLength(0);
	});
});

describe("still-running results", () => {
	test("running-process framing without an exit code is running, not a pass", () => {
		const call = (callId: string) => ({
			payload: {
				arguments: JSON.stringify({ cmd: "bun test --watch" }),
				call_id: callId,
				name: "exec_command",
				type: "function_call",
			},
			timestamp: "2026-03-02T04:29:38.000Z",
			type: "response_item",
		});
		const output = (callId: string, text: string) => ({
			payload: { call_id: callId, output: text, type: "function_call_output" },
			timestamp: "2026-03-02T04:29:39.000Z",
			type: "response_item",
		});
		const rows = codexRows(
			[
				call("still"),
				output(
					"still",
					"Chunk ID: 1a2b\nWall time: 10.0 seconds\nProcess running with session ID 4242\nOriginal token count: 12\nOutput:\nwatching…",
				),
				call("script"),
				output(
					"script",
					"Script running with cell ID 111\nWall time 31.0 seconds\nOutput:\n",
				),
				call("done"),
				output(
					"done",
					"Chunk ID: 3c4d\nWall time: 2.0 seconds\nProcess exited with code 0\nOutput:\nProcess running with session ID 1 (printed by the app)",
				),
			]
				.map(jsonLine)
				.join("\n"),
		);
		expect(
			ofKind(rows, "tool_result").map((row) => [
				row.callId,
				row.subtype,
				row.exitCode,
				row.isError,
			]),
		).toEqual([
			["still", "running", null, false],
			["script", "running", null, false],
			["done", "", 0, false],
		]);
	});

	test("a Claude background launch is running", () => {
		const rows = claudeRows([
			claudeAssistant([
				{
					id: "bg",
					input: { command: "bun run dev", run_in_background: true },
					name: "Bash",
					type: "tool_use",
				},
			]),
			claudeUser([
				{
					content:
						"Command running in background with ID: bd486wkvr. Output is being written to: /tmp/claude/bd486wkvr.output",
					tool_use_id: "bg",
					type: "tool_result",
				},
			]),
		]);
		expect(ofKind(rows, "tool_result")[0]).toMatchObject({
			exitCode: null,
			isError: false,
			subtype: "running",
		});
	});
});
