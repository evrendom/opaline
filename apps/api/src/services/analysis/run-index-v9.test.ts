import { describe, expect, test } from "bun:test";
import {
	codexForkParentIds,
	splitSessionTranscript,
} from "@rudel/api-routes/transcript-records";
import { forkParentCallsSql } from "../transcript-fork-replay.js";
import {
	buildUnattributedUsageStatement,
	RUN_INDEX_VERSION,
	runFactsCtes,
} from "./run-index-sql.js";
import { nativeEditToolSql, toolActivitySql } from "./tool-groups.js";

describe("parser 9 run interpretation", () => {
	test("fork links use the canonical first metadata even when its ordinal precedes child history", () => {
		const sql = runFactsCtes();
		const links = sql.slice(
			sql.indexOf("fork_links AS ("),
			sql.indexOf("parent_receipts AS ("),
		);
		expect(links).toContain("min(record_idx)");
		expect(links).toContain("kind = 'meta' AND subtype = 'session_meta'");
		expect(links).not.toContain("facts['fork_replayed'] != 'true'");
		const rows = [
			...splitSessionTranscript({
				source: "codex",
				sessionDate: "2026-10-10T00:00:00Z",
				content: [
					{
						type: "session_meta",
						ordinal: 0,
						payload: {
							id: "child",
							forked_from_id: "parent",
							subagent_history_start_ordinal: 8,
						},
					},
					{
						type: "session_meta",
						ordinal: 0,
						payload: { id: "parent", forked_from_id: "grandparent" },
					},
				]
					.map((record) => JSON.stringify(record))
					.join("\n"),
			}),
		];
		expect(rows[0]?.facts.extra.fork_replayed).toBe("true");
		expect(rows[0]?.facts.extra.parent_session_components).toContain(
			'"value":"parent"',
		);
		expect(rows[1]?.facts.extra.parent_session_components).toContain(
			'"value":"grandparent"',
		);
		expect(rows[0]?.recordIdx).toBeLessThan(rows[1]?.recordIdx ?? 0);
	});
	test("unattributed usage and run facts use identical scoped replay boundaries", () => {
		const query = buildUnattributedUsageStatement(
			{ organizationId: "org", userId: "user" },
			{
				parserVersion: 9,
				revision: "1",
				sessionId: "session",
				usageGeneration: "usage",
				source: "claude_code",
			},
		).query;
		const run = runFactsCtes();
		const bounded = (sql: string) =>
			sql.slice(
				sql.indexOf("bounded_runs AS ("),
				sql.indexOf(
					"GROUP BY session_id, agent_id, turn_idx",
					sql.indexOf("bounded_runs AS ("),
				),
			);
		expect(bounded(query)).toBe(bounded(run));
		expect(query).toContain("replayed_calls AS (");
		expect(query).toContain(
			"organization_id = {organizationId:String} AND user_id = {userId:String}",
		);
	});
	test("anonymous read and search calls fall back to their own tool group", () => {
		const sql = runFactsCtes();
		expect(sql).toContain("coalesce(nullIf(c.call_group, ''),");
		expect(sql).toContain("w.tool_name");
		expect(sql).toContain("AS read_calls");
		expect(sql).toContain("AS search_calls");
		expect(sql).not.toContain("c.call_group = 'read') AS read_calls");
	});
	test("successful custom apply_patch output retains native requested edits without a completion", () => {
		const rows = [
			...splitSessionTranscript({
				source: "codex",
				sessionDate: "2026-10-10T00:00:00Z",
				content: [
					{
						type: "response_item",
						payload: {
							type: "custom_tool_call",
							name: "apply_patch",
							call_id: "patch",
							input:
								"*** Begin Patch\n*** Update File: src/main.ts\n@@\n-old\n+new\n*** End Patch",
						},
					},
					{
						type: "response_item",
						payload: {
							type: "custom_tool_call_output",
							call_id: "patch",
							output: "Success. Updated the following files:\nM src/main.ts",
						},
					},
				]
					.map((record) => JSON.stringify(record))
					.join("\n"),
			}),
		];
		expect(rows.find((row) => row.kind === "file_change")).toMatchObject({
			callId: "patch",
			toolName: "apply_patch",
			subtype: "patch",
			fileOp: "edit",
			filePath: "src/main.ts",
		});
		expect(rows.find((row) => row.kind === "tool_result")).toMatchObject({
			callId: "patch",
			isError: false,
		});
		expect(rows.some((row) => row.kind === "meta")).toBe(false);
		expect(runFactsCtes({ literal: true })).toContain(
			"c.has_result AND NOT c.failed AND NOT c.refused AND NOT c.stopped",
		);
	});
	test("edits require confirmed outcomes and failures remain separate", () => {
		const sql = runFactsCtes({ literal: true });
		// Edit outcomes are run index 2 rules, kept by later versions.
		expect(RUN_INDEX_VERSION).toBeGreaterThanOrEqual(2);
		expect(sql).toContain("if(max(parser_version) >= 9");
		expect(sql).toContain("JSONExtractArrayRaw(applied_changes)");
		expect(sql).toContain("arrayConcat(");
		expect(sql).toContain("c.failed AND NOT c.refused) AS failed_edits");
		expect(sql).toContain("c.refused) AS refused_edits");
		expect(sql).toContain("denial_kind != '' AND denial_kind != 'interrupted'");
		expect(sql).not.toContain(
			"denial_kind NOT IN ('cancelled', 'interrupted')",
		);
		const failedEdits = sql.slice(
			sql.indexOf("uniqExactIf(w.call_id,"),
			sql.indexOf("AS failed_edits"),
		);
		expect(failedEdits).toContain("file_op IN ('write', 'edit', 'delete')");
		expect(failedEdits).toContain("subtype IN ('native', 'patch', 'nested')");
		expect(failedEdits).toContain(
			"IN ('edit', 'write', 'multiedit', 'notebookedit', 'apply_patch')",
		);
		expect(failedEdits).toContain("NOT c.stopped");
		expect(failedEdits).not.toContain("inferred_");
	});
	test("a failed or refused inline-script edit is a failed or refused edit, never an edit", () => {
		const sql = runFactsCtes({ literal: true });
		const failedEdits = sql.slice(
			sql.indexOf("uniqExactIf(w.call_id,"),
			sql.indexOf("AS failed_edits"),
		);
		// Parser 12 names the files an inline Python script writes.
		expect(failedEdits).toContain(
			"subtype = 'shell_script' AND file_op IN ('write', 'edit')",
		);
		const refusedStart = sql.indexOf("AS failed_edits");
		const refusedEdits = sql.slice(
			refusedStart,
			sql.indexOf("AS refused_edits", refusedStart),
		);
		expect(refusedEdits).toContain("subtype = 'shell_script'");
		// Its success proves no change: edits stay applied changes and native rows.
		const start = sql.indexOf("groupArrayIf(file_path,");
		expect(sql.slice(start, sql.indexOf("AS edits", start))).not.toContain(
			"shell_script",
		);
		// The conditional form keeps an inferred_ operation, which never counts.
		expect(failedEdits).not.toContain("shell_script_conditional");
	});
	test("a timeout hand-off is a timed-out call, also where no timedOutAfterMs was written", () => {
		const sql = runFactsCtes({ literal: true });
		expect(sql).toContain("facts['background_launch'] AS f_background_launch");
		const timedOut = sql.slice(
			sql.lastIndexOf("uniqExactIf(", sql.indexOf("AS l_timed_out_calls")),
			sql.indexOf("AS l_timed_out_calls"),
		);
		expect(timedOut).toContain("timed_out_after_ms IS NOT NULL");
		expect(timedOut).toContain("f_background_launch = 'timeout'");
	});
	test("a subagent stream's safety-classifier notice is a refusal; the main stream's are its records", () => {
		const sql = runFactsCtes({ literal: true });
		const refusals = sql.slice(
			sql.indexOf("AS l_retry_attempts"),
			sql.indexOf("AS l_refusals"),
		);
		expect(refusals).toContain("f_refusal_category != ''");
		// The main stream writes the notice before its model_refusal record.
		expect(refusals).toContain(
			"w.agent_id != '' AND kind = 'injected_context' AND subtype = 'safety_recovery'",
		);
	});
	test("edits also count the requested paths of native edit calls that succeeded", () => {
		const sql = runFactsCtes({ literal: true });
		const start = sql.indexOf("groupArrayIf(file_path,");
		const edits = sql.slice(start, sql.indexOf("AS edits", start));
		expect(edits).toContain("kind = 'file_change'");
		expect(edits).toContain("file_op IN ('write', 'edit', 'delete')");
		// Native tool rows only: shell-derived rows are subtype shell*.
		expect(edits).toContain("subtype IN ('native', 'patch', 'nested')");
		expect(edits).toContain(
			"IN ('edit', 'write', 'multiedit', 'notebookedit', 'apply_patch')",
		);
		expect(edits).not.toContain("'shell'");
		// A literal successful outcome: a result that is neither failed nor refused.
		expect(edits).toContain(
			"w.call_id != '' AND c.has_result AND NOT c.failed AND NOT c.refused AND NOT c.stopped",
		);
		expect(sql).toContain("max(kind = 'tool_result') AS has_result");
	});
	test("native edit tools are the edit tool group", () => {
		const sql = nativeEditToolSql("tool_name");
		for (const tool of [
			"edit",
			"write",
			"multiedit",
			"notebookedit",
			"apply_patch",
		])
			expect(sql).toContain(`'${tool}'`);
		for (const tool of ["bash", "exec_command", "exec", "read"])
			expect(sql).not.toContain(`'${tool}'`);
	});
	test("present parsed commands override heuristics even if empty or unknown", () => {
		expect(toolActivitySql("read", "fallback")).toBe(
			"if(parser_version >= 9 AND c.has_parsed_cmd, has(c.parsed_types, 'read'), fallback = 'read')",
		);
		expect(runFactsCtes()).toContain(
			"max(mapContains(facts, 'parsed_cmd_types')) AS has_parsed_cmd",
		);
	});
	test("linked completion-only errors count once and remain parser-version gated", () => {
		const sql = runFactsCtes();
		expect(sql).toContain(
			"source = 'codex' AND parser_version >= 9 AND kind = 'meta' AND call_id != ''",
		);
		expect(sql).toContain(
			"subtype IN ('exec_command_end', 'patch_apply_end') OR startsWith(subtype, 'item_completed:')",
		);
		expect(sql).toContain("uniqExactIf(if(w.call_id != ''");
		expect(sql).toContain("parser_version, source");
	});
	test("fork proof uses explicit parent IDs and scoped committed parent calls, never clocks", () => {
		const content = [
			{ type: "session_meta", payload: { id: "self", forked_from_id: "self" } },
			{
				type: "session_meta",
				payload: { id: "child", forked_from_id: "parent" },
			},
			{
				type: "session_meta",
				payload: {
					source: {
						subagent: { thread_spawn: { parent_thread_id: "not-a-fork" } },
					},
				},
			},
		]
			.map((record) => JSON.stringify(record))
			.join("\n");
		expect(codexForkParentIds(content)).toEqual(["parent"]);
		const sql = forkParentCallsSql();
		expect(sql).toContain(
			"organization_id = {organizationId:String} AND user_id = {userId:String}",
		);
		expect(sql).toContain("generation.1, generation.2 FROM parent_receipts");
		expect(sql).toContain("agent_id = '' AND kind = 'tool_call'");
		expect(sql).not.toContain("timestamp");
		expect(runFactsCtes()).toContain("f.parent_session_id = p.session_id");
		expect(runFactsCtes().match(/FROM replayed_calls\)/gu)).toHaveLength(1);
		expect(
			runFactsCtes().match(
				/\(session_id, agent_id, call_id\) NOT IN opaline_replayed_calls/gu,
			),
		).toHaveLength(3);
	});
});
