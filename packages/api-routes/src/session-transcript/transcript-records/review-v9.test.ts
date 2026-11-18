import { expect, test } from "bun:test";
import { unifiedDiffCounts } from "./applied-changes.js";
import {
	claudeToolResultFacts,
	clippedText,
	codexTurnContextFacts,
} from "./record-facts.js";
import { budgetFacts, splitSessionTranscript } from "./split-transcript.js";
import { literalLineCount } from "./text-fields.js";
import { TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS } from "./types.js";

function codexRows(records: Record<string, unknown>[]) {
	return [
		...splitSessionTranscript({
			source: "codex",
			content: records.map((record) => JSON.stringify(record)).join("\n"),
			sessionDate: "2026-10-10T00:00:00.000Z",
		}),
	];
}

test("a mixed exec output with its own completion code is not a running placeholder", () => {
	const rows = codexRows([
		{
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				call_id: "mixed",
				arguments: JSON.stringify({ cmd: "printf done" }),
			},
		},
		{
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "mixed",
				output: [
					{
						type: "input_text",
						text: "Wall time: 1 seconds\nProcess running with session ID 3\nOutput:\nongoing",
					},
					{
						type: "input_text",
						text: "Wall time: 1 seconds\nProcess exited with code 17\nOutput:\nfinished",
					},
				],
			},
		},
	]);
	expect(rows.at(-1)).toMatchObject({
		kind: "tool_result",
		exitCode: 17,
		isError: true,
	});
	expect(rows.at(-1)?.subtype).not.toBe("running");
});

test("namespaced exec commands use the command handler without serializing environment values", () => {
	const rows = codexRows([
		{
			type: "response_item",
			payload: {
				type: "function_call",
				name: "functions.exec_command",
				call_id: "command",
				arguments: JSON.stringify({
					cmd: "printf done",
					workdir: "/tmp",
					env: { SECRET: "ENV_SENTINEL" },
				}),
			},
		},
	]);
	expect(rows[0]).toMatchObject({
		kind: "tool_call",
		toolName: "functions.exec_command",
		text: "printf done",
	});
	expect(
		JSON.stringify(
			rows.map((row) => ({ text: row.text, facts: row.facts.extra })),
		),
	).not.toContain("ENV_SENTINEL");
});

test("shared literal line counting preserves empty and final-newline cases", () => {
	expect(
		["", "one", "one\n", "one\ntwo", "one\ntwo\n", "\n"].map(literalLineCount),
	).toEqual([0, 1, 1, 2, 2, 1]);
});

test("fact caps use UTF-16 units without splitting surrogate pairs", () => {
	const extra: Parameters<typeof clippedText>[0] = {};
	expect(clippedText(extra, "denial_reason", "😀😀", 3)).toBe("😀");
	expect(extra.facts_clipped).toBe("denial_reason");
});

test("completion timestamp families distinguish reasoning, tools and messages", () => {
	for (const type of [
		"Reasoning",
		"CommandExecution",
		"AgentMessage",
		"UserMessage",
		"Plan",
	]) {
		const rows = codexRows([
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type,
						id: "item",
						status: "completed",
						summary: [],
						content: [],
						text: "message",
					},
					started_at_ms: 10,
					completed_at_ms: 20,
				},
			},
		]);
		expect(
			rows.some(
				(row) => row.facts.extra.thinking_duration_ms_components !== undefined,
			),
		).toBe(type === "Reasoning");
		expect(
			rows.some(
				(row) => row.facts.extra.call_started_at_components !== undefined,
			),
		).toBe(type === "CommandExecution");
	}
});

