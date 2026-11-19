import { expect, test } from "bun:test";
import { cliHint, pullCommand, sqlOutCommand } from "./cli-hint.js";

type Outcome = { result: string } | { error: string };

const LEAD =
	"too large to page through here. If the opaline CLI is available, to compute on all of it, run: ";

test("the pull command carries the call's repository and window, quoted for a shell only when it must be", () => {
	expect(
		pullCommand({ repository: "athena", from: "2026-10-06", to: "2026-11-03" }),
	).toBe("opaline pull --repo athena --from 2026-10-06 --to 2026-11-03");
	expect(pullCommand({ from: "2026-10-06", to: "2026-11-03" })).toBe(
		"opaline pull --from 2026-10-06 --to 2026-11-03",
	);
	expect(
		pullCommand({
			repository: "github.com/opalinehq/athena",
			from: "2026-10-06",
			to: "2026-11-03",
		}),
	).toBe(
		"opaline pull --repo github.com/opalinehq/athena --from 2026-10-06 --to 2026-11-03",
	);
	expect(
		pullCommand({ repository: "it's here", from: "a", to: "b" }),
	).toContain("--repo 'it'\\''s here'");
	expect(cliHint("opaline pull --from a --to b")).toBe(
		`${LEAD}opaline pull --from a --to b`,
	);
});

test("the sql command repeats the query inside double quotes, with the shell's special characters escaped", () => {
	expect(sqlOutCommand("SELECT 1")).toBe(
		'opaline sql "SELECT 1" --out rows.jsonl',
	);
	expect(sqlOutCommand('SELECT "a$b`c\\d" FROM runs')).toBe(
		'opaline sql "SELECT \\"a\\$b\\`c\\\\d\\" FROM runs" --out rows.jsonl',
	);
});

async function load(): Promise<Record<string, Outcome>> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = (id) => ({ userId: "u", workspace: { id, slug: "acme" }, authSession: {} });
const header = { from: "2026-10-06", to: "2026-11-03", sessionsInScope: 3, indexedSessions: 3, runsInScope: 2, minutes: 1, activeMinutes: 1, pricedCostUsd: 0, unattributedCostUsd: 0, unpricedRuns: 0, rawChars: 0, truncated: false, notes: [], classifierVersion: 1 };
const find = (cursor) => async () => ({ source: "git", header: cursor ? { ...header, cursor } : header, events: [] });
const sql = (truncated) => async (input) => ({ id: "sr_1", title: "t", query: input.query, columns: ["n"], rows: 1, truncated, table: "n\\n1", notices: [], sessions: [], runs: [] });
const measure = async () => ({ id: "sr_m", title: "t", query: "q", columns: ["n"], rows: 1, truncated: true, table: "n\\n1", notices: [], sessions: [], runs: [], measure: { name: "time_lost_by_cause", status: "approved", hash: "h", from: "2026-10-06", to: "2026-11-03" } });
const client = (cursor, truncated) => ({ analysis: { coverage: async () => ({ line: "coverage: stub" }), find: find(cursor), sql: sql(truncated), measures: { run: measure }, read: async () => ({ reads: [] }), run: async () => ({ id: "r", phaseRule: 1, truncated: false, text: "run" }) } });
const outcome = (promise) => promise.then((result) => ({ result: String(result) }), (error) => ({ error: error.message }));
const git = { source: "git", from: "2026-10-06", to: "2026-11-03" };
const query = "SELECT count() AS n FROM runs";
console.log(JSON.stringify({
	findMore: await outcome(tool("find").run(client("c_next"), git, context("team"))),
	findMoreRepo: await outcome(tool("find").run(client("c_next"), { ...git, repository: "athena" }, context("team"))),
	findLast: await outcome(tool("find").run(client(), git, context("team"))),
	findElsewhere: await outcome(tool("find").run(client("c_next"), git, context("other"))),
	findOutput: await outcome(tool("find").run(client(), { ...git, output: "file" }, context("team"))),
	findFormat: await outcome(tool("find").run(client(), { ...git, format: "json" }, context("team"))),
	sqlCut: await outcome(tool("sql").run(client(undefined, true), { query, title: "t" }, context("team"))),
	sqlWhole: await outcome(tool("sql").run(client(undefined, false), { query, title: "t" }, context("team"))),
	sqlOutput: await outcome(tool("sql").run(client(undefined, true), { query, title: "t", output: "file" }, context("team"))),
	measuresCut: await outcome(tool("measures").run(client(), { action: "run", name: "time_lost_by_cause", from: "2026-10-06", to: "2026-11-03", repository: "athena" }, context("team"))),
	measuresOutput: await outcome(tool("measures").run(client(), { action: "run", name: "time_lost_by_cause", output: "file" }, context("team"))),
	readOutput: await outcome(tool("read").run(client(), { refs: [{ sessionId: "s", turn: 1 }], format: "json", output: "file" }, context("team"))),
	runOutput: await outcome(tool("run").run(client(), { id: "r", output: "file" }, context("team"))),
}));`,
		],
		{
			env: {
				PATH: process.env.PATH,
				PG_CONNECTION_STRING: "postgres://unused@127.0.0.1:1/unused",
				VITE_ADMIN_ORGANIZATION_ID: "team",
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
	outcome && "result" in outcome ? outcome.result : JSON.stringify(outcome);

test("a find with more pages names the pull of its window and repository just before its cursor line, in workspaces on the retro rollout", async () => {
	const flow = await loaded;
	const lines = text(flow.findMore).split("\n");
	expect(lines.at(-2)).toBe(
		`${LEAD}opaline pull --from 2026-10-06 --to 2026-11-03`,
	);
	expect(lines.at(-1)).toContain("cursor=c_next");
	expect(text(flow.findMoreRepo)).toContain(
		`${LEAD}opaline pull --repo athena --from 2026-10-06 --to 2026-11-03`,
	);
	expect(text(flow.findLast)).not.toContain("opaline pull");
	expect(text(flow.findElsewhere)).not.toContain("opaline pull");
});

test("a cut sql result names the same query written to a file, and a cut measure the pull of its window", async () => {
	const flow = await loaded;
	expect(text(flow.sqlCut).split("\n").at(-2)).toBe(
		`${LEAD}opaline sql "SELECT count() AS n FROM runs" --out rows.jsonl`,
	);
	expect(text(flow.sqlWhole)).not.toContain("opaline sql");
	expect(text(flow.measuresCut).split("\n").at(-2)).toBe(
		`${LEAD}opaline pull --repo athena --from 2026-10-06 --to 2026-11-03`,
	);
});

test("output is refused on every tool and format on find, as unknown inputs of their strict schemas", async () => {
	const flow = await loaded;
	for (const name of [
		"findOutput",
		"sqlOutput",
		"measuresOutput",
		"readOutput",
		"runOutput",
	])
		expect({ name, error: text(flow[name]) }).toEqual({
			name,
			error: expect.stringContaining("output"),
		});
	expect(flow.findFormat).toEqual({
		error: expect.stringContaining("format"),
	});
	for (const name of ["findOutput", "sqlOutput", "findFormat"])
		expect(flow[name]).not.toHaveProperty("result");
});
