import { expect, test } from "bun:test";

/**
 * The schema and sql MCP tools as a client sees them: their published input,
 * how bad input is refused, and the text a result or a refusal renders to.
 * MCP_TOOLS loads in a child process because the module opens the Postgres
 * pool on import (without connecting); the analysis procedures are stand-ins
 * that answer like the gateway.
 */

type Outcome = { result: string } | { error: string };

interface Loaded {
	listed: {
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
		annotations: Record<string, unknown>;
	}[];
	calls: { tool: string; input: unknown }[];
	flow: Record<string, Outcome>;
}

async function load(): Promise<Loaded> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { ORPCError } = await import("@orpc/server");
const { MCP_TOOLS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const calls = [];
const result = {
	id: "sr_abc", title: "Longest runs", query: "SELECT 1", columns: ["session_id", "active_minutes"],
	rows: 1, truncated: true, table: "session_id | active_minutes\\ns1 | 41.5",
	notices: ["cut: the query returned more than 200 rows; only the first 200 are shown. Cut rows are not missing data: aggregate (GROUP BY with count(), sum(), avg()) or page with ORDER BY … LIMIT 200 OFFSET 200.", "not evidence: these rows say where to look, not why. Open the runs with read (session_id, agent_id, and turn_idx as its turn) before naming a cause."],
	sessions: [], trace: { analysis: "a_1", step: "s_1", query: "q_1" },
};
const client = { analysis: {
	coverage: async () => ({ line: "coverage: 3 sessions in scope" }),
	sql: async (input) => {
		calls.push({ tool: "sql", input });
		if (input.query.includes("claude_sessions"))
			throw new ORPCError("FORBIDDEN", { message: "refused, do not retry: The query reads \\"claude_sessions\\", which is not a view you may query." });
		if (input.query.includes("minutez"))
			throw new ORPCError("BAD_REQUEST", { message: "error, recoverable: Unknown expression identifier \`minutez\`\\nfailing part: minutez\\nfix: Use only columns of the view." });
		return result;
	},
	schema: async (input) => {
		calls.push({ tool: "schema", input });
		if (!input.view) return { level: "views", views: [{ name: "runs", grain: "One row per run.", columns: 90 }], measures: [{ name: "re_asks", sql: "countIf(reasked)", definition: "Runs asked | again." }], notes: ["Pass view to see its columns."], questions: [{ id: "rq_1", question: "Did the agent struggle to find the right file?", testedRuns: 20, testedPrecision: 0.75 }, { id: "rq_2", question: "Did the agent misread the request?", testedRuns: null, testedPrecision: null }] };
		if (!input.column) return { level: "columns", view: "runs", grain: "One row per run.", traps: ["Count rows directly."], columns: [{ name: "model", type: "LowCardinality(Nullable(String))", meaning: "First model | of the run.", traps: ["Recorded by Claude Code and Codex from parser 7."] }] };
		return { level: "values", view: "runs", column: { name: "model", type: "String", meaning: "First model.", traps: [] }, over: "runs that started in the last 30 days", values: [{ value: "gpt-5", rows: 12 }], notices: ["every value is listed."] };
	},
} };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const flow = {
	sql: await outcome(tool("sql").run(client, { query: "SELECT session_id, active_minutes FROM runs", title: "Longest runs", analysis: "a_1", workspace: "w" }, context)),
	sqlWithoutTitle: await outcome(tool("sql").run(client, { query: "SELECT 1 FROM runs" }, context)),
	sqlExtra: await outcome(tool("sql").run(client, { query: "SELECT 1 FROM runs", title: "x", limit: 5 }, context)),
	sqlRefused: await outcome(tool("sql").run(client, { query: "SELECT * FROM claude_sessions", title: "x" }, context)),
	sqlRecoverable: await outcome(tool("sql").run(client, { query: "SELECT minutez FROM runs", title: "x" }, context)),
	views: await outcome(tool("schema").run(client, {}, context)),
	columns: await outcome(tool("schema").run(client, { view: "runs" }, context)),
	values: await outcome(tool("schema").run(client, { view: "runs", column: "model" }, context)),
	columnWithoutView: await outcome(tool("schema").run(client, { column: "model" }, context)),
};
console.log(JSON.stringify({ listed: MCP_TOOLS.map(listedTool), calls, flow }));`,
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

test("sql takes a query and a title, plus the draft and the workspace, and nothing else", async () => {
	const { listed } = await loaded;
	const sql = listed.find((tool) => tool.name === "sql");
	expect(sql?.inputSchema).toMatchObject({
		type: "object",
		required: ["query", "title"],
		additionalProperties: false,
		properties: {
			query: { type: "string", maxLength: 20_000 },
			title: { type: "string", maxLength: 120 },
			analysis: { type: "string" },
			workspace: { type: "string" },
		},
	});
	expect(Object.keys(sql?.inputSchema.properties ?? {}).sort()).toEqual([
		"analysis",
		"query",
		"title",
		"workspace",
	]);
	// It adds to the caller's own draft, like find.
	expect(sql?.annotations).toMatchObject({
		readOnlyHint: false,
		destructiveHint: false,
		openWorldHint: false,
	});
	expect(sql?.description).toContain("not evidence");
});

test("schema takes a view and a column, and only reads", async () => {
	const { listed } = await loaded;
	const schema = listed.find((tool) => tool.name === "schema");
	expect(Object.keys(schema?.inputSchema.properties ?? {}).sort()).toEqual([
		"column",
		"view",
		"workspace",
	]);
	expect(schema?.inputSchema).toMatchObject({ additionalProperties: false });
	expect(schema?.annotations).toMatchObject({ readOnlyHint: true });
});

test("bad input is refused before the server is called", async () => {
	const { flow, calls } = await loaded;
	expect(flow.sqlWithoutTitle).toEqual({
		error: "title: Invalid input: expected string, received undefined",
	});
	expect(flow.sqlExtra).toEqual({
		error: 'input: Unrecognized key: "limit"',
	});
	expect(flow.columnWithoutView).toEqual({
		error: "column: column needs its view",
	});
	expect(calls.map((call) => call.tool)).toEqual([
		"sql",
		"sql",
		"sql",
		"schema",
		"schema",
		"schema",
	]);
	// The workspace picks the workspace; it never reaches the procedure.
	expect(calls[0]?.input).toEqual({
		query: "SELECT session_id, active_minutes FROM runs",
		title: "Longest runs",
		analysis: "a_1",
	});
});

test("an sql result renders its stored id, the table, what was cut and the not-evidence notice", async () => {
	const { flow } = await loaded;
	expect(flow.sql).toEqual({
		result: [
			"url: http://localhost:4011/w/sessions",
			"sql result=sr_abc title=Longest runs rows=1 truncated=true",
			"session_id | active_minutes",
			"s1 | 41.5",
			"note: cut: the query returned more than 200 rows; only the first 200 are shown. Cut rows are not missing data: aggregate (GROUP BY with count(), sum(), avg()) or page with ORDER BY … LIMIT 200 OFFSET 200.",
			"note: not evidence: these rows say where to look, not why. Open the runs with read (session_id, agent_id, and turn_idx as its turn) before naming a cause.",
			"trace analysis=a_1 step=s_1 query=q_1",
			'too large to page through here. If the opaline CLI is available, to compute on all of it, run: opaline sql "SELECT 1" --out rows.jsonl',
			"coverage: 3 sessions in scope",
		].join("\n"),
	});
});

test("refusals reach the agent as the server phrased them: fatal ones say not to retry", async () => {
	const { flow } = await loaded;
	expect(flow.sqlRefused).toEqual({
		error:
			'refused, do not retry: The query reads "claude_sessions", which is not a view you may query.',
	});
	expect(flow.sqlRecoverable).toEqual({
		error:
			"error, recoverable: Unknown expression identifier `minutez`\nfailing part: minutez\nfix: Use only columns of the view.",
	});
});

test("schema renders the views, then a view's columns with meaning and traps, then a column's values", async () => {
	const { flow } = await loaded;
	expect(flow.views).toEqual({
		result: [
			"view | grain | columns",
			"runs | One row per run. | 90",
			"approved measures:",
			"measure | sql | definition",
			"re_asks | countIf(reasked) | Runs asked \\| again.",
			"note: Pass view to see its columns.",
			"run questions (answered for every new run where the workspace has run questions; filter run_answers with sql; estimate_questions, then run_questions, only for runs without answers):",
			"question_id | question | tested runs | tested precision",
			"rq_1 | Did the agent struggle to find the right file? | 20 | 0.75",
			"rq_2 | Did the agent misread the request? | untested | unknown",
		].join("\n"),
	});
	expect(flow.columns).toEqual({
		result: [
			"view runs: One row per run.",
			"trap: Count rows directly.",
			"column | type | meaning | traps",
			"model | LowCardinality(Nullable(String)) | First model \\| of the run. | Recorded by Claude Code and Codex from parser 7.",
		].join("\n"),
	});
	expect(flow.values).toEqual({
		result: [
			"runs.model String: First model.",
			"top values over runs that started in the last 30 days:",
			"value | rows",
			"gpt-5 | 12",
			"note: every value is listed.",
		].join("\n"),
	});
});
