import { describe, expect, test } from "bun:test";
import {
	antigravityPrompt,
	inferAntigravityCwd,
	readGeminiCliRecord,
	translateAntigravityTranscript,
	translateGeminiCliSession,
} from "./transcript.js";

const SESSION = "8d1f6a6e-5b0c-4e45-9a0e-1f3f0c7e2b11";

/** What Gemini CLI 0.70 appends while a session runs. */
function geminiCliLog(): string {
	const lines: unknown[] = [
		{
			sessionId: SESSION,
			projectHash: "abc",
			startTime: "2026-11-20T10:00:00.000Z",
			lastUpdated: "2026-11-20T10:00:00.000Z",
			kind: "main",
		},
		{
			id: "u1",
			timestamp: "2026-11-20T10:00:01.000Z",
			type: "user",
			content: [
				{ text: "Fix the failing test\n--- Content from referenced files ---" },
			],
			displayContent: [{ text: "Fix the failing test @src/a.ts" }],
		},
		{ $set: { lastUpdated: "2026-11-20T10:00:01.000Z" } },
		// The reply is recorded first, then re-written with tokens and calls.
		{
			id: "g1",
			timestamp: "2026-11-20T10:00:05.000Z",
			type: "gemini",
			content: "Running the tests first.",
			thoughts: [
				{
					subject: "Plan",
					description: "Run tests.",
					timestamp: "2026-11-20T10:00:04.000Z",
				},
			],
			tokens: null,
			model: "gemini-4-neon",
		},
		{
			id: "g1",
			timestamp: "2026-11-20T10:00:05.000Z",
			type: "gemini",
			content: "Running the tests first.",
			thoughts: [
				{
					subject: "Plan",
					description: "Run tests.",
					timestamp: "2026-11-20T10:00:04.000Z",
				},
			],
			tokens: {
				input: 12000,
				output: 300,
				cached: 8000,
				thoughts: 200,
				tool: 0,
				total: 12500,
			},
			model: "gemini-4-neon",
			toolCalls: [
				{
					id: "call_1",
					name: "run_shell_command",
					args: { command: "bun test", description: "Run tests" },
					status: "scheduled",
					timestamp: "2026-11-20T10:00:05.000Z",
				},
			],
		},
		{
			id: "g1",
			timestamp: "2026-11-20T10:00:05.000Z",
			type: "gemini",
			content: "Running the tests first.",
			thoughts: [
				{
					subject: "Plan",
					description: "Run tests.",
					timestamp: "2026-11-20T10:00:04.000Z",
				},
			],
			tokens: {
				input: 12000,
				output: 300,
				cached: 8000,
				thoughts: 200,
				tool: 0,
				total: 12500,
			},
			model: "gemini-4-neon",
			toolCalls: [
				{
					id: "call_1",
					name: "run_shell_command",
					args: { command: "bun test", description: "Run tests" },
					result: [
						{
							functionResponse: {
								id: "call_1",
								name: "run_shell_command",
								response: { output: "1 fail" },
							},
						},
					],
					status: "error",
					timestamp: "2026-11-20T10:00:09.000Z",
				},
			],
		},
		{
			id: "g2",
			timestamp: "2026-11-20T10:00:12.000Z",
			type: "gemini",
			content: "",
			tokens: {
				input: 14000,
				output: 100,
				cached: 12000,
				thoughts: 50,
				tool: 0,
				total: 14150,
			},
			model: "gemini-4-neon",
			toolCalls: [
				{
					id: "call_2",
					name: "replace",
					args: {
						file_path: "/repo/src/a.ts",
						old_string: "1",
						new_string: "2",
						instruction: "fix",
					},
					result: [
						{
							functionResponse: {
								id: "call_2",
								name: "replace",
								response: { output: "ok" },
							},
						},
					],
					status: "success",
					timestamp: "2026-11-20T10:00:13.000Z",
				},
				{
					id: "call_3",
					name: "invoke_agent",
					args: { agent_name: "codebase_investigator", prompt: "Find callers" },
					result: [
						{
							functionResponse: {
								id: "call_3",
								name: "invoke_agent",
								response: { output: "3 callers" },
							},
						},
					],
					status: "success",
					agentId: "sub-1",
					timestamp: "2026-11-20T10:00:30.000Z",
				},
			],
		},
		{
			id: "e1",
			timestamp: "2026-11-20T10:00:31.000Z",
			type: "error",
			content: "429 Resource exhausted",
		},
		{
			id: "i1",
			timestamp: "2026-11-20T10:00:31.500Z",
			type: "info",
			content: "Switched model",
		},
		{ $rewindTo: "g2" },
		{
			id: "u2",
			timestamp: "2026-11-20T10:01:00.000Z",
			type: "user",
			content: [{ text: "/compress" }],
		},
		{ $set: { summary: "Fixed the failing test" } },
	];
	return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

// biome-ignore lint/suspicious/noExplicitAny: the test reads the JSON lines it asserts on.
type Line = Record<string, any>;

function parse(content: string): Line[] {
	return content
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

describe("translateGeminiCliSession", () => {
	test("keeps the last version of each message and every turn a rewind dropped", () => {
		const record = readGeminiCliRecord(geminiCliLog());
		expect(record?.messages.map((message) => message.id)).toEqual([
			"u1",
			"g1",
			"g2",
			"e1",
			"i1",
			"u2",
		]);
		expect(record?.metadata.summary).toBe("Fixed the failing test");
	});

	test("writes Claude Code-shaped lines with Neon usage", () => {
		const result = translateGeminiCliSession(geminiCliLog(), { cwd: "/repo" });
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.sessionId).toBe(SESSION);
		expect(result.models).toEqual(["gemini-4-neon"]);
		expect(result.subagentIds).toEqual(["sub-1"]);
		expect(result.startedAt).toBe("2026-11-20T10:00:01.000Z");
		expect(result.endedAt).toBe("2026-11-20T10:01:00.000Z");

		const lines = parse(result.content);
		expect(lines.map((line) => line.type)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"user",
			"assistant",
			"user",
			"summary",
		]);
		const [prompt, first, firstResult, second, , taskResult, error, command] =
			lines;
		expect(prompt?.message.content).toBe("Fix the failing test @src/a.ts");
		expect(prompt?.cwd).toBe("/repo");
		expect(prompt?.parentUuid).toBeNull();
		expect(first?.parentUuid).toBe(prompt?.uuid);
		expect(first?.message.model).toBe("gemini-4-neon");
		expect(first?.message.usage).toEqual({
			input_tokens: 4000,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 8000,
			output_tokens: 500,
			output_tokens_details: { thinking_tokens: 200 },
		});
		expect(first?.message.content).toEqual([
			{ type: "thinking", thinking: "**Plan**\n\nRun tests.", signature: "" },
			{ type: "text", text: "Running the tests first." },
			{
				type: "tool_use",
				id: "call_1",
				name: "Bash",
				input: { command: "bun test", description: "Run tests" },
			},
		]);
		expect(firstResult?.message.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "call_1",
				content: "1 fail",
				is_error: true,
			},
		]);
		expect(second?.message.content.map((block: Line) => block.name)).toEqual([
			"Edit",
			"Task",
		]);
		expect(second?.message.content[1].input).toEqual({
			subagent_type: "codebase_investigator",
			description: "codebase_investigator",
			prompt: "Find callers",
		});
		expect(taskResult?.toolUseResult).toEqual({
			agentId: "sub-1",
			status: "completed",
		});
		expect(error?.isApiErrorMessage).toBe(true);
		expect(error?.message.model).toBe("<synthetic>");
		expect(command?.message.content).toContain(
			"<command-name>/compress</command-name>",
		);
	});

	test("is stable, so re-importing a session writes the same lines", () => {
		const first = translateGeminiCliSession(geminiCliLog(), { cwd: "/repo" });
		const second = translateGeminiCliSession(geminiCliLog(), { cwd: "/repo" });
		expect(first?.content).toBe(second?.content);
	});

	test("reads the single JSON document older versions wrote", () => {
		const legacy = JSON.stringify({
			sessionId: SESSION,
			projectHash: "abc",
			startTime: "2025-07-01T10:00:00.000Z",
			lastUpdated: "2025-07-01T10:00:05.000Z",
			messages: [
				{
					id: "a",
					timestamp: "2025-07-01T10:00:00.000Z",
					type: "user",
					content: "hi",
				},
				{
					id: "b",
					timestamp: "2025-07-01T10:00:05.000Z",
					type: "gemini",
					content: "hello",
					model: "gemini-2.5-pro",
					tokens: {
						input: 10,
						output: 2,
						cached: 0,
						thoughts: 0,
						tool: 0,
						total: 12,
					},
				},
			],
		});
		const result = translateGeminiCliSession(legacy, { cwd: "/repo" });
		expect(result?.models).toEqual(["gemini-2.5-pro"]);
		expect(parse(result?.content ?? "").map((line) => line.type)).toEqual([
			"user",
			"assistant",
		]);
	});

	test("marks a subagent's lines as a sidechain of its agent", () => {
		const result = translateGeminiCliSession(geminiCliLog(), {
			cwd: "/repo",
			agentId: "sub-1",
		});
		const [line] = parse(result?.content ?? "");
		expect(line?.isSidechain).toBe(true);
		expect(line?.agentId).toBe("sub-1");
	});

	test("rejects a file without session metadata", () => {
		expect(
			translateGeminiCliSession('{"foo":1}\n', { cwd: "/repo" }),
		).toBeNull();
	});
});

