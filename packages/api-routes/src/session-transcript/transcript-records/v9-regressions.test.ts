import { describe, expect, test } from "bun:test";
import { appliedChangesFacts } from "./applied-changes.js";
import {
	claudeInstructionFacts,
	claudeSystemFacts,
	claudeToolResultFacts,
	codexItemFacts,
} from "./record-facts.js";
import { splitSessionTranscript } from "./split-transcript.js";
import type { TranscriptSource } from "./types.js";

export const V9_REGRESSION_COVERAGE = {
	claude_code: [
		"facts_clipped",
		"attribution_mcp_server",
		"attribution_mcp_tool",
		"file_change_basis",
		"files_found",
		"search_mode",
		"search_matches",
		"search_result_lines",
		"shell_edit_changed_files_more",
		"hook_errors_more",
		"hook_runs_more",
		"instruction_paths_more",
		"applied_changes",
		"applied_changes_more",
	],
	codex: [
		"facts_clipped",
		"file_change_basis",
		"spawned_thread_ids",
		"spawned_thread_ids_more",
		"parsed_cmd_read_paths_more",
		"parsed_cmd_types_more",
		"permission_profile",
		"permission_profile_id",
		"applied_changes",
		"applied_changes_more",
		"fork_replayed",
		"patch_lines_added",
		"patch_lines_removed",
	],
} as const;
function rows(source: TranscriptSource, records: Record<string, unknown>[]) {
	return [
		...splitSessionTranscript({
			source,
			content: records
				.map((record) =>
					JSON.stringify({ timestamp: "2026-10-09T10:00:00.000Z", ...record }),
				)
				.join("\n"),
			sessionDate: "2026-10-09T10:00:00.000Z",
		}),
	];
}
const call = (
	id: string,
	name = "exec_command",
	argumentsValue: unknown = { cmd: "true" },
) => ({
	type: "response_item",
	payload: {
		type: "function_call",
		name,
		call_id: id,
		arguments: JSON.stringify(argumentsValue),
	},
});
const output = (id: string, text: string) => ({
	type: "response_item",
	payload: { type: "function_call_output", call_id: id, output: text },
});