test("wall time seconds are stored as milliseconds in both output formats", () => {
	for (const output of [
		"Wall time: 1.25 seconds\nOutput:\nfinished",
		{ metadata: { duration_seconds: 1.25 }, output: "finished" },
	]) {
		const rows = codexRows([
			{
				type: "response_item",
				payload: { type: "function_call_output", call_id: "wait", output },
			},
		]);
		const fact = rows[0]?.facts.extra.wall_time_ms_components;
		if (fact === undefined) throw new Error("Missing wait duration");
		expect(
			JSON.parse(fact).map((part: { value: unknown }) => part.value),
		).toEqual([typeof output === "string" ? { duration_ms: 1_250 } : 1_250]);
	}
});

test("duplicate output components use the text column and shared fact exhaustion is explicit", () => {
	const rows = codexRows([
		{
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "output",
				output: "unique result text",
			},
		},
	]);
	expect(rows[0]?.text).toBe("unique result text");
	expect(rows[0]?.facts.extra.tool_result_text_components).toBeUndefined();
	expect(TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS).toBe(16 * 1024 * 1024);
	const budget = { remaining: 40 };
	expect(
		budgetFacts(
			{ extra: { instruction_text_components: "a".repeat(40) } },
			budget,
		)?.extra?.facts_truncated,
	).toBeUndefined();
	expect(budget.remaining).toBe(0);
	expect(
		budgetFacts(
			{
				extra: {
					tool_result_text_components: "b".repeat(40),
					fork_replayed: "true",
				},
			},
			budget,
		)?.extra,
	).toEqual({ fork_replayed: "true", facts_truncated: "true" });
});

test("unified diff headers are skipped only before hunks", () => {
	expect(
		unifiedDiffCounts(
			"--- before.sql\n+++ after.sql\n@@ -1,2 +1,2 @@\n--- SQL comment\n+++ added comment\n-old\n+new\n",
		),
	).toEqual({ added: 2, removed: 2 });
});

test("copy-meta forks mark all inherited rows, not only tool calls", () => {
	const rows = codexRows([
		{
			type: "session_meta",
			payload: {
				id: "child",
				forked_from_id: "parent",
				subagent_history_start_ordinal: 8,
			},
		},
		{ type: "session_meta", ordinal: 0, payload: { id: "parent" } },
		{ type: "event_msg", ordinal: 1, payload: { type: "task_started" } },
		{ type: "turn_context", ordinal: 2, payload: { model: "parent-model" } },
		{
			type: "response_item",
			ordinal: 3,
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "parent prompt" }],
			},
		},
		{ type: "compacted", ordinal: 4, payload: { message: "parent summary" } },
		{
			type: "response_item",
			ordinal: 8,
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "child prompt" }],
			},
		},
	]);
	expect(rows.slice(1, -1).map((row) => row.facts.extra.fork_replayed)).toEqual(
		Array(5).fill("true"),
	);
	expect(rows.at(-1)?.facts.extra.fork_replayed).toBeUndefined();
	expect(
		rows
			.filter(
				(row) =>
					row.kind === "user_prompt" &&
					row.facts.extra.fork_replayed !== "true",
			)
			.map((row) => row.text),
	).toEqual(["child prompt"]);
});

test("credential keys redact containers, plurals, bearer, JWT and session IDs", () => {
	const secrets = {
		token: { value: "OBJECT_SECRET" },
		tokens: ["ARRAY_SECRET"],
		credentials: "CREDENTIAL_SECRET",
		secrets: "PLURAL_SECRET",
		nested: {
			bearer: "BEARER_SECRET",
			jwt: "JWT_SECRET",
			sessionId: "SESSION_SECRET",
		},
	};
	for (const record of [
		{
			type: "event_msg",
			payload: {
				type: "mcp_tool_call_end",
				call_id: "input",
				invocation: {
					server: "server",
					tool: "tool",
					arguments: JSON.stringify(secrets),
				},
			},
		},
		{
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "McpToolCall",
					id: "result",
					server: "server",
					tool: "tool",
					status: "completed",
					arguments: secrets,
					result: { content: [], structuredContent: secrets },
				},
			},
		},
	]) {
		const facts = JSON.stringify(
			codexRows([record]).map((row) => row.facts.extra),
		);
		for (const sentinel of [
			"OBJECT_SECRET",
			"ARRAY_SECRET",
			"CREDENTIAL_SECRET",
			"PLURAL_SECRET",
			"BEARER_SECRET",
			"JWT_SECRET",
			"SESSION_SECRET",
		])
			expect(facts).not.toContain(sentinel);
		expect(facts).toContain("[redacted]");
	}
});