describe("translateAntigravityTranscript", () => {
	const steps = [
		{
			step_index: 0,
			type: "USER_INPUT",
			status: "DONE",
			content: "List the files",
			created_at: "2026-11-21T09:00:00Z",
		},
		{
			step_index: 1,
			type: "PLANNER_RESPONSE",
			status: "DONE",
			thinking: "**Listing**\nI will list.",
			created_at: "2026-11-21T09:00:03Z",
			model: "gemini-4-neon",
			usage_metadata: {
				prompt_token_count: 5000,
				candidates_token_count: 40,
				cached_content_token_count: 1000,
				thoughts_token_count: 60,
			},
			tool_calls: [
				{
					name: "run_command",
					args: { CommandLine: '"ls -la"', Cwd: '"/Users/me/app"' },
				},
				{
					name: "view_file",
					args: {
						AbsolutePath: '"/Users/me/app/a.ts"',
						StartLine: "3",
						EndLine: "9",
					},
				},
			],
		},
		{
			step_index: 2,
			type: "GENERIC",
			status: "DONE",
			output: "a.ts",
			created_at: "2026-11-21T09:00:04Z",
		},
		{
			step_index: 3,
			type: "GENERIC",
			status: "ERROR",
			error: "no such file",
			created_at: "2026-11-21T09:00:05Z",
		},
		{
			step_index: 4,
			type: "PLANNER_RESPONSE",
			status: "DONE",
			content: "Done.",
			created_at: "2026-11-21T09:00:06Z",
		},
	];
	const raw = `${steps.map((step) => JSON.stringify(step)).join("\n")}\n`;

	test("pairs tool results with calls in order and reads Neon usage", () => {
		const result = translateAntigravityTranscript(raw, "conv-1", {
			cwd: inferAntigravityCwd(raw) ?? "",
			defaultModel: "gemini-4-neon",
		});
		expect(result?.models).toEqual(["gemini-4-neon"]);
		const lines = parse(result?.content ?? "");
		expect(lines.map((line) => line.type)).toEqual([
			"user",
			"assistant",
			"user",
			"user",
			"assistant",
		]);
		expect(lines[0]?.cwd).toBe("/Users/me/app");
		const [, planner, ok, failed, done] = lines;
		expect(planner?.message.usage).toEqual({
			input_tokens: 4000,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 1000,
			output_tokens: 100,
			output_tokens_details: { thinking_tokens: 60 },
		});
		const [, bash, read] = planner?.message.content ?? [];
		expect(bash.name).toBe("Bash");
		expect(bash.input.command).toBe("ls -la");
		expect(read).toMatchObject({
			name: "Read",
			input: { file_path: "/Users/me/app/a.ts", offset: 3, limit: 7 },
		});
		expect(ok?.message.content[0]).toMatchObject({
			tool_use_id: bash.id,
			content: "a.ts",
		});
		expect(failed?.message.content[0]).toMatchObject({
			tool_use_id: read.id,
			content: "no such file",
			is_error: true,
		});
		expect(done?.message.model).toBe("gemini-4-neon");
		expect(done?.message.usage).toBeUndefined();
		expect(done?.timestamp).toBe("2026-11-21T09:00:06.000Z");
	});
});

