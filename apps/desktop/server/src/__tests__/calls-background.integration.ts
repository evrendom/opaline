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
 * Background calls and hook blocks in the calls view (parser 11), against
 * real ClickHouse: a call's work that went on in the background ends with
 * its task notification, which can come in a later run.
 */

setDefaultTimeout(120_000);

const RUN = `calls_bg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const session = `${RUN}_session`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const tasks = "/private/tmp/claude-501/-repo/s1/tasks";

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
const call = (
	seconds: number,
	id: string,
	name: string,
	input: Record<string, unknown>,
) =>
	line(seconds, {
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name, input }],
		},
	});
const result = (
	seconds: number,
	id: string,
	content: string,
	toolUseResult: unknown,
	isError = false,
) =>
	line(seconds, {
		type: "user",
		message: {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: id, content, is_error: isError },
			],
		},
		toolUseResult,
	});
const notification = (seconds: number, body: string) =>
	prompt(seconds, `<task-notification>\n${body}\n</task-notification>`);

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
				last_interaction_date: at(900).replace("T", " ").replace("Z", ""),
				project_path: "/test/calls-background",
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

describe("background calls in the calls view", () => {
	test("a call's time runs to the notification that ended its task, in a later run; killed and failed tasks are failures; a hook block is a refusal", async () => {
		await ingest(
			[
				prompt(0, "start the lab and run the tests"),
				call(10, "toolu_lab", "Bash", {
					command: "vite",
					run_in_background: true,
				}),
				result(
					11,
					"toolu_lab",
					`Command running in background with ID: blab12345. Output is being written to: ${tasks}/blab12345.output. You will be notified when it completes.`,
					{ stdout: "", stderr: "", backgroundTaskId: "blab12345" },
				),
				call(20, "toolu_tests", "Bash", { command: "bun test" }),
				result(
					140,
					"toolu_tests",
					`Command did not complete within its 120s timeout and was moved to the background (ID: btest6789). Output is being written to: ${tasks}/btest6789.output.`,
					{ stdout: "", stderr: "" },
				),
				call(150, "toolu_watch", "Monitor", { command: "gh run watch" }),
				result(151, "toolu_watch", "Monitor started.", { taskId: "bmon00001" }),
				call(160, "toolu_bunx", "Bash", { command: "bunx vitest run" }),
				result(
					161,
					"toolu_bunx",
					"PreToolUse:Bash hook error: [/home/me/bin/package-policy]: STOP: This command cannot install or download packages.",
					"Error: PreToolUse:Bash hook error",
					true,
				),
				call(170, "toolu_ls", "Bash", { command: "ls" }),
				result(171, "toolu_ls", "a\nb", { stdout: "a\nb", stderr: "" }),
				notification(
					200,
					"<task-id>bmon00001</task-id>\n<summary>Monitor event: CI</summary>\n<event>in_progress</event>",
				),
				notification(
					320,
					`<task-id>btest6789</task-id>\n<output-file>${tasks}/btest6789.output</output-file>\n<status>failed</status>\n<summary>Background command "bun test" failed (exit code 1)</summary>`,
				),
				prompt(400, "now the copy"),
				notification(
					850,
					`<task-id>blab12345</task-id>\n<tool-use-id>toolu_lab</tool-use-id>\n<status>killed</status>\n<summary>Background command was stopped after reaching its background time limit</summary>`,
				),
			]
				.map((record) => JSON.stringify(record))
				.join("\n"),
		);
		expect(
			await sql(
				`SELECT call_id, turn_idx, backgrounded, ifNull(task_id, '-') AS task, ifNull(background_status, '-') AS status,
					ifNull(toString(exit_code), '-') AS exit, failed, ifNull(toString(round(call_minutes, 2)), '-') AS minutes,
					denial_kind, finished_at IS NULL AS unfinished
				FROM calls
				WHERE started_at >= now() - INTERVAL 2 HOUR AND session_id = '${session}'
				ORDER BY started_at`,
			),
		).toEqual([
			"call_id | turn_idx | backgrounded | task | status | exit | failed | minutes | denial_kind | unfinished",
			// Killed after 14 minutes, the notification two runs on.
			"toolu_lab | 1 | 1 | blab12345 | killed | - | 1 | 14 |  | 0",
			"toolu_tests | 1 | 1 | btest6789 | failed | 1 | 1 | 5 |  | 0",
			// Its hand-off and its event name no output file, so the view keeps
			// the Monitor's own result (the event reports progress, not an end).
			"toolu_watch | 1 | 0 | - | - | - | 0 | 0.02 |  | 0",
			"toolu_bunx | 1 | 0 | - | - | - | 1 | 0.02 | hook | 0",
			"toolu_ls | 1 | 0 | - | - | - | 0 | 0.02 |  | 0",
		]);
		// The run that contains the call still owns it; the notification's run does not.
		expect(
			await sql(
				`SELECT r.turn_idx AS turn, count() AS calls FROM calls AS c JOIN runs AS r ON c.run_id = r.run_id
				WHERE c.started_at >= now() - INTERVAL 2 HOUR AND c.session_id = '${session}'
				GROUP BY turn ORDER BY turn`,
			),
		).toEqual(["turn | calls", "1 | 5"]);
	});
});