test("account context retains Claude account email by owner decision", () => {
	const content = [
		{
			type: "attachment",
			attachment: {
				type: "session_context",
				context: { userEmail: "private@example.test" },
			},
		},
		{
			type: "attachment",
			attachment: { type: "credential_org", organizationUuid: "org-literal" },
		},
	]
		.map((record) => JSON.stringify(record))
		.join("\n");
	const rows = [
		...splitSessionTranscript({
			source: "claude_code",
			content,
			sessionDate: "2026-10-10T00:00:00Z",
		}),
	];
	expect(rows[0]?.facts.extra.account_context_components).toContain(
		"private@example.test",
	);
	expect(rows[1]?.facts.extra.account_context_components).toContain(
		"org-literal",
	);
});

test("MCP call identity preserves server names containing double underscores", () => {
	const rows = [
		...splitSessionTranscript({
			source: "claude_code",
			sessionDate: "2026-10-10T00:00:00Z",
			content: JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "mcp",
							name: "mcp__server__namespace__search",
							input: {},
						},
					],
				},
			}),
		}),
	];
	expect(rows[0]?.facts).toMatchObject({
		mcpServer: "server__namespace",
		mcpTool: "search",
	});
});

test("new profile and result-line keys do not change the legacy profile or match meaning", () => {
	expect(
		codexTurnContextFacts({
			permission_profile: { type: "managed" },
			active_permission_profile: { id: ":workspace" },
		}).extra,
	).toMatchObject({
		permission_profile: "managed",
		permission_profile_id: ":workspace",
	});
	const result = claudeToolResultFacts(
		{ mode: "content", numFiles: 2, numLines: 9 },
		undefined,
	);
	expect(result.extra).toMatchObject({
		files_found: "2",
		search_result_lines: "9",
		search_mode: "content",
	});
	expect(result.extra?.search_matches).toBeUndefined();
	expect(
		claudeToolResultFacts({ numMatches: 0, numLines: 9 }, undefined).extra
			?.search_matches,
	).toBe("0");
});

test("prose and test summaries are not tool failure envelopes", () => {
	for (const text of [
		"Services failed to start",
		"3 failed",
		"Upload failed: Could not upload",
		"status failed steps",
		"Parameters failed connector",
		"replay failed at step",
		"menu failed before",
		"verification failed",
	]) {
		expect(
			codexRows([
				{
					type: "response_item",
					payload: {
						type: "function_call_output",
						call_id: "prose",
						output: text,
					},
				},
			])[0]?.isError,
		).toBe(false);
	}
	for (const text of [
		"apply_patch verification failed: bad patch",
		"Script failed\nWall time: 1",
		"write_stdin failed: stdin closed",
		"exec_command failed for command",
		"tool call failed: transport",
		"aborted by user after 1 s",
	]) {
		expect(
			codexRows([
				{
					type: "response_item",
					payload: {
						type: "function_call_output",
						call_id: "error",
						output: text,
					},
				},
			])[0]?.isError,
		).toBe(true);
	}
});

