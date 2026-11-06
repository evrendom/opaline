import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import { extractUsageEvents } from "@rudel/usage-events";
import postgres from "postgres";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
} from "../clickhouse.js";
import { openRun } from "../services/analysis/run-view.service.js";
import { runSql, SQL_LIMITS } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { runClickHousePurgeWorkerPass } from "../services/clickhouse-purge.service.js";
import { runNodeId } from "../services/l1-edges/l1-edge-ids.js";
import { enqueueL1EdgeScope } from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";
import { buildUsageEventRows } from "../services/usage-event-ingest.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";

/**
 * The run view against real ClickHouse and Postgres: the run index build
 * writes each run's requests (one model response and its calls) with the
 * usage on their lines, and `run` opens a run from them, drilling into
 * phases, requests, calls, records and subagent runs. Deleting the account
 * removes its requests.
 */

setDefaultTimeout(180_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `run_view_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const userId = `${RUN}_user`;
const claudeSession = `${RUN}_claude`;
const codexSession = `${RUN}_codex`;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
const env = {
	executor: clickhouse,
	ownerOf: async () => userId,
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
};

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.usage_events",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { workspace },
		});
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = $1",
		[userId],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [workspace]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
	await sqlClient.end();
});

const minute = (n: number) =>
	new Date(Date.UTC(2026, 9, 1, 9, n)).toISOString();

/** A Claude Code line of the main stream or of subagent `sub1`. */
const claude = (at: number, line: Record<string, unknown>, agentId = "") =>
	JSON.stringify({
		sessionId: claudeSession,
		cwd: "/repo",
		version: "2.1.292",
		entrypoint: "cli",
		isSidechain: agentId !== "",
		...(agentId ? { agentId } : {}),
		timestamp: minute(at),
		...line,
	});
const prompt = (at: number, text: string, agentId = "") =>
	claude(
		at,
		{ type: "user", message: { role: "user", content: text } },
		agentId,
	);
/** One block of model response `id`; every line of a response repeats its usage. */
const response = (
	at: number,
	id: string,
	usage: { input: number; output: number },
	block: Record<string, unknown>,
	agentId = "",
) => responseLine(at, id, usage, [block], agentId);
/** A line of model response `id` with the given content blocks (none, one or several). */
const responseLine = (
	at: number,
	id: string,
	usage: { input: number; output: number },
	content: readonly Record<string, unknown>[],
	agentId = "",
) =>
	claude(
		at,
		{
			type: "assistant",
			requestId: `req_${id}`,
			message: {
				id,
				role: "assistant",
				model: "claude-sonnet-4-6",
				content,
				usage: {
					input_tokens: usage.input,
					output_tokens: usage.output,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		agentId,
	);
const call = (id: string, name: string, input: Record<string, unknown>) => ({
	type: "tool_use",
	id,
	name,
	input,
});
const result = (
	at: number,
	id: string,
	content: string,
	isError = false,
	toolUseResult: unknown = undefined,
	agentId = "",
) =>
	claude(
		at,
		{
			type: "user",
			message: {
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: id, content, is_error: isError },
				],
			},
			...(toolUseResult === undefined ? {} : { toolUseResult }),
		},
		agentId,
	);

const FINAL_ANSWER =
	'Fixed! The "login" test now passes.\n\nRan `bun test` twice.';

/**
 * Three runs. The second explores (Grep, Read), edits, runs checks (a
 * failing test, a subagent, then one response that runs two commands and
 * writes a result between them, as Claude Code does) and answers.
 */
const CLAUDE = [
	prompt(0, "add rate limiting to login"),
	response(
		1,
		"m0",
		{ input: 100, output: 10 },
		{ type: "text", text: "Done, added a limiter in auth.ts" },
	),
	prompt(2, "fix the failing login test"),
	response(
		3,
		"m1",
		{ input: 1_000, output: 100 },
		call("t1", "Grep", { pattern: "login" }),
	),
	result(4, "t1", "Found 1 file\nsrc/auth.test.ts"),
	response(
		5,
		"m2",
		{ input: 2_000, output: 200 },
		call("t2", "Read", { file_path: "/repo/src/auth.ts" }),
	),
	result(6, "t2", "export function login() {}"),
	response(
		7,
		"m3",
		{ input: 3_000, output: 300 },
		call("t3", "Edit", {
			file_path: "/repo/src/auth.ts",
			old_string: "{}",
			new_string: "{ return true; }",
		}),
	),
	result(8, "t3", "The file /repo/src/auth.ts has been updated."),
	response(
		10,
		"m4",
		{ input: 4_000, output: 400 },
		call("t4", "Bash", { command: "bun test src/auth.test.ts" }),
	),
	result(14, "t4", "1 fail", true),
	response(
		15,
		"m5",
		{ input: 5_000, output: 500 },
		call("t5", "Task", {
			description: "find tests",
			prompt: "find where login is tested",
			subagent_type: "Explore",
		}),
	),
	result(18, "t5", "In auth.test.ts", false, {
		agentId: "sub1",
		status: "completed",
	}),
	response(
		19,
		"m6",
		{ input: 6_000, output: 600 },
		call("t6", "Bash", { command: "bun test src/auth.test.ts" }),
	),
	result(20, "t6", "1 pass"),
	response(
		21,
		"m6",
		{ input: 6_000, output: 600 },
		call("t7", "Bash", { command: "bun run lint" }),
	),
	result(22, "t7", "ok"),
	response(
		23,
		"m7",
		{ input: 7_000, output: 700 },
		{ type: "text", text: FINAL_ANSWER },
	),
	prompt(30, "it still fails, damn it"),
	response(
		31,
		"m8",
		{ input: 8_000, output: 800 },
		{ type: "text", text: "Looking again." },
	),
].join("\n");

const SUBAGENT = [
	prompt(15, "find where login is tested", "sub1"),
	response(
		16,
		"s1",
		{ input: 500, output: 50 },
		call("u1", "Grep", { pattern: "login" }),
		"sub1",
	),
	result(17, "u1", "src/auth.test.ts", false, undefined, "sub1"),
	response(
		18,
		"s2",
		{ input: 600, output: 60 },
		{ type: "text", text: "In auth.test.ts" },
		"sub1",
	),
].join("\n");

/** A Codex run of two responses, each followed by its token_count. */
const codexUsage = (input: number, output: number) => ({
	input_tokens: input,
	cached_input_tokens: 0,
	output_tokens: output,
	reasoning_output_tokens: 0,
	total_tokens: input + output,
});
const CODEX = [
	{
		timestamp: minute(0),
		type: "session_meta",
		payload: {
			id: codexSession,
			cli_version: "0.156.0",
			originator: "codex_cli_rs",
			source: "cli",
		},
	},
	{
		timestamp: minute(0),
		type: "turn_context",
		payload: { turn_id: "t1", cwd: "/repo", model: "gpt-5.1-codex" },
	},
	{
		timestamp: minute(1),
		type: "response_item",
		payload: {
			type: "message",
			role: "user",
			content: [{ type: "input_text", text: "run the tests" }],
		},
	},
	{
		timestamp: minute(2),
		type: "response_item",
		payload: {
			type: "function_call",
			name: "exec_command",
			arguments: JSON.stringify({ cmd: "bun test" }),
			call_id: "c1",
		},
	},
	{
		timestamp: minute(3),
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: codexUsage(1_000, 100),
				last_token_usage: codexUsage(1_000, 100),
			},
		},
	},
	{
		timestamp: minute(4),
		type: "response_item",
		payload: {
			type: "function_call_output",
			call_id: "c1",
			output: "Process exited with code 0\nOutput:\n3 pass",
		},
	},
	{
		timestamp: minute(5),
		type: "response_item",
		payload: {
			type: "message",
			role: "assistant",
			content: [{ type: "output_text", text: "All 3 tests pass." }],
		},
	},
	{
		timestamp: minute(6),
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: codexUsage(3_000, 300),
				last_token_usage: codexUsage(2_000, 200),
			},
		},
	},
]
	.map((line) => JSON.stringify(line))
	.join("\n");

/** Publishes a revision of a session's transcript and its usage extraction. */
async function publish(
	sessionId: string,
	source: TranscriptSource,
	content: string,
	subagents: Record<string, string> = {},
	revision = "1",
): Promise<void> {
	const identity = {
		organizationId: workspace,
		userId,
		sessionId,
		source,
		revision,
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate: SESSION_DATE, source, subagents },
			stats,
		),
	].map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
		],
	});
	const extraction = extractUsageEvents({
		organizationId: workspace,
		userId,
		sessionId,
		source,
		content,
		subagents,
	});
	expect(extraction.status).toBe("complete");
	await clickhouse.insert({
		table: "rudel.usage_events",
		asyncInsert: false,
		values: [
			...buildUsageEventRows(
				{
					organizationId: workspace,
					userId,
					sessionId,
					source,
					generation: revision,
					extraction,
					replaceAbsentEvents: false,
					contentSha256: hashTranscriptContent(content),
					filterVersion: 1,
					ingestedAt: new Date(),
					sessionDate: new Date(SESSION_DATE),
				},
				[],
			),
		],
	});
}

/** Builds this test's run index scopes only: other suites queue theirs too. */
async function buildRunIndexes(
	sessions: readonly (readonly [string, TranscriptSource])[] = [
		[claudeSession, "claude_code"],
		[codexSession, "codex"],
	],
): Promise<void> {
	for (const [sessionId, source] of sessions)
		await enqueueL1EdgeScope(sqlClient, {
			kind: "run_index",
			organizationId: workspace,
			userId,
			source,
			sessionId,
		});
	await sqlClient.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id <> $1",
		[workspace],
	);
	await runL1EdgePass({
		sql: sqlClient,
		budgetMs: 60_000,
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
}

const runId = (
	sessionId: string,
	source: string,
	agentId: string,
	start: number,
) => runNodeId({ userId, source, sessionId }, agentId, start);

async function runStarts(sessionId: string): Promise<number[]> {
	return (
		await clickhouse.query<{ start_record: number }>({
			query: `SELECT start_record FROM rudel.run_index FINAL
				WHERE organization_id = {workspace:String} AND session_id = {sessionId:String}
					AND row_kind = 'run' AND agent_id = ''
				ORDER BY start_record`,
			query_params: { workspace, sessionId },
		})
	).map((row) => row.start_record);
}

async function requestRows(sessionId: string) {
	return clickhouse.query<{
		agent_id: string;
		run_start_record: number;
		start_record: number;
		call_tools: string[];
		output_tokens: string | null;
		uncached_input_tokens: string | null;
		text_head: string | null;
	}>({
		query: `SELECT agent_id, run_start_record, start_record, call_tools, toString(output_tokens) AS output_tokens,
				toString(uncached_input_tokens) AS uncached_input_tokens, text_head
			FROM rudel.run_requests FINAL
			WHERE organization_id = {workspace:String} AND session_id = {sessionId:String}
			ORDER BY agent_id, start_record`,
		query_params: { workspace, sessionId },
	});
}

test("the run index build writes each request with its calls and tokens, and run opens a run from them", async () => {
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Run view', $2, false)`,
		[userId, `${userId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Run view', $1)",
		[workspace],
	);
	await publish(claudeSession, "claude_code", CLAUDE, { sub1: SUBAGENT });
	await publish(codexSession, "codex", CODEX);
	await buildRunIndexes();

	// One request per model response: the response written around a tool
	// result is one request with both calls, and each carries its own usage.
	const [first, second, third] = await runStarts(claudeSession);
	const requests = (await requestRows(claudeSession)).filter(
		(row) => row.agent_id === "" && row.run_start_record === second,
	);
	expect(requests.map((row) => [row.call_tools, row.output_tokens])).toEqual([
		[["Grep"], "100"],
		[["Read"], "200"],
		[["Edit"], "300"],
		[["Bash"], "400"],
		[["Task"], "500"],
		[["Bash", "Bash"], "600"],
		[[], "700"],
	]);
	// Codex records usage per response: each request has its own tokens.
	expect(
		(await requestRows(codexSession)).map((row) => [
			row.call_tools,
			row.uncached_input_tokens,
			row.text_head,
		]),
	).toEqual([
		[["exec_command"], "1000", null],
		[[], "2000", "All 3 tests pass."],
	]);

	const id = runId(claudeSession, "claude_code", "", second ?? 0);
	const view = await openRun(workspace, { id, maxChars: 12_000 }, env);
	const lines = view.text.split("\n");
	expect(view.phaseRule).toBe(1);
	expect(lines[0]).toStartWith(
		`run ${id} · claude_code · "fix the failing login test" · 21 min · `,
	);
	expect(lines[0]).toEndWith(" · phases by rule 1");
	expect(lines[1]).toBe(
		`PREV ${runId(claudeSession, "claude_code", "", first ?? 0)} · "add rate limiting to login" → END "Done, added a limiter in auth.ts"`,
	);
	expect(lines[2]).toMatch(
		/^END {2}r\d+ · "Fixed! The \\"login\\" test now passes\. Ran `bun test` twice\."$/u,
	);
	expect(lines[3]).toBe(
		`NEXT ${runId(claudeSession, "claude_code", "", third ?? 0)} · user: "it still fails, damn it" · reaction: unhappy (strongly worded)`,
	);
	// The fixture's transcript records no setup text.
	expect(lines[4]).toBe(
		"SETUP none: its transcript records no setup text for this run",
	);
	expect(
		lines.slice(6).map((line) => line.split(/ {2,}/u).slice(0, 3)),
	).toEqual([
		["p1", "exploring: Grep, Read", "2"],
		["p2", "editing: Edit", "1"],
		["p3", "running checks: Bash test×2, Task, Bash lint (1 failed)", "3"],
		["p4", "talking to the user", "1"],
	]);
	expect(lines[8]).toMatch(/ 3 {2}\d+ min +17k {2}\$\d+\.\d\d$/u);

	// END's id opens the exact text of the final answer.
	const end = lines[2]?.match(/^END {2}(r\d+)/u)?.[1] ?? "";
	const record = await openRun(
		workspace,
		{ id, sections: ["end"], expand: [end], maxChars: 12_000 },
		env,
	);
	expect(record.text).toEndWith(`characters\n${FINAL_ANSWER}`);

	// Two phases at once share the budget, and the view says what was cut.
	const whole = await openRun(
		workspace,
		{ id, expand: ["p1", "p3"], maxChars: 12_000 },
		env,
	);
	const maxChars = whole.text.length - 80;
	const both = await openRun(
		workspace,
		{ id, expand: ["p1", "p3"], maxChars },
		env,
	);
	expect(both.truncated).toBe(true);
	expect(both.text.length).toBeLessThanOrEqual(maxChars);
	expect(both.text).toContain("▸ p1 exploring: 2 requests");
	expect(both.text).toContain("▸ p3 running checks: 3 requests");
	expect(both.text).toMatch(
		/… \[\d more requests of p3 omitted to fit the response size limit\]/u,
	);

	// The Task call opens the subagent's run, in the same view.
	const task = requests[4]?.start_record ?? 0;
	const callLines = (
		await openRun(
			workspace,
			{ id, sections: ["header"], expand: [`q${task}`], maxChars: 12_000 },
			env,
		)
	).text.split("\n");
	const taskCall = callLines.find((line) =>
		line.includes("· started subagent run "),
	);
	expect(taskCall).toBeDefined();
	const callId = taskCall?.trim().split(" ", 1)[0] ?? "";
	const subagent = await openRun(
		workspace,
		{ id, sections: ["header"], expand: [callId], maxChars: 12_000 },
		env,
	);
	const subagentRun = `${runId(claudeSession, "claude_code", "sub1", 0).slice(0, -1)}`;
	expect(subagent.text).toContain(
		`▸ ${callId} started subagent run ${subagentRun}`,
	);
	expect(subagent.text).toContain('· task "find where login is tested" · ');
	expect(subagent.text).toContain("       exploring: Grep");
	expect(subagent.text).not.toMatch(/\n {2}(p\d|END {2}r\d)/u);

	// A Codex run shows tokens per request, the finest level Codex records.
	const [codexStart] = await runStarts(codexSession);
	const codex = await openRun(
		workspace,
		{
			id: runId(codexSession, "codex", "", codexStart ?? 0),
			sections: ["phases"],
			expand: ["p1", "p2"],
			maxChars: 12_000,
		},
		env,
	);
	expect(codex.text).toMatch(
		/\n {2}q\d+ +exec_command test · 3 min · 1k tokens · /u,
	);
	expect(codex.text).toMatch(/\n {2}q\d+ +text · 1 min · 2k tokens · /u);
});

/** Lines written for the Claude session, moved to another session of this test. */
const inSession = (sessionId: string, lines: readonly string[]) =>
	lines
		.join("\n")
		.replaceAll(JSON.stringify(claudeSession), JSON.stringify(sessionId));

/** The id of a session's first main-stream run. */
async function firstRunId(sessionId: string): Promise<string> {
	const [start] = await runStarts(sessionId);
	return runId(sessionId, "claude_code", "", start ?? 0);
}

test("a run index build from before requests (version 4, which writes none) shows its requests as not indexed", async () => {
	const sessionId = `${RUN}_v4`;
	await publish(
		sessionId,
		"claude_code",
		inSession(sessionId, [
			prompt(0, "say hi"),
			response(
				1,
				"v1",
				{ input: 100, output: 10 },
				{ type: "text", text: "hi" },
			),
		]),
	);
	await buildRunIndexes([[sessionId, "claude_code"]]);
	// The committed snapshot becomes a version-4 build without requests.
	const owner =
		"organization_id = {workspace:String} AND session_id = {sessionId:String}";
	await clickhouse.execute({
		query: `INSERT INTO rudel.run_index SELECT * REPLACE (4 AS index_version) FROM rudel.run_index FINAL WHERE ${owner}`,
		query_params: { workspace, sessionId },
	});
	for (const statement of [
		`DELETE FROM rudel.run_index WHERE ${owner} AND index_version != 4`,
		`DELETE FROM rudel.run_requests WHERE ${owner}`,
	])
		await clickhouse.execute({
			query: `${statement} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace, sessionId },
		});

	const view = await openRun(
		workspace,
		{ id: await firstRunId(sessionId), maxChars: 12_000 },
		env,
	);
	const lines = view.text.split("\n");
	expect([lines[2], lines[4], lines[5]]).toEqual([
		"END  unknown: this run's requests are not indexed yet",
		"SETUP unknown: this run's received setup was not read (its session was indexed before received setup was recorded)",
		"phases unknown: this run's requests are not indexed yet (run index before version 5)",
	]);
});