describe("Antigravity as it writes today (1.5.14, run by T3 Code)", () => {
	const wrapped = [
		"<USER_REQUEST>",
		"<t3_code_instructions>",
		"## T3 Code interaction mode: Default",
		"</t3_code_instructions>",
		"",
		"<user_request>",
		"Make the star card subtitle shorter",
		"</user_request>",
		"<runtime_info>T3 Code</runtime_info>",
		"</USER_REQUEST>",
		"<ADDITIONAL_METADATA>",
		"The current local time is: 2026-11-21T17:04:57+01:00.",
		"</ADDITIONAL_METADATA>",
	].join("\n");
	const steps = [
		{
			step_index: 0,
			source: "SYSTEM",
			type: "SYSTEM_MESSAGE",
			status: "DONE",
			created_at: "2026-11-21T16:04:57Z",
			content: "<SYSTEM_MESSAGE>…</SYSTEM_MESSAGE>",
		},
		{
			step_index: 1,
			source: "USER_EXPLICIT",
			type: "USER_INPUT",
			status: "DONE",
			created_at: "2026-11-21T16:04:57Z",
			content: wrapped,
		},
		{
			step_index: 2,
			source: "MODEL",
			type: "PLANNER_RESPONSE",
			status: "DONE",
			created_at: "2026-11-21T16:05:03Z",
			model: "gemini-4-neon-high",
			input_tokens: 1200,
			cache_read_tokens: 36000,
			output_tokens: 300,
			thinking: "**Editing**",
			tool_calls: [
				{
					name: "edit_file",
					args: {
						Path: "/repo/card.tsx",
						Target: "Stars our GitHub directly.",
						Replacement: "Stars our GitHub.",
					},
				},
				{
					name: "invoke_subagent",
					args: {
						Prompt: "Check the copy",
						Role: "Copy reviewer",
						TypeName: "self",
						Model: "inherit",
						Workspace: "inherit",
					},
				},
				{
					name: "mcp_t3-code_html_preview",
					args: { path: "/repo/preview.html", toolSummary: "Preview" },
				},
			],
		},
		{
			step_index: 3,
			source: "MODEL",
			type: "GENERIC",
			status: "DONE",
			created_at: "2026-11-21T16:05:04Z",
			content: "Edited /repo/card.tsx",
		},
		{
			step_index: 4,
			source: "MODEL",
			type: "GENERIC",
			status: "DONE",
			created_at: "2026-11-21T16:05:05Z",
			content:
				'Created the following subagent:\n{\n  "conversationId": "sub-conv-1",\n  "logAbsoluteUri": "file:///x"\n}',
		},
		{
			step_index: 5,
			source: "MODEL",
			type: "GENERIC",
			status: "ERROR",
			created_at: "2026-11-21T16:05:06Z",
			content: "preview failed",
			error: "preview failed",
		},
	];
	const raw = `${steps.map((step) => JSON.stringify(step)).join("\n")}\n`;
	const result = translateAntigravityTranscript(raw, "conv-1", {
		cwd: "/repo",
		title: "Edit Star Card Subtitle",
	});
	const lines = parse(result?.content ?? "");

	test("the prompt is what the user typed, not the host's wrapping", () => {
		expect(lines[0]?.message.content).toBe(
			"Make the star card subtitle shorter",
		);
		expect(
			antigravityPrompt(
				"<USER_REQUEST>\nno em dashes.\n<runtime_info>x</runtime_info>\n</USER_REQUEST>",
			),
		).toBe("no em dashes.");
	});

	test("input_tokens is the uncached input; cached reads and output come apart", () => {
		expect(lines[1]?.message.model).toBe("gemini-4-neon-high");
		expect(lines[1]?.message.usage).toEqual({
			input_tokens: 1200,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 36000,
			output_tokens: 300,
		});
	});

	test("tools read as Claude Code's, MCP tools by server, subagents linked", () => {
		const [, edit, task, preview] = lines[1]?.message.content ?? [];
		expect(edit).toMatchObject({
			name: "Edit",
			input: {
				file_path: "/repo/card.tsx",
				old_string: "Stars our GitHub directly.",
				new_string: "Stars our GitHub.",
			},
		});
		expect(task).toMatchObject({
			name: "Task",
			input: {
				subagent_type: "self",
				description: "Copy reviewer",
				prompt: "Check the copy",
			},
		});
		expect(preview?.name).toBe("mcp__t3-code__html_preview");
		expect(result?.subagentIds).toEqual(["sub-conv-1"]);
		expect(lines[3]?.toolUseResult).toEqual({
			agentId: "sub-conv-1",
			status: "async_launched",
		});
		expect(lines[4]?.message.content[0]).toMatchObject({
			content: "preview failed",
			is_error: true,
		});
		expect(lines.at(-1)).toMatchObject({
			type: "summary",
			summary: "Edit Star Card Subtitle",
		});
	});
});

