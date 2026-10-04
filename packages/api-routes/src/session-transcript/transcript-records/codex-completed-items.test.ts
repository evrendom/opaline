import { describe, expect, test } from "bun:test";
import { splitTranscript } from "./split-transcript.js";
import type { TranscriptRecordDraft } from "./types.js";

/*
 * Shapes follow Codex rollouts with code-mode `exec` scripts (anonymized):
 * the script is one `custom_tool_call`, each command it ran completes as an
 * `event_msg` `item_completed` `CommandExecution` with its own exit code, and
 * the script's output reports only "Script completed".
 */

const SESSION_DATE = "2026-08-01T10:00:00.000Z";
let second = 0;

function line(type: string, payload: Record<string, unknown>) {
	second++;
	return JSON.stringify({
		payload,
		timestamp: `2026-08-01T10:00:${String(second).padStart(2, "0")}.000Z`,
		type,
	});
}

function completed(item: Record<string, unknown>) {
	return line("event_msg", {
		completed_at_ms: 1_787_590_656_013,
		item,
		thread_id: "019e0000-0000-7000-8000-000000000001",
		turn_id: "019e0000-0000-7000-8000-000000000002",
		type: "item_completed",
	});
}

function split(lines: readonly string[]): TranscriptRecordDraft[] {
	return [
		...splitTranscript({
			content: lines.join("\n"),
			fallbackTs: SESSION_DATE,
			source: "codex",
		}),
	];
}

const prompt = line("response_item", {
	content: [{ text: "run the checks", type: "input_text" }],
	role: "user",
	type: "message",
});

const execScript = line("response_item", {
	call_id: "call_script",
	input: [
		'const a = await tools.exec_command({ cmd: "bun test src" });',
		"await tools.apply_patch({ input: `*** Begin Patch\\n*** Update File: src/app.ts\\n@@\\n-a\\n+b\\n*** End Patch` });",
	].join("\n"),
	name: "exec",
	status: "completed",
	type: "custom_tool_call",
});

const scriptOutput = line("response_item", {
	call_id: "call_script",
	output: [
		{
			text: "Script completed\nWall time 0.3 seconds\nOutput:\n",
			type: "input_text",
		},
		{ text: "1 test failed", type: "input_text" },
	],
	type: "custom_tool_call_output",
});

const failedCommand = completed({
	aggregated_output: "error: expected 1 to be 2\n1 fail",
	command: ["/bin/zsh", "-lc", "bun test src"],
	cwd: "/work/repo",
	duration: { nanos: 29_875, secs: 1 },
	exit_code: 1,
	formatted_output: "error: expected 1 to be 2\n1 fail",
	id: "exec-0198aaaa-1111-7000-8000-000000000001",
	parsed_cmd: [{ cmd: "bun test src", type: "unknown" }],
	process_id: "12345",
	source: "unified_exec_startup",
	status: "failed",
	stderr: "",
	stdout: "error: expected 1 to be 2\n1 fail",
	type: "CommandExecution",
});

