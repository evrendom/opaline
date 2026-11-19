import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import "./helpers/local-integration-guard.js";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "../services/analysis/sql-gateway.js";
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

/**
 * The events view against real ClickHouse: a run's API retries, API error
 * message, refusal, stop hooks, notice and compaction, each a row with its
 * record and time, adding up per run to the runs columns that count them.
 */

setDefaultTimeout(120_000);

const RUN = `events_view_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const session = `${RUN}_session`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: member, role: "member", ownSessionsOnly: false },
};

const at = (seconds: number) =>
	new Date(baseMs + seconds * 1_000).toISOString();
const line = (seconds: number, record: Record<string, unknown>) => ({
	sessionId: session,
	cwd: "/repo",
	isSidechain: false,
	version: "2.1.293",
	timestamp: at(seconds),
	...record,
});
const prompt = (seconds: number, content: string) =>
	line(seconds, { type: "user", message: { role: "user", content } });
const answer = (seconds: number, text: string) =>
	line(seconds, {
		type: "assistant",
		message: {
			role: "assistant",
			model: "claude-opus-5-5",
			content: [{ type: "text", text }],
		},
	});
const system = (seconds: number, record: Record<string, unknown>) =>
	line(seconds, { type: "system", ...record });
const retry = (seconds: number, attempt: number, retryInMs: number) =>
	system(seconds, {
		subtype: "api_error",
		level: "error",
		error: {
			status: 529,
			message: "Overloaded",
			formatted: "API is overloaded",
		},
		retryAttempt: attempt,
		maxRetries: 10,
		retryInMs,
	});

async function ingest(content: string) {
	const identity = {
		organizationId: workspace,
		userId: member,
		sessionId: session,
		source: "claude_code" as const,
		revision: "1",
		sessionDate: at(0),
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate: at(0), source: "claude_code" },
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
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: member,
				session_id: session,
				source: "claude_code",
				session_date: at(0).replace("T", " ").replace("Z", ""),
				last_interaction_date: at(300).replace("T", " ").replace("Z", ""),
				project_path: "/test/events-view",
				git_remote: "github.com/opalinehq/athena",
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: member, source: "claude_code", sessionId: session },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function sql(query: string): Promise<string[]> {
	const outcome: SqlOutcome = await runSql(
		caller,
		{ query, title: "test" },
		{
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table.split("\n");
}

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

describe("the events view", () => {
	test("each retry, API error, refusal, hook, notice and compaction is a row with its record and time, and per run they add up to runs", async () => {
		await ingest(
			[
				prompt(0, "fix the flaky test"),
				retry(5, 1, 500),
				retry(6, 2, 1_000),
				line(10, {
					type: "assistant",
					isApiErrorMessage: true,
					error: "rate_limit",
					apiErrorStatus: 429,
					message: {
						role: "assistant",
						content: [{ type: "text", text: "API Error: Rate limited" }],
					},
				}),
				answer(20, "Fixed the test."),
				system(30, {
					subtype: "stop_hook_summary",
					level: "suggestion",
					hookCount: 2,
					// The summary lists one of the two hooks it counted.
					hookInfos: [{ command: "bun run lint", durationMs: 4_210 }],
					hookErrors: ["lint failed: 2 errors"],
					preventedContinuation: true,
					stopReason: "Fix lint before stopping",
				}),
				system(40, {
					subtype: "model_refusal_fallback",
					level: "warning",
					content: "safeguards flagged this session",
					originalModel: "claude-opus-5-5",
					fallbackModel: "claude-opus-4-8",
					apiRefusalCategory: "cyber",
				}),
				system(45, {
					subtype: "informational",
					level: "info",
					content: "continuing once with that noted",
				}),
				prompt(100, "now the docs"),
				system(110, {
					subtype: "compact_boundary",
					content: "Conversation compacted",
					compactMetadata: { trigger: "auto", preTokens: 1_000 },
				}),
				answer(115, "Docs updated."),
				system(120, {
					subtype: "stop_hook_summary",
					level: "suggestion",
					hookCount: 1,
					hookInfos: [{ command: "notify", durationMs: 12 }],
					preventedContinuation: false,
				}),
			]
				.map((record) => JSON.stringify(record))
				.join("\n"),
		);
		expect(
			await sql(
				`SELECT turn_idx, record_idx, dateDiff('second', toDateTime64('${at(0).replace("T", " ").replace("Z", "")}', 3, 'UTC'), at) AS secs,
					event, subtype, status, error, ifNull(toString(retry_attempt), '-') AS attempt, ifNull(toString(max_retries), '-') AS max_tries,
					ifNull(toString(retry_in_ms), '-') AS wait, hook_command, ifNull(toString(hook_ms), '-') AS hook_ms,
					ifNull(prevented_continuation, '-') AS prevented, refusal_category, model, fallback_model, text
				FROM events
				WHERE at >= now() - INTERVAL 2 HOUR AND session_id = '${session}'
				ORDER BY record_idx, event, hook_command DESC`,
			),
		).toEqual([
			"turn_idx | record_idx | secs | event | subtype | status | error | attempt | max_tries | wait | hook_command | hook_ms | prevented | refusal_category | model | fallback_model | text",
			"1 | 2 | 5 | retry | system:api_error | 529 |  | 1 | 10 | 500 |  | - | - |  |  |  | API is overloaded",
			"1 | 3 | 6 | retry | system:api_error | 529 |  | 2 | 10 | 1000 |  | - | - |  |  |  | API is overloaded",
			"1 | 4 | 10 | api_error | api_error_message | 429 | rate_limit | - | - | - |  | - | - |  |  |  | [rate_limit] API Error: Rate limited",
			"1 | 6 | 30 | hook_error | system:stop_hook_summary:prevented |  |  | - | - | - |  | - | true |  |  |  | lint failed: 2 errors",
			// Two hooks counted, one listed: the other has no command or time.
			"1 | 6 | 30 | hook_run | system:stop_hook_summary:prevented |  |  | - | - | - | bun run lint | 4210 | true |  |  |  | preventedContinuation: true\\nstopReason: Fix lint before stopping\\nhookError: lint failed: 2 errors",
			"1 | 6 | 30 | hook_run | system:stop_hook_summary:prevented |  |  | - | - | - |  | - | true |  |  |  | preventedContinuation: true\\nstopReason: Fix lint before stopping\\nhookError: lint failed: 2 errors",
			"1 | 7 | 40 | refusal | system:model_refusal_fallback |  |  | - | - | - |  | - | - | cyber | claude-opus-5-5 | claude-opus-4-8 | safeguards flagged this session",
			"1 | 8 | 45 | notice | system:informational |  |  | - | - | - |  | - | - |  |  |  | continuing once with that noted",
			"2 | 10 | 110 | compaction | compact_boundary |  |  | - | - | - |  | - | - |  |  |  | Conversation compacted",
			"2 | 12 | 120 | hook_run | system:stop_hook_summary |  |  | - | - | - | notify | 12 | false |  |  |  | ",
		]);
		// Per run, the events add up to the runs columns that count them.
		expect(
			await sql(
				`SELECT r.turn_idx AS turn, r.api_errors AS api_errors, e.api_errors AS api_error_rows,
					r.retry_attempts AS retries, e.retries AS retry_rows, r.refusals AS refusals, e.refusals AS refusal_rows,
					r.hook_count AS hooks, e.hooks AS hook_rows, r.compactions AS compactions, e.compactions AS compaction_rows,
					JSONLength(r.hook_errors) AS hook_errors, e.hook_errors AS hook_error_rows
				FROM runs AS r
				JOIN (
					SELECT run_id, countIf(event = 'api_error') AS api_errors, countIf(event = 'retry') AS retries,
						countIf(event = 'refusal') AS refusals, countIf(event = 'hook_run') AS hooks,
						countIf(event = 'compaction') AS compactions, countIf(event = 'hook_error') AS hook_errors
					FROM events WHERE at >= now() - INTERVAL 2 HOUR AND session_id = '${session}'
					GROUP BY run_id
				) AS e ON e.run_id = r.run_id
				ORDER BY turn`,
			),
		).toEqual([
			"turn | api_errors | api_error_rows | retries | retry_rows | refusals | refusal_rows | hooks | hook_rows | compactions | compaction_rows | hook_errors | hook_error_rows",
			"1 | 1 | 1 | 2 | 2 | 1 | 1 | 2 | 2 | 0 | 0 | 1 | 1",
			"2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 1 | 0 | 0",
		]);
	});
});