test("completion-only outcome components land on the result, never its synthesized request", () => {
	const rows = codexRows([
		{
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					id: "command",
					type: "CommandExecution",
					command: "false",
					status: "failed",
					exit_code: 17,
				},
			},
		},
		{
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					id: "patch",
					type: "FileChange",
					status: "completed",
					changes: {
						"file.sql": {
							type: "update",
							unified_diff: "@@ -1 +1 @@\n-old\n+new",
						},
					},
				},
			},
		},
	]);
	for (const row of rows.filter((row) => row.kind === "tool_call")) {
		expect(row.facts.extra.exit_code_components).toBeUndefined();
		expect(row.facts.extra.applied_file_changes_components).toBeUndefined();
		expect(row.facts.extra.patch_hunks_components).toBeUndefined();
	}
	expect(
		rows.find((row) => row.callId === "command" && row.kind === "tool_result")
			?.facts.extra.exit_code_components,
	).toContain('"value":17');
	expect(
		rows.find((row) => row.callId === "patch" && row.kind === "tool_result")
			?.facts.extra.applied_file_changes_components,
	).toContain('"value":"completed"');
	expect(
		rows.find((row) => row.callId === "patch" && row.kind === "tool_result")
			?.facts.extra.applied_changes,
	).toContain("file.sql");
});

test("ambiguous Claude line-level tool results do not lend facts to the first result", () => {
	const rows = [
		...splitSessionTranscript({
			source: "claude_code",
			sessionDate: "2026-10-10T00:00:00Z",
			content: JSON.stringify({
				type: "user",
				toolUseResult: { stdout: "ambiguous", numFiles: 2 },
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "one", content: "one" },
						{ type: "tool_result", tool_use_id: "two", content: "two" },
					],
				},
			}),
		}),
	];
	expect(rows.filter((row) => row.kind === "tool_result")).toHaveLength(2);
	for (const row of rows) {
		expect(row.facts.extra.stdout_chars_components).toBeUndefined();
		expect(row.facts.extra.search_result_lines_components).toBeUndefined();
	}
});

test("late failed completions do not rewrite running placeholders", () => {
	const rows = codexRows([
		{
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				call_id: "late",
				arguments: '{"cmd":"false"}',
			},
		},
		{
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "late",
				output: "Process running with session ID 123",
			},
		},
		{
			type: "event_msg",
			payload: { type: "exec_command_end", call_id: "late", exit_code: 17 },
		},
	]);
	expect(rows.find((row) => row.subtype === "running")).toMatchObject({
		exitCode: null,
		isError: false,
	});
	expect(rows.find((row) => row.subtype === "exec_command_end")).toMatchObject({
		callId: "late",
		exitCode: 17,
		isError: true,
	});
	expect(
		new Set(rows.filter((row) => row.isError).map((row) => row.callId)).size,
	).toBe(1);
});

test("bounded redaction still marks cuts and redacts credentials near the cap", () => {
	const extra = {};
	const value = `${"a".repeat(4_050)} API_KEY=sk-${"x".repeat(80)} ${"b".repeat(1_000_000)}`;
	const text = clippedText(extra, "denial_reason", value);
	expect(text.length).toBeLessThanOrEqual(4_096);
	expect(text).not.toContain(`sk-${"x".repeat(20)}`);
	expect(extra).toEqual({ facts_clipped: "denial_reason" });
});

test("only the first session metadata owns Codex stream context", () => {
	const rows = codexRows([
		{
			type: "session_meta",
			payload: {
				id: "child",
				cli_version: "child-version",
				originator: "child-origin",
				source: "subagent",
				agent_path: "/root/child",
				forked_from_id: "parent",
				subagent_history_start_ordinal: 4,
			},
		},
		{
			type: "session_meta",
			payload: {
				id: "parent",
				cli_version: "parent-version",
				originator: "parent-origin",
				agent_path: "/root",
				forked_from_id: "grandparent",
				subagent_history_start_ordinal: 100,
			},
		},
		{ type: "turn_context", ordinal: 4, payload: {} },
	]);
	expect(rows.map((row) => row.facts.agentVersion)).toEqual(
		Array(3).fill("child-version"),
	);
	expect(rows.map((row) => row.facts.entrypoint)).toEqual(
		Array(3).fill("child-origin"),
	);
	expect(rows[1]?.facts.extra.fork_replayed).toBe("true");
	expect(rows[2]?.facts.extra.fork_replayed).toBeUndefined();
});