test("a Claude response whose first line carries only usage is a request of its own, with its own tokens", async () => {
	const sessionId = `${RUN}_usage_only`;
	await publish(
		sessionId,
		"claude_code",
		inSession(sessionId, [
			prompt(0, "what is in auth.ts"),
			response(
				1,
				"u1",
				{ input: 100, output: 10 },
				call("t1", "Read", { file_path: "/repo/src/auth.ts" }),
			),
			result(2, "t1", "export function login() {}"),
			responseLine(3, "u2", { input: 200, output: 20 }, []),
			response(
				4,
				"u2",
				{ input: 200, output: 20 },
				{ type: "text", text: "It exports login." },
			),
		]),
	);
	await buildRunIndexes([[sessionId, "claude_code"]]);
	expect(
		(await requestRows(sessionId)).map((row) => [
			row.call_tools,
			row.output_tokens,
			row.text_head,
		]),
	).toEqual([
		[["Read"], "10", null],
		[[], "20", "It exports login."],
	]);
});

test("END names the block of the text it quotes, and expanding it opens that text, not the reasoning before it", async () => {
	const sessionId = `${RUN}_reasoning`;
	await publish(
		sessionId,
		"claude_code",
		inSession(sessionId, [
			prompt(0, "is login tested"),
			responseLine(1, "r1", { input: 100, output: 10 }, [
				{
					type: "thinking",
					thinking: "The tests live next to the code.",
					signature: "sig",
				},
				{ type: "text", text: "Yes, in auth.test.ts." },
			]),
		]),
	);
	await buildRunIndexes([[sessionId, "claude_code"]]);
	const id = await firstRunId(sessionId);
	const view = await openRun(
		workspace,
		{ id, sections: ["end"], maxChars: 12_000 },
		env,
	);
	const end = view.text.match(
		/^END {2}(r\d+\.1) · "Yes, in auth\.test\.ts\."$/u,
	)?.[1];
	expect(end).toBeDefined();
	const opened = await openRun(
		workspace,
		{ id, sections: ["end"], expand: [end ?? ""], maxChars: 12_000 },
		env,
	);
	expect(opened.text).toEndWith("characters\nYes, in auth.test.ts.");
});