describe("Codex completed items", () => {
	test("commands run inside a code-mode script become calls with their own exit codes", () => {
		const rows = split([prompt, execScript, failedCommand, scriptOutput]);
		const nested = rows.filter((row) => row.subtype === "nested");
		expect(nested.map((row) => [row.kind, row.toolName])).toEqual([
			["tool_call", "exec_command"],
			["tool_result", "exec_command"],
		]);
		const [call, result] = nested;
		expect(call?.text).toBe("bun test src");
		expect(call?.commandClass).toBe("test");
		expect(result).toMatchObject({
			callId: "exec-0198aaaa-1111-7000-8000-000000000001",
			commandClass: "test",
			exitCode: 1,
			isError: true,
			turnIdx: 1,
		});
		expect(result?.text).toContain("expected 1 to be 2");
		// The script itself completed: only the nested command failed.
		const scriptResult = rows.find(
			(row) => row.kind === "tool_result" && row.callId === "call_script",
		);
		expect(scriptResult?.isError).toBe(false);
	});

	test("an item that mirrors a recorded call stays meta and lends its outcome", () => {
		const call = line("response_item", {
			arguments: '{"query":"open issues"}',
			call_id: "call_mcp",
			name: "mcp__linear__list_issues",
			type: "function_call",
		});
		const mirror = completed({
			arguments: { query: "open issues" },
			duration: { nanos: 1, secs: 0 },
			id: "call_mcp",
			result: {
				content: [{ text: "unauthorized", type: "text" }],
				isError: true,
			},
			server: "linear",
			status: "failed",
			tool: "list_issues",
			type: "McpToolCall",
		});
		const output = line("response_item", {
			call_id: "call_mcp",
			output: "unauthorized",
			type: "function_call_output",
		});
		const rows = split([prompt, call, mirror, output]);
		expect(rows.filter((row) => row.kind === "tool_call")).toHaveLength(1);
		expect(rows.filter((row) => row.kind === "tool_result")).toHaveLength(1);
		expect(
			rows.find((row) => row.subtype === "item_completed:McpToolCall_mirror"),
		).toBeDefined();
		expect(rows.find((row) => row.kind === "tool_result")?.isError).toBe(true);
	});

	test("nested MCP and app tools without a call of their own are recorded once", () => {
		const nestedMcp = {
			arguments: { code: "1 + 1", title: "Evaluate" },
			duration: { nanos: 265_826_250, secs: 0 },
			id: "mcp-0198bbbb-2222-7000-8000-000000000002",
			readOnlyHint: true,
			result: {
				content: [{ text: "SyntaxError", type: "text" }],
				isError: true,
			},
			server: "node_repl",
			status: "failed",
			tool: "js",
			type: "McpToolCall",
		};
		const dynamic = completed({
			arguments: {},
			content_items: [{ text: "ok", type: "inputText" }],
			duration: { nanos: 1, secs: 0 },
			id: "dyn-0198cccc-3333-7000-8000-000000000003",
			namespace: "codex_app",
			status: "completed",
			success: true,
			tool: "read_thread",
			type: "DynamicToolCall",
		});
		const rows = split([
			prompt,
			execScript,
			completed(nestedMcp),
			completed(nestedMcp),
			dynamic,
		]);
		const calls = rows.filter(
			(row) => row.kind === "tool_call" && row.subtype === "nested",
		);
		expect(calls.map((row) => row.toolName)).toEqual([
			"mcp__node_repl__js",
			"codex_app.read_thread",
		]);
		const results = rows.filter(
			(row) => row.kind === "tool_result" && row.subtype === "nested",
		);
		expect(results.map((row) => [row.isError, row.text])).toEqual([
			[true, "SyntaxError"],
			[false, "ok"],
		]);
		expect(
			rows.filter((row) => row.subtype === "item_completed:McpToolCall_repeat"),
		).toHaveLength(1);
	});

	test("file changes add only the paths the script source did not already show", () => {
		const fileChange = completed({
			changes: {
				"/work/repo/src/app.ts": {
					move_path: null,
					type: "update",
					unified_diff: "@@\n-a\n+b",
				},
				"/work/repo/src/new.ts": { content: "export {}", type: "add" },
			},
			id: "patch-0198dddd-4444-7000-8000-000000000004",
			status: "completed",
			stdout:
				"Success. Updated the following files:\nM src/app.ts\nA src/new.ts",
			type: "FileChange",
		});
		const rows = split([prompt, execScript, fileChange, scriptOutput]);
		const changes = rows.filter((row) => row.kind === "file_change");
		expect(
			changes.map((row) => [row.callId, row.fileOp, row.filePath]),
		).toEqual([
			["call_script", "edit", "src/app.ts"],
			[
				"patch-0198dddd-4444-7000-8000-000000000004",
				"write",
				"/work/repo/src/new.ts",
			],
		]);
	});

	test("a failed patch the script already showed still records its failure", () => {
		const failedPatch = completed({
			changes: {
				"/work/repo/src/app.ts": { type: "update", unified_diff: "@@\n-a\n+b" },
			},
			id: "patch-0198eeee-5555-7000-8000-000000000005",
			status: "failed",
			stderr: "apply_patch verification failed: context not found",
			type: "FileChange",
		});
		const rows = split([prompt, execScript, failedPatch]);
		const result = rows.find(
			(row) =>
				row.kind === "tool_result" &&
				row.callId === "patch-0198eeee-5555-7000-8000-000000000005",
		);
		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("verification failed");
		expect(
			rows.filter(
				(row) =>
					row.kind === "file_change" &&
					row.callId === "patch-0198eeee-5555-7000-8000-000000000005",
			),
		).toHaveLength(0);
	});

	test("a native web search counts once: the completion carries results, the call is its mirror", () => {
		const search = completed({
			action: {
				queries: ["bun test retries", "bun test flaky"],
				query: "bun test retries",
				type: "search",
			},
			id: "ws_0c6fcf66a4bc10780000000000000000000000000000000000",
			query: "bun test retries",
			results: [
				{
					domain: "bun.sh",
					ref_id: "turn0search0",
					snippet: "Retry failed tests",
					title: "bun test",
					type: "search_result",
					url: "https://bun.sh/docs/cli/test",
				},
			],
			type: "WebSearch",
		});
		const mirror = line("response_item", {
			action: { query: "bun test retries", type: "search" },
			status: "completed",
			type: "web_search_call",
		});
		const later = line("response_item", {
			action: { query: "unrelated", type: "search" },
			status: "completed",
			type: "web_search_call",
		});
		const rows = split([prompt, search, mirror, prompt, later]);
		const searches = rows.filter(
			(row) => row.kind === "tool_call" && row.toolName === "web_search",
		);
		expect(searches.map((row) => row.text)).toEqual([
			"bun test retries",
			"unrelated",
		]);
		expect(
			rows.find(
				(row) => row.kind === "tool_result" && row.toolName === "web_search",
			)?.text,
		).toBe("bun test — https://bun.sh/docs/cli/test — Retry failed tests");
		expect(rows.some((row) => row.subtype === "web_search_call_mirror")).toBe(
			true,
		);
	});

	test("message and reasoning completions mirror their response items", () => {
		const rows = split([
			prompt,
			completed({
				content: [{ text: "Done.", type: "text" }],
				id: "msg_1",
				phase: "final",
				type: "AgentMessage",
			}),
		]);
		expect(rows.at(-1)).toMatchObject({
			kind: "meta",
			subtype: "item_completed:AgentMessage",
			text: "",
		});
	});
});
