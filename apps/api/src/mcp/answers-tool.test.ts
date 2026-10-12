import { expect, test } from "bun:test";

/**
 * The answers MCP tool as a client sees it: one tool whose explicit action
 * searches saved answers, opens one, or opens one stored result (a step's
 * query, or an sql result by its id), over the history procedures as the API
 * runs them on an in-memory log and result store. The tools it replaces stay
 * as aliases. MCP_TOOLS loads in a child process because the module opens the
 * Postgres pool on import (without connecting).
 */

type Outcome = { result: string } | { error: string };

interface Loaded {
	listed: { name: string; inputSchema: Record<string, unknown> }[];
	ids: { analysis: string; query: string; sql: string; removedSql: string };
	flow: Record<string, Outcome>;
}

async function load(): Promise<Loaded> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const service = await import(${JSON.stringify(new URL("../services/analysis-log/analysis-log.service.ts", import.meta.url).href)});
const results = await import(${JSON.stringify(new URL("../services/analysis/sql-results.ts", import.meta.url).href)});
const { createMemoryAnalysisStore } = await import(${JSON.stringify(new URL("../services/analysis-log/memory-store.ts", import.meta.url).href)});
const { createLocalEmbedder } = await import(${JSON.stringify(new URL("../services/analysis-log/embedder.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const log = { store: createMemoryAnalysisStore(), embedder: createLocalEmbedder(), now: () => new Date() };
const sqlResults = results.createMemorySqlResultStore();
const viewer = { workspaceId: "w", userId: "u", isAdmin: false, restrictResults: false, onlyMember: null };
const client = { analysis: { history: {
	get: (input) => service.getAnalysisTree(log, viewer, input.analysis),
	search: (input) => service.searchAnalyses(log, viewer, input),
	query: (input) => service.getStoredQuery(log, viewer, input.query, async () => new Map()),
	sqlResult: (input) => results.openSqlResult(sqlResults, viewer, input.id, new Date()),
} } };
const output = { title: "Longest runs", query: "SELECT session_id, active_minutes FROM runs ORDER BY active_minutes DESC", columns: ["session_id", "active_minutes"], rows: 1, truncated: false, table: "session_id | active_minutes\\ns1 | 41.5", notices: ["not evidence: open the runs."], sessions: [], runs: [] };
const stored = (owners) => sqlResults.save({ workspaceId: "w", authorId: "u", title: output.title, query: output.query, output, owners, counts: true, queryCarriesText: false });
const sql = await stored(["u"]);
const removedSql = await stored(["u", "gone"]);
await sqlResults.purge({ targetType: "account", targetId: "gone" });
const trace = await service.recordQuery(log, { workspaceId: "w", userId: "u", host: "plugin" }, { tool: "sql", args: { query: output.query, title: output.title }, trace: {}, output: { id: sql, ...output }, outputChars: 200, sessions: [], owners: ["u"] });
await service.saveAnalysis(log, viewer, { analysis: trace.analysis, question: "Where our agents spend time", finalAnswer: "In long test runs.", findings: [{ step: trace.query, finding: "Test runs are the longest." }], topics: ["time"], changes: [] });
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const run = (name, args) => outcome(tool(name).run(client, args, context));
const flow = {
	search: await run("answers", { action: "search", text: "agents spend time" }),
	searchAlias: await run("search_answers", { text: "agents spend time" }),
	open: await run("answers", { action: "open", analysis: trace.analysis }),
	openAlias: await run("get_answer", { analysis: trace.analysis }),
	query: await run("answers", { action: "result", id: trace.query }),
	queryAlias: await run("get_answer_evidence", { query: trace.query }),
	sql: await run("answers", { action: "result", id: sql }),
	removedSql: await run("answers", { action: "result", id: removedSql }),
	missingSql: await run("answers", { action: "result", id: "sr_missing" }),
	openWithoutAnalysis: await run("answers", { action: "open" }),
	resultWithoutId: await run("answers", { action: "result" }),
	searchWithAnalysis: await run("answers", { action: "search", analysis: trace.analysis }),
	unknownAction: await run("answers", { action: "delete", analysis: trace.analysis }),
};
console.log(JSON.stringify({ listed: MCP_TOOLS.map(listedTool), ids: { analysis: trace.analysis, query: trace.query, sql, removedSql }, flow }));`,
		],
		{
			env: {
				PATH: process.env.PATH,
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return JSON.parse(stdout);
}

const loaded = load();

const resultOf = (outcome: Outcome | undefined) => {
	if (!outcome || !("result" in outcome))
		throw new Error(`Expected a result: ${JSON.stringify(outcome)}`);
	return outcome.result;
};
const errorOf = (outcome: Outcome | undefined) => {
	if (!outcome || !("error" in outcome))
		throw new Error(`Expected an error: ${JSON.stringify(outcome)}`);
	return outcome.error;
};

test("answers takes an explicit action and the inputs of each action", async () => {
	const { listed } = await loaded;
	const answers = listed.find((tool) => tool.name === "answers");
	expect(answers?.inputSchema).toMatchObject({
		type: "object",
		required: ["action"],
		additionalProperties: false,
		properties: { action: { enum: ["search", "open", "result"] } },
	});
	expect(Object.keys(answers?.inputSchema.properties ?? {}).sort()).toEqual([
		"action",
		"analysis",
		"id",
		"includeEval",
		"limit",
		"text",
		"workspace",
	]);
});

test("answers searches saved answers, opens one and opens one stored result, as the tools it replaces did", async () => {
	const { flow, ids } = await loaded;
	expect(resultOf(flow.search)).toContain(ids.analysis);
	expect(resultOf(flow.search)).toContain("Where our agents spend time");
	expect(resultOf(flow.open)).toContain("Test runs are the longest.");
	expect(resultOf(flow.open)).toContain(ids.query);
	expect(resultOf(flow.query)).toContain(`query ${ids.query}`);
	expect(resultOf(flow.query)).toContain("s1 | 41.5");
	// The old tools still answer, the same way.
	expect(flow.searchAlias).toEqual(flow.search);
	expect(flow.openAlias).toEqual(flow.open);
	expect(flow.queryAlias).toEqual(flow.query);
});

test("answers opens an sql result by its id with its title and SQL, and a removed one without its rows", async () => {
	const { flow, ids } = await loaded;
	const opened = resultOf(flow.sql);
	expect(opened).toContain(`sql result=${ids.sql}`);
	expect(opened).toContain("Longest runs");
	expect(opened).toContain("ORDER BY active_minutes DESC");
	expect(opened).toContain("s1 | 41.5");
	const removed = resultOf(flow.removedSql);
	expect(removed).toContain(`sql result=${ids.removedSql}`);
	expect(removed).toContain("unavailable=removed");
	expect(removed).toContain("ORDER BY active_minutes DESC");
	expect(removed).not.toContain("s1 | 41.5");
	expect(errorOf(flow.missingSql)).toContain("sr_missing");
});

test("answers names the input an action needs, and refuses inputs of another action", async () => {
	const { flow } = await loaded;
	expect(errorOf(flow.openWithoutAnalysis)).toContain("analysis");
	expect(errorOf(flow.resultWithoutId)).toContain("id");
	expect(errorOf(flow.searchWithAnalysis)).toContain("analysis");
	expect(errorOf(flow.unknownAction)).toContain("action");
});