test("a build committed while run reads shows the run as it was loaded: requests and records of the same build", async () => {
	const sessionId = `${RUN}_pinned`;
	const first = [
		prompt(0, "explain login"),
		response(
			1,
			"p1",
			{ input: 100, output: 10 },
			{ type: "text", text: "First answer." },
		),
	];
	await publish(sessionId, "claude_code", inSession(sessionId, first));
	await buildRunIndexes([[sessionId, "claude_code"]]);
	const id = await firstRunId(sessionId);
	const before = await openRun(
		workspace,
		{ id, sections: ["end"], maxChars: 12_000 },
		env,
	);
	const end = before.text.match(/^END {2}(r\d+) · "First answer\."$/u)?.[1];
	expect(end).toBeDefined();

	// A re-upload rewrites the run (a Read, then a second answer) and its
	// build commits right after run read the run's row.
	let committed = false;
	const racing: ClickHouseExecutor = {
		close: () => clickhouse.close(),
		execute: (statement) => clickhouse.execute(statement),
		insert: (params) => clickhouse.insert(params),
		query: async <T>(statement: Parameters<ClickHouseExecutor["query"]>[0]) => {
			const rows = await clickhouse.query<T>(statement);
			if (!committed && statement.query_params?.kind === "run") {
				committed = true;
				await publish(
					sessionId,
					"claude_code",
					inSession(sessionId, [
						prompt(0, "explain login"),
						response(
							1,
							"p1",
							{ input: 100, output: 10 },
							call("t1", "Read", { file_path: "/repo/src/auth.ts" }),
						),
						result(2, "t1", "export function login() {}"),
						response(
							3,
							"p2",
							{ input: 100, output: 10 },
							{ type: "text", text: "Second answer." },
						),
					]),
					{},
					"2",
				);
				await buildRunIndexes([[sessionId, "claude_code"]]);
			}
			return rows;
		},
	};
	const during = await openRun(
		workspace,
		{ id, expand: [end ?? ""], maxChars: 12_000 },
		{ ...env, executor: racing },
	);
	expect(committed).toBe(true);
	const lines = during.text.split("\n");
	expect(lines[0]).toContain(" · 110 tokens · ");
	expect(lines[2]).toBe(`END  ${end} · "First answer."`);
	expect(
		lines.slice(6, 7).map((line) => line.split(/ {2,}/u).slice(0, 5)),
	).toEqual([["p1", "talking to the user", "1", "1 min", "110"]]);
	expect(during.text).toEndWith("characters\nFirst answer.");
	// The next call reads the new build.
	const after = await openRun(
		workspace,
		{ id, sections: ["end"], maxChars: 12_000 },
		env,
	);
	expect(after.text).toMatch(/^END {2}r\d+ · "Second answer\."$/u);
});

