import { expect, test } from "bun:test";

type Outcome = { result: string } | { error: string };

async function load(): Promise<{
	calls: { tool: string; input: Record<string, unknown> }[];
	flow: Record<string, Outcome>;
}> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const tool = MCP_TOOLS.find((candidate) => candidate.name === "patterns");
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const calls = [];
const output = (table, drill) => ({
	id: "sr_p", title: "Recurring patterns", query: "WITH …", columns: table.split("\\n")[0].split(" | "),
	rows: table.split("\\n").length - 1, truncated: false, table, notices: ["not evidence"], sessions: [], runs: [],
	measure: { name: "patterns", status: "approved", hash: "h", from: "2026-10-06", to: "2026-11-03", ...(drill ? { drill } : {}) },
});
const client = { analysis: { patterns: {
	list: async (input) => { calls.push({ tool: "list", input }); return output("id | kind | signature\\nfc_0123456789 | failing_call | bun test: error"); },
	drill: async (input) => { calls.push({ tool: "drill", input }); return output("pattern | session_id\\nfc_0123456789 failing_call: bun test | s1", { id: input.id }); },
	verify: async (input) => { calls.push({ tool: "verify", input }); return output("id | status\\nfc_0123456789 | improved", { verify: input.id ?? "top" }); },
	peek: async (input) => { calls.push({ tool: "peek", input }); return { rows: 3, chars: 900, columns: ["id"], head: [{ id: "fc_0123456789" }], ms: 12 }; },
	digest: async (input) => { calls.push({ tool: "digest", input }); return { text: "digest window=2026-10-06..2026-11-03", ms: 5, from: "2026-10-06", to: "2026-11-03", digest: {} }; },
} } };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const scope = { repository: "athena", from: "2026-10-06", to: "2026-11-03" };
const flow = {
	list: await outcome(tool.run(client, { action: "list", ...scope, kind: "retry_loop", minCount: 3, workspace: "w" }, context)),
	drill: await outcome(tool.run(client, { action: "drill", ...scope, id: "fc_0123456789" }, context)),
	verify: await outcome(tool.run(client, { action: "verify", ...scope, id: "fc_0123456789", since: "2026-10-20" }, context)),
	drillWithoutId: await outcome(tool.run(client, { action: "drill", ...scope }, context)),
	listWithSince: await outcome(tool.run(client, { action: "list", since: "2026-10-20" }, context)),
	badId: await outcome(tool.run(client, { action: "drill", id: "nope" }, context)),
	peek: await outcome(tool.run(client, { action: "list", ...scope, peek: true }, context)),
	peekVerify: await outcome(tool.run(client, { action: "verify", peek: true }, context)),
	digest: await outcome(tool.run(client, { action: "digest", ...scope, analysis: "a_1" }, context)),
};
console.log(JSON.stringify({ calls, flow }));`,
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

test("patterns passes each action only its own inputs and points from the list to drill and pull", async () => {
	const { calls, flow } = await loaded;
	expect(calls.find((call) => call.tool === "list")?.input).toEqual({
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
		kind: "retry_loop",
		minCount: 3,
		limit: 20,
	});
	expect(calls.find((call) => call.tool === "drill")?.input).toMatchObject({
		id: "fc_0123456789",
		limit: 50,
	});
	expect(calls.find((call) => call.tool === "verify")?.input).toMatchObject({
		id: "fc_0123456789",
		since: "2026-10-20",
		minCount: 2,
		limit: 10,
	});
	expect(text(flow.list).split("\n")[0]).toStartWith(
		"patterns window=2026-10-06..2026-11-03: sections in order, each ranked by the sessions it hit",
	);
	expect(text(flow.list).split("\n").at(-1)).toBe(
		"next: patterns action=drill id=fc_0123456789 for its runs and evidence, or opaline pull --pattern fc_0123456789 --repo athena --from 2026-10-06 --to 2026-11-03; then read the examples and write the fix as a diff.",
	);
	expect(text(flow.drill)).toStartWith(
		"pattern fc_0123456789 window=2026-10-06..2026-11-03: one row per run",
	);
	expect(text(flow.drill)).toContain(
		"opaline pull --pattern fc_0123456789 --repo athena --from 2026-10-06 --to 2026-11-03 copies just these sessions.",
	);
	expect(text(flow.verify)).toStartWith("verify window=2026-10-06..2026-11-03");
	expect(text(flow.drillWithoutId)).toContain("action=drill needs id");
	expect(text(flow.listWithSince)).toContain(
		"since is not an input of action=list",
	);
	expect(text(flow.badId)).toStartWith("error:");
	expect(text(flow.peek)).toStartWith("peek patterns: 3 rows, 900 chars");
	expect(calls.find((call) => call.tool === "peek")?.input).toEqual({
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
		minCount: 2,
		limit: 20,
	});
	expect(text(flow.peekVerify)).toContain(
		"peek goes with action=list or drill",
	);
});

test("digest takes the analysis id every other action takes and says it stores nothing", async () => {
	const { calls, flow } = await loaded;
	expect(calls.find((call) => call.tool === "digest")?.input).toEqual({
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
	});
	expect(text(flow.digest).split("\n")).toEqual([
		"digest window=2026-10-06..2026-11-03",
		"note: the digest is not stored in an answer draft and starts none, with or without analysis; cite a number by its section and definition, or store the rows behind it with patterns list, drill or sql.",
	]);
});
