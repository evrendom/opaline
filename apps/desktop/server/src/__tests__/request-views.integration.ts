import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { extractUsageEvents } from "@rudel/usage-events";
import { getClickhouse } from "../clickhouse.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";
import { buildUsageEventRows } from "../services/usage-event-ingest.service.js";

setDefaultTimeout(120_000);

const RUN = `request_views_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const userId = `${RUN}_user`;
const sessionId = `${RUN}_session`;
const clickhouse = getClickhouse();
const SESSION_DATE = "2026-10-01T09:00:00.000Z";
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId, role: "member", ownSessionsOnly: false },
};

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.usage_events",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

const minute = (n: number) =>
	new Date(Date.UTC(2026, 9, 1, 9, n)).toISOString();

const line = (at: number, fields: Record<string, unknown>) =>
	JSON.stringify({
		sessionId,
		cwd: "/repo",
		version: "2.1.316",
		entrypoint: "cli",
		isSidechain: false,
		timestamp: minute(at),
		...fields,
	});

const prompt = (at: number, text: string) =>
	line(at, { type: "user", message: { role: "user", content: text } });

const response = (
	at: number,
	id: string,
	thinkingTokens: number,
	content: readonly Record<string, unknown>[],
) =>
	line(at, {
		type: "assistant",
		effort: "high",
		requestId: `req_${id}`,
		message: {
			id,
			role: "assistant",
			model: "claude-opus-5-5",
			content,
			usage: {
				input_tokens: 1_000,
				output_tokens: thinkingTokens + 50,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
				output_tokens_details: { thinking_tokens: thinkingTokens },
			},
		},
	});

const thinking = (text: string) => ({ type: "thinking", thinking: text });
const bash = (id: string) => ({
	type: "tool_use",
	id,
	name: "Bash",
	input: { command: "bun test" },
});
const result = (at: number, id: string, isError: boolean) =>
	line(at, {
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: "out",
					is_error: isError,
				},
			],
		},
	});

const TRANSCRIPT = [
	prompt(0, "run the tests"),
	response(1, "m1", 80, [thinking("I'm running the tests."), bash("t1")]),
	result(2, "t1", false),
	response(3, "m2", 0, [{ type: "text", text: "All pass." }]),
	prompt(63, "run them again"),
	response(64, "m3", 30, [thinking("I'm rerunning."), bash("t2")]),
	result(65, "t2", true),
	response(66, "m4", 40, [
		thinking("One failed."),
		{ type: "text", text: "One failed." },
	]),
].join("\n");

async function publish(): Promise<void> {
	const identity = {
		organizationId: workspace,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{
				content: TRANSCRIPT,
				sessionDate: SESSION_DATE,
				source: "claude_code",
				subagents: {},
			},
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
				contentSha256: hashTranscriptContent(TRANSCRIPT),
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
		source: "claude_code",
		content: TRANSCRIPT,
		subagents: {},
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
					source: "claude_code",
					generation: "1",
					extraction,
					replaceAbsentEvents: false,
					contentSha256: hashTranscriptContent(TRANSCRIPT),
					filterVersion: 1,
					ingestedAt: new Date(),
					sessionDate: new Date(SESSION_DATE),
				},
				[],
			),
		],
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: userId,
				session_id: sessionId,
				source: "claude_code",
				session_date: SESSION_DATE.replace("T", " ").replace("Z", ""),
				last_interaction_date: minute(66).replace("T", " ").replace("Z", ""),
				project_path: "/repo",
				git_remote: "github.com/opalinehq/athena",
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId, source: "claude_code", sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function sql(query: string): Promise<string[]> {
	const outcome = await runSql(
		caller,
		{ query, title: "test" },
		{
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
			limiter: {
				withAgentQuerySlot: async (_workspaceId, work) => await work(),
			},
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table.split("\n");
}

const thinkingTokensOf = (transcript: string) =>
	transcript
		.split("\n")
		.map((text) => JSON.parse(text))
		.filter((each) => each.type === "assistant")
		.map((each) => each.message.usage.output_tokens_details.thinking_tokens);

test("requests: one row per response with its own model, effort, calls and the thinking tokens the API reported", async () => {
	await publish();
	expect(thinkingTokensOf(TRANSCRIPT)).toEqual([80, 0, 30, 40]);
	expect(
		await sql(
			`SELECT turn_idx, model, effort, calls, failed_calls, reasoning_output_tokens
			FROM requests ORDER BY record_idx`,
		),
	).toEqual([
		"turn_idx | model | effort | calls | failed_calls | reasoning_output_tokens",
		"1 | claude-opus-5-5 | high | 1 | 0 | 80",
		"1 | claude-opus-5-5 | high | 0 | 0 | 0",
		"2 | claude-opus-5-5 | high | 1 | 1 | 30",
		"2 | claude-opus-5-5 | high | 0 | 0 | 40",
	]);
	expect(
		await sql(
			`SELECT round(100 * countIf(reasoning_output_tokens = 0) / count(), 1) AS no_thinking_pct,
				sumIf(reasoning_output_tokens, calls > 0) AS thinking_with_calls
			FROM requests WHERE model = 'claude-opus-5-5' AND effort = 'high'`,
		),
	).toEqual(["no_thinking_pct | thinking_with_calls", "25 | 110"]);
});

test("session_activity: a session idle for an hour between two prompts is two spans, working only inside them", async () => {
	expect(
		await sql(
			`SELECT span_idx, formatDateTime(started_at, '%H:%i') AS start, formatDateTime(ended_at, '%H:%i') AS end,
				runs, genuine_prompts, idle_minutes_before
			FROM session_activity ORDER BY span_idx`,
		),
	).toEqual([
		"span_idx | start | end | runs | genuine_prompts | idle_minutes_before",
		"1 | 09:00 | 09:03 | 1 | 1 | null",
		"2 | 10:03 | 10:06 | 1 | 1 | 60",
	]);
	expect(
		await sql(
			`SELECT countIf(started_at <= toDateTime64('2026-10-01 09:30:00', 3, 'UTC') AND toDateTime64('2026-10-01 09:30:00', 3, 'UTC') <= ended_at) AS working_at_0930,
				countIf(started_at <= toDateTime64('2026-10-01 10:04:00', 3, 'UTC') AND toDateTime64('2026-10-01 10:04:00', 3, 'UTC') <= ended_at) AS working_at_1004
			FROM session_activity`,
		),
	).toEqual(["working_at_0930 | working_at_1004", "0 | 1"]);
});

test("model_text: each block the model wrote, with the model and the response it belongs to", async () => {
	expect(
		await sql(
			`SELECT t.kind AS kind, t.model AS model, t.text AS text, q.reasoning_output_tokens AS tokens
			FROM model_text AS t
			INNER JOIN requests AS q ON q.session_id = t.session_id AND q.agent_id = t.agent_id AND q.record_idx = t.request_record
			ORDER BY t.record_idx, t.block_idx`,
		),
	).toEqual([
		"kind | model | text | tokens",
		"reasoning | claude-opus-5-5 | I'm running the tests. | 80",
		"assistant_text | claude-opus-5-5 | All pass. | 0",
		"reasoning | claude-opus-5-5 | I'm rerunning. | 30",
		"reasoning | claude-opus-5-5 | One failed. | 40",
		"assistant_text | claude-opus-5-5 | One failed. | 40",
	]);
	expect(
		await sql(
			`SELECT count() AS n, round(100 * countIf(startsWith(text, 'I''m')) / n, 1) AS starts_im
			FROM model_text WHERE kind = 'reasoning' AND text != '' AND at >= toDateTime64('2026-10-01 00:00:00', 3, 'UTC')`,
		),
	).toEqual(["n | starts_im", "3 | 66.7"]);
});