test("run reads ClickHouse within the sql tool's limits: its time, memory, read caps and two threads", async () => {
	const statements: ClickHouseStatement[] = [];
	const observing: ClickHouseExecutor = {
		close: () => clickhouse.close(),
		execute: (statement) => clickhouse.execute(statement),
		insert: (params) => clickhouse.insert(params),
		query: (statement) => {
			statements.push(statement);
			return clickhouse.query(statement);
		},
	};
	const [, second] = await runStarts(claudeSession);
	const [request] = (await requestRows(claudeSession)).filter(
		(row) => row.agent_id === "" && row.run_start_record === second,
	);
	await openRun(
		workspace,
		{
			id: runId(claudeSession, "claude_code", "", second ?? 0),
			expand: ["p1", `q${request?.start_record}`, `r${request?.start_record}`],
			maxChars: 12_000,
		},
		{ ...env, executor: observing },
	);
	expect(statements.length).toBeGreaterThan(3);
	for (const statement of statements)
		expect(statement.clickhouse_settings).toMatchObject({
			max_threads: 2,
			max_execution_time: SQL_LIMITS.seconds,
			max_memory_usage: String(SQL_LIMITS.memoryBytes),
			max_rows_to_read: String(SQL_LIMITS.rowsRead),
			max_bytes_to_read: String(SQL_LIMITS.bytesRead),
		});
});