describe("parser 9 regressions", () => {
	test("completion-only failures stay linked without changing earlier outputs", () => {
		const parsed = rows("codex", [
			call("edit", "apply_patch", {
				input: "*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch",
			}),
			{
				type: "event_msg",
				payload: { type: "patch_apply_end", call_id: "edit", success: false },
			},
			call("mcp", "mcp__server__tool"),
			output("mcp", "No error in the textual output"),
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						id: "mcp",
						type: "McpToolCall",
						status: "completed",
						result: { isError: true },
					},
				},
			},
			call("command"),
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						id: "command",
						type: "CommandExecution",
						status: "failed",
						exit_code: 0,
					},
				},
			},
		]);
		expect(
			parsed.find((row) => row.callId === "edit" && row.kind === "meta")
				?.isError,
		).toBe(true);
		expect(
			parsed.find((row) => row.callId === "mcp" && row.kind === "tool_result")
				?.isError,
		).toBe(false);
		expect(
			parsed.find((row) => row.callId === "mcp" && row.kind === "meta")
				?.isError,
		).toBe(true);
		expect(
			parsed.find((row) => row.callId === "command" && row.kind === "meta"),
		).toMatchObject({ isError: true, exitCode: 0 });
		expect(parsed.filter((row) => row.kind === "tool_call")).toHaveLength(3);
	});
	test("a successful native MCP completion with a null error is not failed", () => {
		const parsed = rows("codex", [
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						id: "native",
						type: "McpToolCall",
						server: "server",
						tool: "tool",
						status: "completed",
						error: null,
						result: { isError: false },
					},
				},
			},
		]);
		expect(parsed.find((row) => row.kind === "tool_result")?.isError).toBe(
			false,
		);
	});
	test("parent database call IDs never alter literal replay facts", () => {
		const records = [
			{
				type: "session_meta",
				payload: { id: "child", forked_from_id: "parent" },
			},
			call("replayed"),
			output("replayed", "Process exited with code 0"),
			call("fresh"),
			output("fresh", "Process exited with code 0"),
		];
		const content = records.map((record) => JSON.stringify(record)).join("\n");
		const input = {
			source: "codex" as const,
			content,
			sessionDate: "2026-10-09T10:00:00Z",
		};
		const before = [...splitSessionTranscript(input)];
		const after = [
			...splitSessionTranscript({
				...input,
				codexForkParentCalls: { parent: ["replayed"], unrelated: ["fresh"] },
			}),
		];
		expect(
			after.map((row) => [row.recordIdx, row.blockIdx, row.kind, row.callId]),
		).toEqual(
			before.map((row) => [row.recordIdx, row.blockIdx, row.kind, row.callId]),
		);
		expect(
			after
				.filter((row) => row.facts.extra.fork_replayed === "true")
				.map((row) => row.callId),
		).toEqual([]);
		expect(
			before.every((row) => row.facts.extra.fork_replayed === undefined),
		).toBe(true);
	});
	test("native completion-only rows do not use database-dependent replay markers", () => {
		const completion = (id: string) => ({
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "CommandExecution",
					id,
					command: "false",
					status: "failed",
					exit_code: 1,
					aggregated_output: "literal failure",
				},
			},
		});
		const parentCallIds = rows("codex", [completion("native")])
			.filter((row) => row.kind === "tool_call")
			.map((row) => row.callId);
		expect(parentCallIds).toEqual(["native"]);
		const input = {
			source: "codex" as const,
			sessionDate: "2026-10-09T10:00:00Z",
			content: [
				{
					type: "session_meta",
					payload: { id: "child", forked_from_id: "parent" },
				},
				completion("native"),
				completion("fresh"),
			]
				.map((record) => JSON.stringify(record))
				.join("\n"),
		};
		const before = [...splitSessionTranscript(input)];
		const after = [
			...splitSessionTranscript({
				...input,
				codexForkParentCalls: { parent: parentCallIds },
			}),
		];
		expect(
			after.map((row) => [row.recordIdx, row.blockIdx, row.kind, row.callId]),
		).toEqual(
			before.map((row) => [row.recordIdx, row.blockIdx, row.kind, row.callId]),
		);
		expect(
			after
				.filter((row) => row.facts.extra.fork_replayed === "true")
				.map((row) => [row.kind, row.callId]),
		).toEqual([]);
		expect(
			after
				.filter((row) => row.callId === "fresh")
				.every((row) => row.facts.extra.fork_replayed === undefined),
		).toBe(true);
		expect(
			after.find((row) => row.callId === "native" && row.kind === "tool_result")
				?.isError,
		).toBe(true);
	});
	test("MCP identities come only from each call name, retaining line attribution separately", () => {
		const parsed = rows("claude_code", [
			{
				type: "assistant",
				attributionMcpServer: "line-server",
				attributionMcpTool: "line-tool",
				message: {
					content: [
						{
							type: "tool_use",
							id: "bash",
							name: "Bash",
							input: { command: "true" },
						},
						{
							type: "tool_use",
							id: "mcp",
							name: "mcp__opaline__find",
							input: {},
						},
					],
				},
			},
			{
				type: "user",
				message: {
					content: [{ type: "tool_result", tool_use_id: "mcp", content: "ok" }],
				},
			},
		]);
		const bash = parsed.find(
			(row) => row.callId === "bash" && row.kind === "tool_call",
		);
		expect(bash?.facts.mcpServer).toBe("");
		expect(bash?.facts.extra).toMatchObject({
			attribution_mcp_server: "line-server",
			attribution_mcp_tool: "line-tool",
		});
		for (const row of parsed.filter((row) => row.callId === "mcp"))
			expect(row.facts).toMatchObject({
				mcpServer: "opaline",
				mcpTool: "find",
			});
	});
	test("refusals, transport failures, argument failures, image failures and aborts are failed calls", () => {
		const explicitlyFailed = rows("codex", [
			call("contradictory"),
			output("contradictory", "Process exited with code 0"),
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "CommandExecution",
						id: "contradictory",
						status: "failed",
						exit_code: 0,
					},
				},
			},
		]);
		expect(explicitlyFailed.find((row) => row.kind === "meta")?.isError).toBe(
			true,
		);
		for (const text of [
			'exec_command failed: CreateProcess { message: "Rejected(\\"rejected by user\\")" }',
			"Error parsing function call: Could not parse args as JSON",
			"tool call failed: transport error",
			"unable to open image at /missing",
			"aborted by user after 1s",
		]) {
			const result = rows("codex", [
				call("failed"),
				output("failed", text),
			]).find((row) => row.kind === "tool_result");
			expect(result?.isError).toBe(true);
		}
		const reason = "x".repeat(5000);
		const rejected = `exec_command failed: CreateProcess { message: ${JSON.stringify(`Rejected(${JSON.stringify(reason)})`)} }`;
		const denial = rows("codex", [
			call("denied"),
			output("denied", rejected),
		]).find((row) => row.kind === "tool_result");
		expect(denial?.facts.extra.denial_reason?.length).toBe(4096);
		expect(denial?.facts.extra.facts_clipped).toContain("denial_reason");
	});
	test("late completed exit codes stay within their agent stream and retain identities", () => {
		const parsed = rows("codex", [
			call("late"),
			output("late", "Process running with session ID 7"),
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "CommandExecution",
						id: "late",
						exit_code: 17,
						status: "failed",
					},
				},
			},
		]);
		const running = parsed.find((row) => row.kind === "tool_result");
		expect(running).toMatchObject({
			subtype: "running",
			exitCode: null,
			isError: false,
		});
		expect(parsed.find((row) => row.kind === "meta")).toMatchObject({
			exitCode: 17,
			isError: true,
		});
	});
	test("only started activity records spawn ids, while named permission ids remain separate from kinds", () => {
		const parsed = rows("codex", [
			{
				type: "turn_context",
				payload: {
					permission_profile: { type: "managed" },
					active_permission_profile: { id: ":workspace" },
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						id: "start",
						type: "SubAgentActivity",
						kind: "started",
						agent_thread_id: "child",
					},
				},
			},
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						id: "wait",
						type: "SubAgentActivity",
						kind: "interacted",
						agent_thread_id: "child",
					},
				},
			},
		]);
		expect(
			parsed.find((row) => row.subtype === "turn_context")?.facts.extra,
		).toMatchObject({
			permission_profile: "managed",
			permission_profile_id: ":workspace",
			permission_profile_kind: "managed",
		});
		expect(
			parsed.some((row) => row.facts.extra.spawned_thread_ids === '["child"]'),
		).toBe(true);
		expect(
			parsed.find((row) => row.callId === "wait")?.facts.extra
				.spawned_thread_ids,
		).toBeUndefined();
	});
	test("requested mutations and confirmed applied changes are independent", () => {
		const changes = { "src/file.ts": { type: "add", content: "one\ntwo\n" } };
		const refused = rows("codex", [
			call(
				"patch",
				"apply_patch",
				"*** Begin Patch\n*** Add File: src/file.ts\n+one\n*** End Patch",
			),
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: { type: "FileChange", id: "patch", status: "failed", changes },
				},
			},
		]);
		expect(
			refused
				.filter((row) => row.kind === "file_change")
				.every((row) => row.facts.extra.file_change_basis === "requested"),
		).toBe(true);
		expect(
			refused.every((row) => row.facts.extra.applied_changes === undefined),
		).toBe(true);
		const applied = rows("codex", [
			{
				type: "event_msg",
				payload: {
					type: "item_completed",
					item: {
						type: "FileChange",
						id: "patch",
						status: "completed",
						changes,
					},
				},
			},
		]);
		expect(
			applied.some((row) =>
				row.facts.extra.applied_changes?.includes("src/file.ts"),
			),
		).toBe(true);
		expect(
			applied.some(
				(row) =>
					row.facts.extra.patch_lines_added === "2" &&
					row.facts.extra.patch_lines_removed === "0",
			),
		).toBe(true);
		const write = rows("claude_code", [
			{
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "write",
							name: "Write",
							input: { file_path: "new.txt", content: "one\ntwo\n" },
						},
					],
				},
			},
			{
				type: "user",
				toolUseResult: {
					type: "create",
					filePath: "new.txt",
					content: "one\ntwo\n",
					structuredPatch: [],
				},
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "write", content: "created" },
					],
				},
			},
		]);
		expect(
			write.find((row) => row.kind === "file_change")?.facts.extra
				.file_change_basis,
		).toBe("requested");
		expect(
			write.find((row) => row.kind === "tool_result")?.facts.extra,
		).toMatchObject({
			patch_lines_added: "2",
			patch_lines_removed: "0",
			applied_changes: '[{"path":"new.txt","type":"create"}]',
		});
	});
	test("search counts preserve files and matches independently by recorded mode", () => {
		for (const mode of ["files_with_matches", "count", "content"]) {
			const facts = claudeToolResultFacts(
				{ mode, numFiles: 3, numMatches: 7, numLines: 9 },
				undefined,
			);
			expect(facts.extra).toMatchObject({
				search_matches: "7",
				search_result_lines: "9",
				files_found: "3",
				search_mode: mode,
			});
		}
	});
	test("fork replay marks only exact inherited ordinals without changing identities", () => {
		const records = [
			{
				type: "session_meta",
				payload: {
					id: "child",
					forked_from_id: "parent",
					forked_from_ordinal_exclusive: 4,
				},
			},
			{ ...call("replayed"), ordinal: 3 },
			{ ...call("new"), ordinal: 4 },
			output("replayed", "ok"),
			output("new", "ok"),
		];
		const parsed = rows("codex", records);
		expect(
			parsed
				.filter((row) => row.callId === "replayed" && row.kind === "tool_call")
				.every((row) => row.facts.extra.fork_replayed === "true"),
		).toBe(true);
		expect(
			parsed
				.filter((row) => row.callId === "new")
				.every((row) => row.facts.extra.fork_replayed === undefined),
		).toBe(true);
		const plain = rows(
			"codex",
			records.map((record) =>
				record.type === "session_meta"
					? { ...record, payload: { id: "child" } }
					: record,
			),
		);
		expect(
			parsed.map((row) => [
				row.recordIdx,
				row.blockIdx,
				row.kind,
				row.callId,
				row.subtype,
			]),
		).toEqual(
			plain.map((row) => [
				row.recordIdx,
				row.blockIdx,
				row.kind,
				row.callId,
				row.subtype,
			]),
		);
	});
	test("generous list caps still report omitted entries across existing and applied lists", () => {
		const exactOmissions = (
			encoded: string | undefined,
			omitted: string | undefined,
		) => {
			if (encoded === undefined || omitted === undefined)
				throw new Error("Missing list or omission count");
			const kept: unknown = JSON.parse(encoded);
			if (!Array.isArray(kept)) throw new Error("Invalid list");
			expect(Number(omitted)).toBe(2000 - kept.length);
		};
		const paths = Array.from(
			{ length: 2000 },
			(_, index) => `/${index}${"x".repeat(200)}`,
		);
		const read = codexItemFacts({
			type: "CommandExecution",
			parsed_cmd: paths.map((path) => ({ type: "read", path })),
		});
		expect(Number(read.extra?.parsed_cmd_read_paths_more)).toBeGreaterThan(0);
		exactOmissions(
			read.extra?.parsed_cmd_read_paths,
			read.extra?.parsed_cmd_read_paths_more,
		);
		const typed = codexItemFacts({
			type: "CommandExecution",
			parsed_cmd: paths.map((type) => ({ type })),
		});
		expect(Number(typed.extra?.parsed_cmd_types_more)).toBeGreaterThan(0);
		exactOmissions(
			typed.extra?.parsed_cmd_types,
			typed.extra?.parsed_cmd_types_more,
		);
		const spawn = codexItemFacts({
			type: "CollabAgentToolCall",
			tool: "spawn_agent",
			receiver_thread_ids: paths,
		});
		expect(Number(spawn.extra?.spawned_thread_ids_more)).toBeGreaterThan(0);
		exactOmissions(
			spawn.extra?.spawned_thread_ids,
			spawn.extra?.spawned_thread_ids_more,
		);
		const hooks = claudeSystemFacts({
			subtype: "stop_hook_summary",
			hookErrors: paths,
			hookInfos: paths.map((command) => ({ command })),
		});
		expect(Number(hooks.extra?.hook_errors_more)).toBeGreaterThan(0);
		expect(Number(hooks.extra?.hook_runs_more)).toBeGreaterThan(0);
		exactOmissions(hooks.extra?.hook_errors, hooks.extra?.hook_errors_more);
		exactOmissions(hooks.extra?.hook_runs, hooks.extra?.hook_runs_more);
		const instructions = claudeInstructionFacts({
			files: paths.map((path) => ({ path })),
		});
		expect(Number(instructions.extra?.instruction_paths_more)).toBeGreaterThan(
			0,
		);
		exactOmissions(
			instructions.extra?.instruction_paths,
			instructions.extra?.instruction_paths_more,
		);
		const shell = claudeToolResultFacts(
			{
				bashEditDiff: {
					files: paths.map((filePath) => ({ filePath })),
					changedFiles: paths,
				},
			},
			undefined,
		);
		expect(Number(shell.extra?.shell_edit_changed_files_more)).toBeGreaterThan(
			0,
		);
		exactOmissions(
			shell.extra?.shell_edit_changed_files,
			shell.extra?.shell_edit_changed_files_more,
		);
		const changes = appliedChangesFacts(
			Object.fromEntries(paths.map((path) => [path, { type: "add" }])),
			true,
		);
		expect(Number(changes.extra?.applied_changes_more)).toBeGreaterThan(0);
		exactOmissions(
			changes.extra?.applied_changes,
			changes.extra?.applied_changes_more,
		);
		expect(changes.extra?.facts_clipped).toContain("applied_changes");
		expect(appliedChangesFacts({}, true).extra?.applied_changes).toBe("[]");
	});
});
