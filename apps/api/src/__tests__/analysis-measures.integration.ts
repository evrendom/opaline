import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import "./helpers/local-integration-guard.js";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	describeSchema,
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

/** Every query gets a slot at once. */
const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/**
 * The approved measures and coverage columns as an agent reads them with
 * `sql`: sessions are uploaded as transcripts, indexed by the run index
 * worker, and counted through the runs and calls views.
 */

setDefaultTimeout(120_000);
const RUN = `analysis_measures_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const memberId = `${RUN}_member`;
const reasked = `${RUN}_reasked`;
const bare = `${RUN}_bare`;
const wording = `${RUN}_wording`;
const resumed = `${RUN}_resumed`;
const parent = `${RUN}_parent`;
const fork = `${RUN}_fork`;
const DAY = 86_400;
const clickhouse = getClickhouse();
const SESSION_DATE = new Date(Date.now() - 3_600_000).toISOString();
const START = Date.now() - 3_000_000;
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: memberId, role: "member", ownSessionsOnly: false },
};
const env = () => ({
	executor: clickhouse,
	results: createMemorySqlResultStore(),
	quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
	limiter: unlimited,
	githubRepositories: async () => [],
});

/** A Claude Code main-stream line, `second` seconds into the session. */
const line = (second: number, body: Record<string, unknown>) =>
	JSON.stringify({
		sessionId: "measures",
		cwd: "/repo",
		version: "2.1.292",
		entrypoint: "cli",
		timestamp: new Date(START + second * 1000).toISOString(),
		...body,
	});
const prompt = (second: number, text: string) =>
	line(second, { type: "user", message: { role: "user", content: text } });
const said = (second: number, text: string) =>
	line(second, {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
const call = (second: number, id: string, command: string) =>
	line(second, {
		type: "assistant",
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
		},
	});
const result = (second: number, id: string) =>
	line(second, {
		type: "user",
		message: {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
		},
		toolUseResult: {
			stdout: "ok",
			stderr: "",
			interrupted: false,
			isImage: false,
		},
	});

/**
 * Four runs, read by hand. 1 says it is done and the member answers that it
 * still does not work: a re-ask. 2 says it fixed it (after a one-minute
 * call) and the member thanks it. 3 ends on a question and the member swears
 * at it: frustration, not a re-ask. 4 ends on a call that never returned.
 * The harness recorded the system prompt before the first prompt.
 */
const REASKED = [
	line(0, {
		type: "attachment",
		attachment: {
			type: "prompt_snapshot",
			systemPrompt: ["You are Claude Code."],
		},
	}),
	prompt(1, "add a login form"),
	said(5, "Done. I added the login form to the page."),
	prompt(60, "it still doesn't work"),
	call(61, "toolu_test", "bun test"),
	result(121, "toolu_test"),
	said(130, "Fixed: the form posts to /login now."),
	prompt(200, "thanks, that works great"),
	said(205, "Should I add tests for it?"),
	prompt(300, "this is wrong, shit"),
	call(301, "toolu_hang", "bun run dev"),
];
/** One run with no system prompt recorded. */
const BARE = [prompt(1, "rename the button"), said(4, "Done, renamed it.")];
/**
 * How the said-done rule reads a message, each answered unhappily. 1 denies
 * one fix but claims another: said done. 2 was cut before its last word, so
 * it is unknown; 3 was cut too, but had already said done. 4 says nothing.
 */
const WORDING = [
	prompt(1, "fix the header"),
	said(5, "The first attempt was not fixed. Now I have implemented the fix."),
	prompt(60, "it still doesn't work"),
	said(65, `${"context ".repeat(300)} Done.`),
	prompt(120, "it still doesn't work"),
	said(125, `Done. ${"context ".repeat(300)}`),
	prompt(180, "it still doesn't work"),
	said(185, "Here is the plan."),
];
/** A session started ten days ago and resumed in the last hour, a call in each. */
const RESUMED = [
	prompt(-10 * DAY, "start the migration"),
	call(-10 * DAY + 1, "toolu_old", "bun run migrate"),
	result(-10 * DAY + 2, "toolu_old"),
	prompt(1, "finish the migration"),
	call(2, "toolu_new", "bun run migrate"),
	result(3, "toolu_new"),
];

/** A Codex line, `second` seconds into the session. */
const codex = (
	second: number,
	type: string,
	payload: Record<string, unknown>,
) =>
	JSON.stringify({
		timestamp: new Date(START + second * 1000).toISOString(),
		type,
		payload,
	});
const codexCall = (second: number, id: string) => [
	codex(second, "response_item", {
		type: "function_call",
		name: "exec_command",
		arguments: JSON.stringify({ cmd: "bun test" }),
		call_id: id,
	}),
	codex(second + 1, "response_item", {
		type: "function_call_output",
		call_id: id,
		output: "Process exited with code 0\nOutput:\nok",
	}),
];
const codexPrompt = (second: number) =>
	codex(second, "response_item", {
		type: "message",
		role: "user",
		content: [{ type: "input_text", text: "run the tests" }],
	});
/** A Codex session with one call, and a fork of it that copies that call (no ordinals mark it) and makes one of its own. */
const PARENT = [
	codex(0, "session_meta", { id: parent, cli_version: "0.156.0" }),
	codexPrompt(1),
	...codexCall(2, "call_parent"),
];
const FORK = [
	codex(100, "session_meta", {
		id: fork,
		cli_version: "0.156.0",
		forked_from_id: parent,
	}),
	codexPrompt(101),
	...codexCall(102, "call_parent"),
	...codexCall(110, "call_fork"),
];

async function upload(
	sessionId: string,
	lines: readonly string[],
	{
		source = "claude_code",
		sessionDate = SESSION_DATE,
	}: { source?: "claude_code" | "codex"; sessionDate?: string } = {},
) {
	const content = lines.join("\n");
	const identity = {
		organizationId: workspace,
		userId: memberId,
		sessionId,
		source,
		revision: "1",
		sessionDate,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript({ content, sessionDate, source }, stats),
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
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: memberId, source, sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function table(query: string): Promise<string> {
	const outcome: SqlOutcome = await runSql(
		caller,
		{ query, title: "measures" },
		env(),
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table;
}

beforeAll(async () => {
	await upload(reasked, REASKED);
	await upload(bare, BARE);
	await upload(wording, WORDING);
	await upload(resumed, RESUMED, {
		sessionDate: new Date(START - 10 * DAY * 1000).toISOString(),
	});
	await upload(parent, PARENT, { source: "codex" });
	await upload(fork, FORK, { source: "codex" });
	const [second] = await clickhouse.query<{ run_id: string }>({
		query: `SELECT run_id FROM rudel.run_index WHERE organization_id = {workspace:String}
			AND session_id = {session:String} AND row_kind = 'run' AND turn_idx = 2`,
		query_params: { workspace, session: reasked },
	});
	expect(second?.run_id).toBeTruthy();
	// The worker linked run 2 to the commit it made.
	await clickhouse.insert({
		table: "rudel.l1_edges",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				from_kind: "run",
				from_id: second?.run_id,
				relation: "commit_created",
				to_kind: "commit",
				to_id: "1/abc",
				evidence_id: "e1",
				user_id: memberId,
				source: "claude_code",
				session_id: reasked,
				revision: 1,
				is_active: 1,
			},
		],
	});
});

afterAll(async () => {
	for (const name of ["transcript_records", "run_index", "l1_edges"])
		await clickhouse.execute({
			query: `DELETE FROM rudel.${name} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

