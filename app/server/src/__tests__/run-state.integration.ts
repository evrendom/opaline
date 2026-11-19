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
 * Run columns of the session's state against real ClickHouse, through the
 * build and the runs view: the MCP servers a stream last recorded as
 * unavailable, and a run a queued prompt ended mid-work.
 */

setDefaultTimeout(180_000);

const RUN = `run_state_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const member = `${RUN}_member`;
const session = `${RUN}_session`;
const queuedSession = `${RUN}_queued`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const sessionDate = new Date(baseMs).toISOString();
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
		attachment: (attachment: Record<string, unknown>) =>
			line({ type: "attachment", attachment }),
		say: (text: string) =>
			line({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text }] },
			}),
	};
}

async function upload(
	content: string,
	subagents: Record<string, string>,
	sessionId = session,
) {
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId: member,
		sessionId,
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
				session_id: sessionId,
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
		session: { userId: member, source: "claude_code", sessionId },
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

test("a run lists the MCP servers its stream last recorded as needing authentication or failed, carried until the next record", async () => {
	const main = stream(0);
	const sub = stream(100, SUBAGENT);
	await upload(
		[
			main.attachment({
				type: "deferred_tools_delta",
				addedNames: ["mcp__linear__list_issues"],
				needsAuthMcpServers: ["linear", "claude.ai Gmail"],
				pendingMcpServers: ["playwright"],
				failedMcpServers: [
					{
						name: "pencil",
						errorCode: "ENOENT",
						error: "ENOENT: no such file",
					},
				],
			}),
			main.prompt("list my issues"),
			main.say("Linear needs a sign-in."),
			main.prompt("try again"),
			// A delta that only adds tools says nothing about the servers.
			main.attachment({
				type: "deferred_tools_delta",
				addedNames: ["mcp__x__y"],
			}),
			main.say("Still no Linear."),
			main.prompt("signed in now"),
			main.attachment({
				type: "deferred_tools_delta",
				needsAuthMcpServers: ["claude.ai Gmail"],
				failedMcpServers: [],
			}),
			main.say("Linear works."),
		].join("\n"),
		{
			[SUBAGENT]: [sub.prompt("check the board"), sub.say("Done.")].join("\n"),
		},
	);
	expect(
		await sql(
			`SELECT agent_id != '' AS subagent, turn_idx, mcp_unavailable, has(unrecorded_facts, 'mcp_unavailable') AS unknown
			FROM runs WHERE session_id = '${session}' ORDER BY agent_id, turn_idx`,
		),
	).toEqual([
		"subagent | turn_idx | mcp_unavailable | unknown",
		'0 | 1 | ["claude.ai Gmail","linear","pencil"] | 0',
		'0 | 2 | ["claude.ai Gmail","linear","pencil"] | 0',
		'0 | 3 | ["claude.ai Gmail"] | 0',
		// The subagent stream recorded no server state of its own.
		"1 | 1 | [] | 0",
	]);
});

test("a run a queued prompt ended mid-work says so, and is not said done or re-asked", async () => {
	const main = stream(0);
	await upload(
		[
			main.prompt("fix the login page"),
			// A message mid-work that reads as done, then the person's queued
			// correction: the agent reads it at its next request.
			main.say("Done with the form, now the tests."),
			main.attachment({
				type: "queued_command",
				prompt: "wtf, use the old header",
				commandMode: "prompt",
			}),
			...main.bash("toolu_tests", "bun test", "12 pass", {
				toolUseResult: { stdout: "12 pass", stderr: "" },
			}),
			main.say("Done: the old header is back."),
			main.prompt("ship it"),
			main.say("Shipped."),
		].join("\n"),
		{},
		queuedSession,
	);
	expect(
		await sql(
			`SELECT turn_idx, prompt_subtype, ended_by_queued_prompt, said_done, frustrated, reasked
			FROM runs WHERE session_id = '${queuedSession}' ORDER BY turn_idx`,
		),
	).toEqual([
		"turn_idx | prompt_subtype | ended_by_queued_prompt | said_done | frustrated | reasked",
		"1 |  | true | false | true | false",
		"2 | queued | false | true | false | false",
		"3 |  | false | false | false | false",
	]);
});
