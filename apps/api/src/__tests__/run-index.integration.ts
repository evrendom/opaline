import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	NO_TRANSCRIPT_RECORD_FACTS,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptRecordDraft,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { readCommittedRunIndex } from "../services/analysis/run-index-reader.js";
import { RUN_INDEX_VERSION } from "../services/analysis/run-index-sql.js";
import { queryRunFacts } from "../services/analysis/run-queries.js";
import { runNodeId } from "../services/l1-edges/l1-edge-ids.js";
import {
	enqueueL1EdgeDependents,
	enqueueL1EdgeScope,
	recordL1EdgeDependencies,
} from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import { runRunIndexRetirementPass } from "../services/l1-edges/run-index-retirement.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
} from "../services/transcript-records-ingest.service.js";

setDefaultTimeout(180_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `run_index_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const userId = `${RUN}_user`;
const claudeSession = `${RUN}_claude`;
const codexSession = `${RUN}_codex`;
const legacySession = `${RUN}_v5`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
const scope = { organizationId, userId };
const identityOf = (sessionId: string, source: TranscriptSource) => ({
	userId,
	source,
	sessionId,
});

/** Builds this test's scopes only: other suites' extractions queue theirs too. */
const pass = async (
	afterRunIndexBuilt?: Parameters<
		typeof runL1EdgePass
	>[0]["afterRunIndexBuilt"],
) => {
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id <> $1",
		[organizationId],
	);
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
		afterRunIndexBuilt,
		sources: {
			executor: clickhouse,
			access: async () => ({
				visibility: "visible" as const,
				bindings: [],
				repositories: new Map(),
			}),
			evidence: async () => ({ snapshots: [], captures: [] }),
		},
	});
};
const queueRunIndex = (sessionId: string, source: TranscriptSource) =>
	enqueueL1EdgeScope(sqlClient, {
		kind: "run_index",
		organizationId,
		...identityOf(sessionId, source),
	});

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.usage_events",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = $1",
		[userId],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

async function fixture(name: string): Promise<string> {
	return Bun.file(
		new URL(
			`../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${name}`,
			import.meta.url,
		),
	).text();
}

/**
 * Publishes a committed transcript-records generation. A parser 5
 * generation has the same records without the facts parser 6 to 8 store.
 */
async function publish(
	sessionId: string,
	source: TranscriptSource,
	content: string,
	revision: string,
	parserVersion = TRANSCRIPT_RECORDS_PARSER_VERSION,
): Promise<TranscriptRecordDraft[]> {
	const identity = {
		organizationId,
		userId,
		sessionId,
		source,
		revision,
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const drafts = [
		...splitSessionTranscript(
			{ content, sessionDate: SESSION_DATE, source },
			stats,
		),
	];
	const rows = drafts.map((draft) =>
		parserVersion === TRANSCRIPT_RECORDS_PARSER_VERSION
			? buildTranscriptRecordRow(identity, draft)
			: {
					...buildTranscriptRecordRow(identity, {
						...draft,
						facts: NO_TRANSCRIPT_RECORD_FACTS,
					}),
					parser_version: parserVersion,
				},
	);
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	return drafts;
}

/** The committed snapshot, as every reader reads it. */
const runIndexRows = (sessionId: string) =>
	readCommittedRunIndex(clickhouse, scope, [sessionId]);
/** Every stored snapshot of a session (generation and build), committed or not. */
const snapshotsOf = async (sessionId: string) =>
	(
		await clickhouse.query<{ snapshot: string }>({
			query: `SELECT DISTINCT concat(toString(revision), '/', toString(build_revision)) AS snapshot
				FROM rudel.run_index
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String}
				ORDER BY snapshot`,
			query_params: { organizationId, userId, sessionId },
		})
	).map((row) => row.snapshot);
const runsOf = async (sessionId: string) =>
	(await runIndexRows(sessionId)).filter((row) => row.row_kind === "run");
const receiptOf = async (sessionId: string) =>
	(await runIndexRows(sessionId)).find((row) => row.row_kind === "receipt");
const scopeOf = async (sessionId: string, source: string) =>
	(
		await sqlClient.unsafe<
			{
				request_count: number;
				built_request_count: number;
				resolver_version: number | null;
				frozen_reason: string | null;
			}[]
		>(
			`SELECT request_count::int AS request_count, built_request_count::int AS built_request_count,
				resolver_version, frozen_reason
			 FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'run_index' AND scope_id = $2`,
			[
				organizationId,
				`${encodeURIComponent(userId)}/${source}/${encodeURIComponent(sessionId)}`,
			],
		)
	)[0];
/** Columns that differ between two builds of the same generation. */
const withoutBuild = (row: RudelRunIndexRow) => {
	const { build_revision: _, built_at: __, usage_receipt: ___, ...rest } = row;
	return rest;
};

/** A Claude Code main-stream line of a not-found session, one second apart. */
const claudeLine = (second: number, line: Record<string, unknown>) =>
	JSON.stringify({
		sessionId: "not-found",
		cwd: "/repo",
		version: "2.1.292",
		entrypoint: "cli",
		timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, second)).toISOString(),
		...line,
	});
const claudeCall = (
	second: number,
	id: string,
	name: string,
	input: Record<string, unknown>,
) =>
	claudeLine(second, {
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name, input }],
		},
	});
const claudeResult = (
	second: number,
	id: string,
	content: string,
	isError: boolean,
	toolUseResult: unknown,
) =>
	claudeLine(second, {
		type: "user",
		message: {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: id, content, is_error: isError },
			],
		},
		toolUseResult,
	});
/**
 * One run, read by hand: 2 reads and 7 searches, of which a Read of a
 * missing file, a Grep with no files, an rg whose exit code Claude Code
 * reads as "No matches found" (it also printed `done`), a find that printed
 * nothing, a grep that printed only its exit code and a grep whose file pattern the shell
 * matched to nothing found nothing (6). The Grep that found a file and the
 * cat of an empty file found something, and `rg -q` prints nothing either
 * way.
 */
const CLAUDE_NOT_FOUND = [
	claudeLine(0, {
		type: "user",
		message: { role: "user", content: "find the config" },
	}),
	claudeCall(1, "toolu_read", "Read", { file_path: "/repo/config.yml" }),
	claudeResult(
		2,
		"toolu_read",
		"<tool_use_error>File does not exist. Note: your current working directory is /repo.</tool_use_error>",
		true,
		"Error: File does not exist. Note: your current working directory is /repo.",
	),
	claudeCall(3, "toolu_grep", "Grep", {
		pattern: "config",
		output_mode: "files_with_matches",
	}),
	claudeResult(4, "toolu_grep", "No files found", false, {
		mode: "files_with_matches",
		filenames: [],
		numFiles: 0,
	}),
	claudeCall(5, "toolu_rg", "Bash", {
		command: "rg -n 'loadConfig' src; echo done",
	}),
	claudeResult(6, "toolu_rg", "done", false, {
		stdout: "done",
		stderr: "",
		interrupted: false,
		isImage: false,
		returnCodeInterpretation: "No matches found",
	}),
	claudeCall(7, "toolu_find", "Bash", { command: "find . -name 'config.*'" }),
	claudeResult(8, "toolu_find", "(Bash completed with no output)", false, {
		stdout: "",
		stderr: "",
		interrupted: false,
		isImage: false,
	}),
	claudeCall(9, "toolu_grep_env", "Bash", { command: "grep -rn 'PORT' .env" }),
	claudeResult(10, "toolu_grep_env", "Exit code 1", true, "Error: Exit code 1"),
	claudeCall(11, "toolu_found", "Grep", { pattern: "PORT" }),
	claudeResult(12, "toolu_found", "Found 1 file\nsrc/server.ts", false, {
		mode: "files_with_matches",
		filenames: ["src/server.ts"],
		numFiles: 1,
	}),
	claudeCall(13, "toolu_cat", "Bash", { command: "cat src/empty.ts" }),
	claudeResult(14, "toolu_cat", "(Bash completed with no output)", false, {
		stdout: "",
		stderr: "",
		interrupted: false,
		isImage: false,
	}),
	claudeCall(15, "toolu_glob", "Bash", {
		command: "grep -rn 'PORT' --include=*.env .",
	}),
	claudeResult(
		16,
		"toolu_glob",
		"(eval):1: no matches found: --include=*.env",
		false,
		{
			stdout: "",
			stderr: "(eval):1: no matches found: --include=*.env",
			interrupted: false,
			isImage: false,
		},
	),
	claudeCall(17, "toolu_quiet", "Bash", { command: "rg -q PORT src" }),
	claudeResult(18, "toolu_quiet", "(Bash completed with no output)", false, {
		stdout: "",
		stderr: "",
		interrupted: false,
		isImage: false,
	}),
].join("\n");

/** A Codex exec call with its completion (parsed command, exit code) and output. */
const codexExec = (
	minute: number,
	id: string,
	cmd: string,
	type: "read" | "search",
	exitCode: number,
	output: string,
) => {
	const at = (second: number) =>
		new Date(Date.UTC(2026, 9, 1, 10, minute, second)).toISOString();
	return [
		{
			timestamp: at(0),
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				arguments: JSON.stringify({ cmd }),
				call_id: id,
			},
		},
		{
			timestamp: at(1),
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "CommandExecution",
					id,
					command: ["/bin/zsh", "-lc", cmd],
					cwd: "/repo",
					status: exitCode === 0 ? "completed" : "failed",
					stdout: exitCode === 0 ? output : "",
					stderr: exitCode === 0 ? "" : output,
					aggregated_output: output,
					exit_code: exitCode,
					duration: { secs: 0, nanos: 1_000_000 },
					parsed_cmd: [{ type, cmd }],
				},
			},
		},
		{
			timestamp: at(2),
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: id,
				output: `Chunk ID: ${id}\nWall time: 0.0100 seconds\nProcess exited with code ${exitCode}\nOriginal token count: ${output === "" ? 0 : 9}\nOutput:\n${output}`,
			},
		},
	];
};
/**
 * One run, read by hand: an rg with no match (exit 1), a find that printed
 * nothing and a cat of a missing file found nothing (3); an rg that matched
 * found something.
 */
const CODEX_NOT_FOUND = [
	{
		timestamp: "2026-10-01T10:00:00.000Z",
		type: "session_meta",
		payload: {
			id: "not-found-codex",
			cli_version: "0.156.0",
			originator: "codex_exec",
			source: "exec",
			thread_source: "user",
		},
	},
	{
		timestamp: "2026-10-01T10:00:30.000Z",
		type: "response_item",
		payload: {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "find the config loader" }],
		},
	},
	...codexExec(1, "call_rg", "rg -n loadConfig src", "search", 1, ""),
	...codexExec(2, "call_find", "find . -name 'config.*'", "search", 0, ""),
	...codexExec(
		3,
		"call_cat",
		"cat src/config.ts",
		"read",
		1,
		"cat: src/config.ts: No such file or directory",
	),
	...codexExec(
		4,
		"call_hit",
		"rg -n PORT src",
		"search",
		0,
		"src/server.ts:3:const PORT = 80",
	),
]
	.map((line) => JSON.stringify(line))
	.join("\n");

test("the worker indexes runs literally, keeps them through rebuilds and expiry, and is fenced by purges", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Runs', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Runs', $1)",
		[organizationId],
	);
	const claude = await fixture("claude-2.1.jsonl");
	const codex = await fixture("codex-0.156.jsonl");
	const claudeDrafts = await publish(claudeSession, "claude_code", claude, "1");
	const codexDrafts = await publish(codexSession, "codex", codex, "1");
	await publish(legacySession, "claude_code", claude, "1", 5);

	await queueRunIndex(claudeSession, "claude_code");
	await queueRunIndex(codexSession, "codex");
	await queueRunIndex(legacySession, "claude_code");
	expect(await pass()).toBe(3);

	// Run ids and starts are the edges': min(record_idx) per stream and turn.
	for (const [sessionId, source] of [
		[claudeSession, "claude_code"],
		[codexSession, "codex"],
	] as const) {
		const starts = await clickhouse.query<{
			agent_id: string;
			start_record: number;
		}>({
			query: `SELECT agent_id, min(record_idx) AS start_record
				FROM rudel.transcript_records FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id = {sessionId:String} AND revision = 1
					AND parser_version = {parserVersion:UInt16} AND turn_idx >= 1
				GROUP BY agent_id, turn_idx ORDER BY agent_id, start_record`,
			query_params: {
				organizationId,
				userId,
				sessionId,
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			},
		});
		expect((await runsOf(sessionId)).map((run) => run.run_id)).toEqual(
			starts.map((start) =>
				runNodeId(
					identityOf(sessionId, source),
					start.agent_id,
					start.start_record,
				),
			),
		);
	}

	// find computes the same runs at query time: the statements are shared.
	const claudeRuns = await runsOf(claudeSession);
	const found = await queryRunFacts(clickhouse, scope, [
		{
			sessionId: claudeSession,
			revision: "1",
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		},
	]);
	expect(
		claudeRuns.map((run) => [
			run.agent_id,
			run.turn_idx,
			run.start_record,
			run.tool_calls,
			run.failed_calls,
			run.edits,
			run.reads,
			run.searches,
			run.not_found,
			Number(run.raw_chars),
			run.genuine_prompts,
			run.prompt_head,
			run.minutes,
			run.active_minutes,
		]),
	).toEqual(
		found
			.sort(
				(a, b) =>
					a.agent_id.localeCompare(b.agent_id) ||
					a.first_record - b.first_record,
			)
			.map((run) => [
				run.agent_id,
				run.turn_idx,
				run.first_record,
				run.tool_calls,
				run.failed_calls,
				run.edits,
				run.read_calls,
				run.search_calls,
				run.not_found,
				run.raw_chars,
				run.genuine_prompt,
				run.prompt_head,
				run.minutes,
				run.active_minutes,
			]),
	);

	// Reads and searches that found nothing, against runs read by hand.
	const claudeNotFound = `${RUN}_claude_not_found`;
	const codexNotFound = `${RUN}_codex_not_found`;
	const legacyNotFound = `${RUN}_v5_not_found`;
	await publish(claudeNotFound, "claude_code", CLAUDE_NOT_FOUND, "1");
	await publish(codexNotFound, "codex", CODEX_NOT_FOUND, "1");
	await publish(legacyNotFound, "claude_code", CLAUDE_NOT_FOUND, "1", 5);
	await queueRunIndex(claudeNotFound, "claude_code");
	await queueRunIndex(codexNotFound, "codex");
	await queueRunIndex(legacyNotFound, "claude_code");
	expect(await pass()).toBe(3);
	const counts = async (sessionId: string) =>
		(await runsOf(sessionId)).map((run) => [
			run.reads,
			run.searches,
			run.not_found,
		]);
	expect(await counts(claudeNotFound)).toEqual([[2, 7, 6]]);
	expect(await counts(codexNotFound)).toEqual([[1, 3, 3]]);
	// Parser 5 kept no returnCodeInterpretation, so the count is unknown, not 0.
	expect(await counts(legacyNotFound)).toEqual([[2, 7, null]]);
	expect((await runsOf(legacyNotFound))[0]?.unrecorded_facts).toContain(
		"not_found",
	);
	expect(
		(
			await queryRunFacts(clickhouse, scope, [
				{
					sessionId: claudeNotFound,
					revision: "1",
					parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				},
				{
					sessionId: codexNotFound,
					revision: "1",
					parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				},
			])
		)
			.map((run) => run.not_found)
			.sort(),
	).toEqual([3, 6]);

	// Claude Code parser 8: facts copied from the run's own records.
	const [first, second] = claudeRuns;
	expect(first).toMatchObject({
		start_record: 1,
		agent_version: "2.1.292",
		entrypoint: "sdk-ts",
		skills: ["ship-it"],
		git_operations: ["branch", "commit", "pr", "push"],
		pushed_branches: ["fix/login"],
		commit_shas: ["4f2a9c1"],
		pr_urls: ["https://github.com/acme/app/pull/42"],
		mcp_servers: ["posthog"],
		mcp_calls: 1,
		permission_mode: "",
		// Codex-only facts are unknown for Claude Code, never empty.
		approval_policy: null,
		goal: null,
		duration_ms: null,
		cost_usd: null,
		usage_observations: 0,
		prompt_origin_basis: "wrapper",
	});
	expect(first?.unrecorded_facts).toContain("approval_policy");
	expect(first?.unrecorded_facts).not.toContain("skills");
	const claudeFact = (record: number, key: string) =>
		(
			claudeDrafts.find((draft) => draft.recordIdx === record)?.facts
				.extra as Record<string, string>
		)[key];
	expect(second).toMatchObject({
		start_record: 37,
		permission_mode: "plan",
		permission_modes: ["plan"],
		model: "claude-opus-5-5",
		effort: "xhigh",
		per_turn_effort: "high",
		stop_reason: "end_turn",
		aborted: "false",
		api_errors: 1,
		api_error: "rate_limit",
		api_error_statuses: ["429"],
		retry_attempts: 1,
		refusals: 1,
		fallback_model: claudeFact(42, "fallback_model"),
		prevented_continuation: claudeFact(43, "prevented_continuation"),
		hook_count: Number(claudeFact(43, "hook_count")),
		hook_stop_reason: claudeFact(43, "hook_stop_reason"),
		compactions: 1,
		compact_trigger: claudeFact(44, "compact_trigger"),
		auto_mode_bypass: claudeFact(38, "auto_mode_bypass"),
	});
	expect(JSON.parse(second?.hook_runs ?? "")).toEqual(
		JSON.parse(claudeFact(43, "hook_runs") ?? ""),
	);
	const claudeReceipt = await receiptOf(claudeSession);
	expect(claudeReceipt).toMatchObject({
		run_count: claudeRuns.length,
		tool_calls: claudeRuns.reduce((sum, run) => sum + run.tool_calls, 0),
		index_version: RUN_INDEX_VERSION,
		title: claudeFact(52, "title"),
		thread_source: null,
	});
	expect(claudeReceipt?.cost_state.cost_usd).toBe(claudeFact(51, "cost_usd"));

	// Codex parser 8: the turn's lifecycle rows, written around its prompt,
	// join the run by turn_id.
	const [codexRun] = await runsOf(codexSession);
	const durations = codexDrafts
		.filter(
			(draft) =>
				draft.kind === "meta" &&
				["task_complete", "turn_aborted"].includes(draft.subtype),
		)
		.reduce((sum, draft) => sum + (draft.facts.durationMs ?? 0), 0);
	expect(codexRun).toMatchObject({
		approval_policy: "on-request",
		context_window: 258400,
		time_to_first_token_ms: 1941,
		duration_ms: durations,
		aborted: "true",
		abort_reason: "interrupted",
		turn_error: "Selected model is at capacity. Please try a different model.",
		turn_error_kind: "server_overloaded",
		thread_source: "user",
		trigger_turn: "true",
		prompt_origin_basis: "native",
		// Claude-only facts are unknown for Codex.
		permission_mode: null,
		timed_out_calls: null,
		// Codex refusals and stopped calls are read from its output (parser 8).
		denied_calls: codexDrafts.filter(
			(draft) =>
				draft.agentId === "" &&
				draft.kind === "tool_result" &&
				draft.facts.denialKind !== "",
		).length,
		interrupted_calls: codexDrafts.filter(
			(draft) =>
				draft.agentId === "" &&
				draft.kind === "tool_result" &&
				draft.facts.interrupted === true,
		).length,
	});
	expect(codexRun?.goal?.startsWith("ship parser v7")).toBe(true);

	// Parser 5: the same records, so the same counts; no fact is known.
	const [legacy] = await runsOf(legacySession);
	expect(legacy).toMatchObject({
		tool_calls: first?.tool_calls,
		failed_calls: first?.failed_calls,
		agent_version: null,
		mcp_calls: null,
		permission_mode: null,
		skills: [],
		facts_truncated: null,
	});
	expect(legacy?.unrecorded_facts).toEqual(
		expect.arrayContaining(["agent_version", "skills", "git_operations"]),
	);

	// A request with nothing new is a no-op; late usage rebuilds the same
	// generation with the same runs.
	const before = await runIndexRows(claudeSession);
	await queueRunIndex(claudeSession, "claude_code");
	await pass();
	expect(await runIndexRows(claudeSession)).toEqual(before);
	await clickhouse.insert({
		table: "rudel.usage_events",
		asyncInsert: false,
		values: [
			{
				organization_id: organizationId,
				user_id: userId,
				source: "claude_code",
				session_id: claudeSession,
				event_id: "e".repeat(64),
				record_kind: "receipt",
				event_version: "5",
				receipt_is_complete: 1,
				receipt_event_count: 0,
				receipt_checksum: "c".repeat(64),
				content_sha256: "a".repeat(64),
			},
		],
	});
	await queueRunIndex(claudeSession, "claude_code");
	await pass();
	const rebuilt = await runIndexRows(claudeSession);
	expect(rebuilt.map(withoutBuild)).toEqual(before.map(withoutBuild));
	const firstBuild = before[0]?.build_revision ?? "";
	const secondBuild = rebuilt[0]?.build_revision ?? "";
	expect(secondBuild).not.toBe(firstBuild);
	expect(rebuilt.find((row) => row.row_kind === "receipt")?.usage_receipt).toBe(
		`5:${"c".repeat(64)}`,
	);
	// Both builds are stored snapshots; the earlier one waits for the grace.
	expect(await snapshotsOf(claudeSession)).toEqual(
		[`1/${firstBuild}`, `1/${secondBuild}`].sort(),
	);

	// A rebuild that dies between its runs and its receipt changes nothing a
	// reader sees, even after the table merges.
	await clickhouse.insert({
		table: "rudel.usage_events",
		asyncInsert: false,
		values: [
			{
				organization_id: organizationId,
				user_id: userId,
				source: "claude_code",
				session_id: claudeSession,
				event_id: "f".repeat(64),
				record_kind: "receipt",
				event_version: "6",
				receipt_is_complete: 1,
				receipt_event_count: 0,
				receipt_checksum: "d".repeat(64),
				content_sha256: "a".repeat(64),
			},
		],
	});
	const [{ crashed } = { crashed: "0" }] = await sqlClient.unsafe<
		{ crashed: string }[]
	>("SELECT nextval('l1_edge_revision_seq')::text AS crashed");
	let writes = 0;
	await expect(
		buildRunIndex({
			executor: clickhouse,
			organizationId,
			session: identityOf(claudeSession, "claude_code"),
			buildRevision: Number(crashed),
			beforeWrite: async () => {
				if (++writes === 2) throw new Error("worker killed");
			},
		}),
	).rejects.toThrow("worker killed");
	expect(await snapshotsOf(claudeSession)).toContain(`1/${crashed}`);
	await clickhouse.execute({ query: "OPTIMIZE TABLE rudel.run_index FINAL" });
	expect(await runIndexRows(claudeSession)).toEqual(rebuilt);

	// A re-upload is a new generation. Publishing it retires the crashed build
	// at once; the superseded builds stay through the grace, then the sweep
	// retires them and keeps the committed one.
	await publish(claudeSession, "claude_code", claude, "2");
	await queueRunIndex(claudeSession, "claude_code");
	await pass();
	const generations = async () => [
		...new Set(
			(await snapshotsOf(claudeSession)).map((snapshot) =>
				snapshot.slice(0, snapshot.indexOf("/")),
			),
		),
	];
	expect(await generations()).toEqual(["1", "2"]);
	expect(await snapshotsOf(claudeSession)).not.toContain(`1/${crashed}`);
	expect(
		(await runIndexRows(claudeSession)).map((row) => String(row.revision)),
	).toEqual(claudeRuns.map(() => "2").concat("2"));
	// Another session lost its cleanup: generation 1 crashed after its runs,
	// generation 2 committed. With one receipt only, the sweep still finds it.
	const orphanSession = `${RUN}_orphan`;
	const written = new Date(Date.now() - 3_600_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	await clickhouse.insert({
		table: "rudel.run_index",
		asyncInsert: false,
		values: [
			{ revision: "1", build_revision: "1", row_kind: "run", start_record: 1 },
			{ revision: "2", build_revision: "2", row_kind: "run", start_record: 1 },
			{
				revision: "2",
				build_revision: "2",
				row_kind: "receipt",
				start_record: 4_294_967_295,
			},
		].map((row) => ({
			...row,
			organization_id: organizationId,
			user_id: userId,
			session_id: orphanSession,
			parser_version: 8,
			index_version: RUN_INDEX_VERSION,
			source: "claude_code",
			built_at: written,
			session_date: written,
		})),
	});
	const later = () => Date.now() + TRANSCRIPT_RECORDS_RETIRE_GRACE_MS + 60_000;
	const sweep = await runRunIndexRetirementPass({
		organizationId,
		deadline: { deadlineAt: later() + 60_000, now: later },
	});
	// The claude session's two superseded builds and the orphan.
	expect(sweep.generationsRetired).toBe(3);
	expect(await generations()).toEqual(["2"]);
	expect(await snapshotsOf(orphanSession)).toEqual(["2/2"]);

	// Text is kept until a deletion request: an old run reads its text back.
	const expiredSession = `${RUN}_expired`;
	const longAgo = new Date(Date.now() - 400 * 86_400_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	await clickhouse.insert({
		table: "rudel.run_index",
		asyncInsert: false,
		values: ["run", "receipt"].map((kind) => ({
			organization_id: organizationId,
			user_id: userId,
			session_id: expiredSession,
			revision: "1",
			parser_version: 8,
			index_version: RUN_INDEX_VERSION,
			build_revision: "1",
			row_kind: kind,
			start_record: kind === "run" ? 1 : 4_294_967_295,
			source: "claude_code",
			session_date: longAgo,
			tool_calls: 2,
			prompt_head: "an old prompt",
			title: "an old title",
		})),
	});
	expect(
		(await runIndexRows(expiredSession)).map((row) => [
			row.row_kind,
			row.tool_calls,
			row.prompt_head,
			row.title,
		]),
	).toEqual([
		["run", 2, "an old prompt", "an old title"],
		["receipt", 2, "an old prompt", "an old title"],
	]);

	// An expired transcript keeps its runs.
	const legacyBefore = await runIndexRows(legacySession);
	await clickhouse.execute({
		query:
			"DELETE FROM rudel.transcript_records WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} SETTINGS lightweight_deletes_sync = 3",
		query_params: { organizationId, sessionId: legacySession },
	});
	await queueRunIndex(legacySession, "claude_code");
	await pass();
	expect(await runIndexRows(legacySession)).toEqual(legacyBefore);
	expect((await scopeOf(legacySession, "claude_code"))?.frozen_reason).toBe(
		"transcript expired; run index kept",
	);

	// Repository changes re-queue a session's edges, never its run index.
	await enqueueL1EdgeScope(sqlClient, {
		kind: "session",
		organizationId,
		...identityOf(claudeSession, "claude_code"),
	});
	await recordL1EdgeDependencies(
		sqlClient,
		{
			organizationId,
			scopeId: `${encodeURIComponent(userId)}/claude_code/${encodeURIComponent(claudeSession)}`,
		},
		[{ repositoryKey: "101", openUntil: new Date(Date.now() + 86_400_000) }],
	);
	expect(
		await enqueueL1EdgeDependents(sqlClient, organizationId, ["101"], {
			limit: 10,
		}),
	).toBe(1);
	const settled = await scopeOf(claudeSession, "claude_code");
	expect(settled?.request_count).toBe(settled?.built_request_count);
	expect(settled?.resolver_version).toBe(RUN_INDEX_VERSION);
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = 'session'",
		[organizationId],
	);

	// A build that commits new runs calls the run index hook once (run
	// questions queue their answers there); a rebuild that finds the index
	// current does not, and a failing hook never fails the build.
	const hookSession = `${RUN}_hook`;
	await publish(hookSession, "claude_code", claude, "1");
	const hooked: unknown[] = [];
	const hook = async (session: unknown) => {
		hooked.push(session);
		throw new Error("the hook failed");
	};
	await queueRunIndex(hookSession, "claude_code");
	expect(await pass(hook)).toBe(1);
	await queueRunIndex(hookSession, "claude_code");
	expect(await pass(hook)).toBe(0);
	expect(hooked).toEqual([
		{
			organizationId,
			userId,
			source: "claude_code",
			sessionId: hookSession,
		},
	]);
	const hookScope = await scopeOf(hookSession, "claude_code");
	expect(hookScope?.built_request_count).toBe(hookScope?.request_count);
	expect(hookScope?.resolver_version).toBe(RUN_INDEX_VERSION);
	expect((await runsOf(hookSession)).length).toBeGreaterThan(0);

	// The account is being deleted: the session's run index goes and its
	// scope is dropped.
	await sqlClient.unsafe(
		`INSERT INTO clickhouse_purge_job (id, target_type, target_id, status, max_attempts)
		 VALUES ($1, 'account', $2, 'succeeded', 1)`,
		[crypto.randomUUID(), userId],
	);
	await queueRunIndex(codexSession, "codex");
	await pass();
	expect(await runIndexRows(codexSession)).toEqual([]);
	expect(await snapshotsOf(codexSession)).toEqual([]);
	expect(await scopeOf(codexSession, "codex")).toBeUndefined();
});
