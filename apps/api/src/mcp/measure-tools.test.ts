import { expect, test } from "bun:test";

type Outcome = { result: string } | { error: string };

interface Loaded {
	listed: {
		name: string;
		inputSchema: { properties: Record<string, unknown> };
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
			`const { MCP_TOOLS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const { listMeasures, describeMeasure } = await import(${JSON.stringify(new URL("../services/analysis/retro-measures.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const calls = [];
const sql = {
	id: "sr_m", title: "Time lost by failure cause, 2026-10-06..2026-11-03", query: "WITH picked AS (…) SELECT …", columns: ["kind", "cause", "session_id"],
	rows: 1, truncated: false, table: "kind | cause | session_id\\nrefused | Bash: permission-rule | s1",
	notices: ["not evidence: these rows say where to look, not why."], sessions: [], runs: [],
	measure: { name: "time_lost_by_cause", status: "approved", hash: "h", from: "2026-10-06", to: "2026-11-03" },
	trace: { analysis: "a_1", step: "s_1", query: "q_1" },
};
const check = { id: "ck_1", name: "pushed before typecheck", definition: { kind: "runs", where: "failed_calls >= 10", target: "session" }, enabled: false, createdAt: "2026-11-04T00:00:00.000Z" };
const client = { analysis: {
	measures: {
		list: async () => { calls.push({ tool: "measures.list", input: null }); return { measures: listMeasures() }; },
		describe: async (input) => { calls.push({ tool: "measures.describe", input }); return describeMeasure(input.name, new Date("2026-11-04T00:00:00Z")); },
		run: async (input) => { calls.push({ tool: "measures.run", input }); return sql; },
	},
	checks: {
		test: async (input) => { calls.push({ tool: "checks.test", input }); return { check: { name: "test", definition: input.definition }, over: "the last 500 runs", matches: 3, result: { ...sql, measure: undefined } }; },
		create: async (input) => { calls.push({ tool: "checks.create", input }); return { check: { ...check, name: input.name, definition: input.definition }, notices: ["Saved off: nothing runs checks on a schedule yet."] }; },
		list: async () => { calls.push({ tool: "checks.list", input: null }); return { checks: [check] }; },
		run: async (input) => { calls.push({ tool: "checks.run", input }); return { check: { name: check.name, definition: check.definition }, over: "runs that started 2026-10-06..2026-11-03", matches: 0, result: { ...sql, rows: 0, measure: undefined } }; },
	},
} };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const flow = {
	list: await outcome(tool("measures").run(client, { action: "list" }, context)),
	describe: await outcome(tool("measures").run(client, { action: "describe", name: "files_hunted_before_edit" }, context)),
	run: await outcome(tool("measures").run(client, { action: "run", name: "time_lost_by_cause", from: "2026-10-06", to: "2026-11-03", repository: "athena", latest: 50, analysis: "a_1", workspace: "w" }, context)),
	runWithoutName: await outcome(tool("measures").run(client, { action: "run" }, context)),
	listWithName: await outcome(tool("measures").run(client, { action: "list", name: "cost" }, context)),
	badSession: await outcome(tool("measures").run(client, { action: "run", name: "cohort", sessions: ["a b"] }, context)),
	checkTest: await outcome(tool("checks").run(client, { action: "test", where: "failed_calls >= 10", target: "session", last: 200 }, context)),
	checkCreate: await outcome(tool("checks").run(client, { action: "create", name: "cat keeps failing", measure: "time_lost_by_cause", column: "failed_calls", min: 20, repository: "athena" }, context)),
	checkBoth: await outcome(tool("checks").run(client, { action: "test", where: "1", measure: "cohort" }, context)),
	checkMeasureTarget: await outcome(tool("checks").run(client, { action: "test", measure: "cohort", column: "runs", min: 1, target: "run" }, context)),
	checkList: await outcome(tool("checks").run(client, { action: "list" }, context)),
	checkRun: await outcome(tool("checks").run(client, { action: "run", id: "ck_1", from: "2026-10-06" }, context)),
	checkRunWithWhere: await outcome(tool("checks").run(client, { action: "run", id: "ck_1", where: "1" }, context)),
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
const text = (outcome: Outcome | undefined) =>
	outcome && "result" in outcome
		? outcome.result
		: `error: ${outcome && "error" in outcome ? outcome.error : "missing"}`;

test("measures lists, describes and runs, and passes only the inputs its action takes", async () => {
	const { flow, calls } = await loaded;
	expect(text(flow.list)).toContain(
		"time_lost_by_cause | query | approved | false | minutes",
	);
	expect(text(flow.list)).toContain(
		"active_time | aggregate | approved | false | minutes",
	);
	expect(text(flow.describe)).toContain(
		"measure=files_hunted_before_edit kind=query status=approved is_drifted=false unit=calls",
	);
	expect(text(flow.describe)).toContain("FROM calls");
	expect(text(flow.run).split("\n").slice(0, 2)).toEqual([
		"measure=time_lost_by_cause status=approved is_drifted=false window=2026-10-06..2026-11-03",
		"sql result=sr_m title=Time lost by failure cause, 2026-10-06..2026-11-03 rows=1 truncated=false",
	]);
	expect(calls.find((call) => call.tool === "measures.run")?.input).toEqual({
		name: "time_lost_by_cause",
		from: "2026-10-06",
		to: "2026-11-03",
		repository: "athena",
		latest: 50,
		limit: 50,
		analysis: "a_1",
	});
	expect(flow.runWithoutName).toEqual({
		error: "action=run needs name: a measure name from action=list",
	});
	expect(flow.listWithName).toEqual({
		error: "name is not an input of action=list; it takes nothing else",
	});
	expect(text(flow.badSession)).toStartWith("error: sessions.0:");
});

test("checks tests a condition, saves it off, lists and runs it, and refuses mixed definitions", async () => {
	const { flow, calls } = await loaded;
	expect(text(flow.checkTest).split("\n")[0]).toBe(
		"check test over the last 500 runs: matches=3 (target=session where failed_calls >= 10)",
	);
	expect(calls.find((call) => call.tool === "checks.test")?.input).toEqual({
		definition: {
			kind: "runs",
			where: "failed_calls >= 10",
			target: "session",
		},
		last: 200,
	});
	expect(calls.find((call) => call.tool === "checks.create")?.input).toEqual({
		name: "cat keeps failing",
		definition: {
			kind: "measure",
			measure: "time_lost_by_cause",
			column: "failed_calls",
			min: 20,
			repository: "athena",
		},
	});
	expect(text(flow.checkCreate)).toContain("enabled=false");
	expect(text(flow.checkCreate)).toContain("note: Saved off");
	expect(flow.checkBoth).toEqual({ error: "give where or measure, not both" });
	expect(flow.checkMeasureTarget).toEqual({
		error: "target goes with where; a measure's rows are its own",
	});
	expect(text(flow.checkList)).toStartWith(
		"check id=ck_1 name=pushed before typecheck enabled=false",
	);
	expect(text(flow.checkRun)).toContain("matches=0");
	expect(calls.find((call) => call.tool === "checks.run")?.input).toEqual({
		id: "ck_1",
		from: "2026-10-06",
	});
	expect(flow.checkRunWithWhere).toEqual({
		error:
			"where is not an input of action=run; it takes id, from, to, analysis",
	});
});

test("both tools add only the caller's own records and are listed with their actions", async () => {
	const { listed } = await loaded;
	for (const name of ["measures", "checks"]) {
		const tool = listed.find((item) => item.name === name);
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		});
		expect(tool?.inputSchema.properties).toHaveProperty("action");
	}
});
