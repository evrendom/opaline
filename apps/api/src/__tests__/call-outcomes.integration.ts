import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";

/**
 * Whether each call was interrupted or stopped by its timeout, in the calls
 * view against real ClickHouse: a main-stream timeout with its recorded
 * limit, an interrupted call, and a subagent timeout whose hand-off text is
 * the only record of it.
 */

setDefaultTimeout(180_000);

const RUN = `call_outcomes_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const session = `${RUN}_session`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const sessionDate = new Date(baseMs).toISOString();
const TASKS = "/private/tmp/claude-501/-repo/s/tasks";
const SUBAGENT = "a1b2c3d4e5f6a7b8c";

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: member, role: "member", ownSessionsOnly: false },
};

/** A Claude Code stream: lines one second apart. */
function stream(startSecond: number, agentId?: string) {
	let second = startSecond;
	const line = (body: Record<string, unknown>) =>
		JSON.stringify({
			sessionId: "s",
			cwd: "/repo",
			gitBranch: "main",
			version: "2.1.300",
			entrypoint: "cli",
			...(agentId === undefined ? {} : { isSidechain: true, agentId }),
			timestamp: new Date(baseMs + ++second * 1_000).toISOString(),
			...body,
		});
	return {
		prompt: (text: string) =>
			line({ type: "user", message: { role: "user", content: text } }),
		bash: (
			id: string,
			command: string,
			output: string,
			result: { isError?: boolean; toolUseResult?: unknown } = {},
		) => [
			line({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
				},
			}),
			line({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content: output,
							is_error: result.isError === true,
						},
					],
				},
				...(result.toolUseResult === undefined
					? {}
					: { toolUseResult: result.toolUseResult }),
			}),
		],
		say: (text: string) =>
			line({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text }] },
			}),
	};
}

const handOff = (seconds: number, task: string) =>
	`Command did not complete within its ${seconds}s timeout and was moved to the background (ID: ${task}). Output is being written to: ${TASKS}/${task}.output`;

async function upload(content: string, subagents: Record<string, string>) {
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId: member,
		sessionId: session,
		source: "claude_code",
		revision: "1",
		sessionDate,
		contentSha256: hashTranscriptContent(content),
		assertWritable: async () => {},
		drafts: splitSessionTranscript(
			{ content, sessionDate, source: "claude_code", subagents },
			stats,
		),
		summary: () => summarizeSplit(stats),
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
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: "/repo",
				git_remote: "github.com/acme/shop",
				git_branch: "main",
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
	const outcome = await runSql(
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
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.setup_texts",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

test("a call says whether it was interrupted or stopped by its timeout, and the limit, also in a subagent stream", async () => {
	const main = stream(0);
	const sub = stream(100, SUBAGENT);
	await upload(
		[
			main.prompt("run the suites"),
			...main.bash("toolu_slow", "bun test", handOff(120, "bslow1234"), {
				toolUseResult: { stdout: "", stderr: "", timedOutAfterMs: 120_000 },
			}),
			...main.bash(
				"toolu_stop",
				"bun run e2e",
				"[Request interrupted by user for tool use]",
				{ isError: true },
			),
			...main.bash("toolu_ok", "ls", "a\nb", {
				toolUseResult: { stdout: "a\nb", stderr: "" },
			}),
			main.say("Stopped the e2e run."),
		].join("\n"),
		{
			[SUBAGENT]: [
				sub.prompt("run the slow suite"),
				// A subagent transcript keeps no toolUseResult.
				...sub.bash(
					"toolu_sub_slow",
					"bun test:slow",
					handOff(600, "bsub1234"),
				),
				sub.say("Moved to the background."),
			].join("\n"),
		},
	);
	expect(
		await sql(
			`SELECT call_id, agent_id != '' AS subagent, interrupted, timed_out, ifNull(toString(timed_out_after_ms), '-') AS limit_ms, failed
			FROM calls
			WHERE started_at >= now() - INTERVAL 2 HOUR AND session_id = '${session}'
			ORDER BY started_at`,
		),
	).toEqual([
		"call_id | subagent | interrupted | timed_out | limit_ms | failed",
		"toolu_slow | 0 | 0 | 1 | 120000 | 0",
		"toolu_stop | 0 | 1 | 0 | - | 1",
		"toolu_ok | 0 | 0 | 0 | - | 0",
		"toolu_sub_slow | 1 | 0 | 1 | 600000 | 0",
	]);
});