test("a subagent's report to its parent ends the subagent's work, as Claude Code's background agent notice", () => {
	const steps = [
		{
			step_index: 0,
			type: "USER_INPUT",
			status: "DONE",
			created_at: "2026-11-21T17:15:43Z",
			content: "Audit the cards",
		},
		{
			step_index: 1,
			type: "PLANNER_RESPONSE",
			status: "DONE",
			created_at: "2026-11-21T17:21:27Z",
			model: "gemini-4-neon-high",
			input_tokens: 10,
			output_tokens: 5,
			tool_calls: [
				{
					name: "invoke_subagent",
					args: { Prompt: "Audit", Role: "Auditor", TypeName: "self" },
				},
			],
		},
		{
			step_index: 2,
			type: "GENERIC",
			status: "DONE",
			created_at: "2026-11-21T17:21:29Z",
			content: '{\n  "conversationId": "f4cc386b-1067"\n}',
		},
		{
			step_index: 3,
			type: "SYSTEM_MESSAGE",
			status: "DONE",
			created_at: "2026-11-21T17:30:34Z",
			content:
				"<SYSTEM_MESSAGE>\nReminder: work efficiently.\n</SYSTEM_MESSAGE>",
		},
		{
			step_index: 4,
			type: "SYSTEM_MESSAGE",
			status: "DONE",
			created_at: "2026-11-21T17:30:35Z",
			content:
				"<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-21T17:30:34Z sender=f4cc386b-1067 priority=MESSAGE_PRIORITY_HIGH content=Completed the rewrite of cards 1–93.\n</SYSTEM_MESSAGE>",
		},
		{
			step_index: 5,
			type: "SYSTEM_MESSAGE",
			status: "DONE",
			created_at: "2026-11-21T18:18:06Z",
			content:
				"<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-21T18:18:06Z sender=system priority=MESSAGE_PRIORITY_LOW content=[Notice] stopped\n</SYSTEM_MESSAGE>",
		},
	];
	const result = translateAntigravityTranscript(
		`${steps.map((step) => JSON.stringify(step)).join("\n")}\n`,
		"parent",
		{ cwd: "/repo" },
	);
	const reports = parse(result?.content ?? "").filter(
		(line) =>
			typeof line.message?.content === "string" &&
			line.message.content.startsWith("<task-notification>"),
	);
	expect(reports).toHaveLength(1);
	expect(reports[0]?.timestamp).toBe("2026-11-21T17:30:34.000Z");
	expect(reports[0]?.message.content).toContain(
		"<task-id>f4cc386b-1067</task-id>",
	);
	expect(reports[0]?.message.content).toContain(
		"<result>Completed the rewrite of cards 1–93.</result>",
	);
});