test("run calls count in the workspace's sql quota: past it, both run and sql are refused", async () => {
	// The quota the router gives both sql and run (`createAnalysisRouter`).
	const quota = createMemorySqlQuota({ queries: 2, windowMs: 3_600_000 });
	const sqlEnv = {
		executor: clickhouse,
		results: createMemorySqlResultStore(),
		quota,
		githubRepositories: async () => [],
		limiter: {
			withAgentQuerySlot: async <T>(
				_workspaceId: string,
				work: () => Promise<T>,
			) => await work(),
		},
	};
	const caller = {
		workspaceId: workspace,
		reader: { userId, role: "owner", ownSessionsOnly: false },
	};
	const [start] = await runStarts(claudeSession);
	const id = runId(claudeSession, "claude_code", "", start ?? 0);
	const run = () =>
		openRun(
			workspace,
			{ id, sections: ["header"], maxChars: 12_000 },
			{ ...env, quota },
		);
	const sql = () =>
		runSql(
			caller,
			{ query: "SELECT count() AS runs FROM runs", title: "runs" },
			sqlEnv,
		);
	expect((await run()).text).toStartWith(`run ${id} · `);
	expect((await sql()).ok).toBe(true);
	await expect(run()).rejects.toThrow(
		/used its SQL quota of 2 queries \(sql and run calls\) per 60 minutes/u,
	);
	expect(await sql()).toMatchObject({
		ok: false,
		error: {
			kind: "fatal",
			message: expect.stringContaining(
				"used its SQL quota of 2 queries (sql and run calls)",
			),
		},
	});
});

test("deleting the account removes its requests", async () => {
	expect((await requestRows(claudeSession)).length).toBeGreaterThan(0);
	await deleteUserPostgresData(userId, { sqlClient });
	for (let pass = 0; pass < 20; pass++) {
		await runClickHousePurgeWorkerPass({ resend: {}, sqlClient });
		const [job] = await sqlClient<{ status: string }[]>`
			SELECT status FROM clickhouse_purge_job
			WHERE target_type = 'account' AND target_id = ${userId}
		`;
		if (job?.status === "succeeded") break;
	}
	expect(await requestRows(claudeSession)).toEqual([]);
	expect(await requestRows(codexSession)).toEqual([]);
});