describe("approved measures", () => {
	test("a run that said it was done and was answered unhappily is a re-ask; frustration alone is not", async () => {
		expect(
			await table(`SELECT turn_idx, said_done, frustrated, reasked FROM runs
				WHERE session_id = '${reasked}' ORDER BY turn_idx`),
		).toBe(
			[
				"turn_idx | said_done | frustrated | reasked",
				"1 | true | true | true",
				"2 | true | false | false",
				"3 | false | true | false",
				"4 | false | false | false",
			].join("\n"),
		);
		expect(
			await table(`SELECT countIf(reasked) AS re_asks, countIf(frustrated) AS frustration,
				count() AS runs, uniqExact(user_id) AS members FROM runs
				WHERE session_id IN ('${reasked}', '${bare}')
				GROUP BY toMonday(started_at)`),
		).toBe("re_asks | frustration | runs | members\n1 | 2 | 5 | 1");
	});

	test("one completion word not negated is enough; a message cut before it is unknown", async () => {
		expect(
			await table(`SELECT turn_idx, said_done, frustrated, reasked FROM runs
				WHERE session_id = '${wording}' ORDER BY turn_idx`),
		).toBe(
			[
				"turn_idx | said_done | frustrated | reasked",
				"1 | true | true | true",
				"2 | null | true | null",
				"3 | true | true | true",
				"4 | false | false | false",
			].join("\n"),
		);
	});

	test("a forked Codex session's calls copied from its parent are not its own, as in the run facts", async () => {
		expect(
			await table(`SELECT session_id = '${fork}' AS forked, call_id FROM calls
				WHERE session_id IN ('${parent}', '${fork}') ORDER BY forked, call_id`),
		).toBe("forked | call_id\n0 | call_parent\n1 | call_fork");
		expect(
			await table(
				`SELECT sum(tool_calls) AS calls FROM runs WHERE session_id = '${fork}'`,
			),
		).toBe("calls\n1");
	});

	test("a time range on calls keeps every call made in it, in sessions that started before it too", async () => {
		expect(
			await table(`SELECT call_id FROM calls
				WHERE started_at >= now() - INTERVAL 1 DAY AND session_id = '${resumed}'`),
		).toBe("call_id\ntoolu_new");
		expect(
			await table(`SELECT call_id FROM calls WHERE session_id = '${resumed}'
				AND started_at < now() - INTERVAL 1 DAY`),
		).toBe("call_id\ntoolu_old");
	});

	test("a group of calls has its own time and the time of the runs that contain it", async () => {
		expect(
			await table(`SELECT turn_idx, tool_name, call_minutes FROM calls
				WHERE session_id = '${reasked}' ORDER BY turn_idx`),
		).toBe(
			"turn_idx | tool_name | call_minutes\n2 | Bash | 1\n4 | Bash | null",
		);
		expect(
			await table(`SELECT
				(SELECT sum(call_minutes) FROM calls WHERE tool_name = 'Bash' AND session_id = '${reasked}') AS own,
				(SELECT sum(active_minutes) FROM runs WHERE run_id IN (SELECT run_id FROM calls WHERE tool_name = 'Bash' AND session_id = '${reasked}')) =
				(SELECT sum(active_minutes) FROM runs WHERE session_id = '${reasked}' AND turn_idx IN (2, 4)) AS runs_once`),
		).toBe("own | runs_once\n1 | 1");
	});

	test("every view says which evidence is unknown: no system prompt, setup snapshot, GitHub link or embedding", async () => {
		expect(
			await table(`SELECT session_id = '${bare}' AS bare, turn_idx, coverage_gaps FROM runs
				WHERE session_id IN ('${reasked}', '${bare}') ORDER BY bare, turn_idx`),
		).toBe(
			[
				"bare | turn_idx | coverage_gaps",
				`0 | 1 | ["setup_snapshot","github_link","embedding"]`,
				`0 | 2 | ["setup_snapshot","embedding"]`,
				`0 | 3 | ["setup_snapshot","github_link","embedding"]`,
				`0 | 4 | ["setup_snapshot","github_link","embedding"]`,
				`1 | 1 | ["system_prompt","setup_snapshot","github_link","embedding"]`,
			].join("\n"),
		);
		expect(
			await table(`SELECT turn_idx, coverage_gaps FROM calls
				WHERE session_id = '${reasked}' ORDER BY turn_idx LIMIT 1`),
		).toBe(`turn_idx | coverage_gaps\n2 | ["setup_snapshot","embedding"]`);
	});

	test("schema lists the measures the views compute", async () => {
		const outcome = await describeSchema(caller, {}, env());
		if (!outcome.ok || outcome.result.level !== "views")
			throw new Error("Expected views");
		for (const measure of outcome.result.measures.filter(
			(measure) => !measure.sql.includes("<the group>"),
		))
			expect(
				await table(`SELECT ${measure.sql} AS value FROM runs`),
			).toStartWith("value\n");
	});
});
