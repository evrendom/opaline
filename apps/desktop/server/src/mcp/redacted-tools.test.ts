import { expect, test } from "bun:test";

/**
 * Runs the served tools (each wrapped by `withRedactedOutput`, as mcp-http
 * serves them) in a child process, over fake procedures whose results hold
 * every synthetic credential, and returns what each tool returned. The
 * module opens the Postgres pool on import, so it needs a connection string
 * but no database.
 */
async function runTools(): Promise<Record<string, unknown>> {
	const url = (path: string) =>
		JSON.stringify(new URL(path, import.meta.url).href);
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS } = await import(${url("./mcp-tools.ts")});
const { PLUGIN_TOOLS } = await import(${url("./plugin-tools.ts")});
const { withRedactedOutput } = await import(${url("./redacted-tools.ts")});
const { CREDENTIAL_FIXTURES } = await import(${url("../../../../../packages/secret-filter/src/__tests__/helpers/credential-fixtures.ts")});
const service = await import(${url("../services/analysis-log/analysis-log.service.ts")});
const { createMemoryAnalysisStore } = await import(${url("../services/analysis-log/memory-store.ts")});
const { createLocalEmbedder } = await import(${url("../services/analysis-log/embedder.ts")});
const served = (name) => withRedactedOutput([...MCP_TOOLS, ...PLUGIN_TOOLS].find((tool) => tool.name === name));
const secret = CREDENTIAL_FIXTURES.map((fixture) => fixture.text).join("\\n");
const ref = { sessionId: "session-1", agentId: "", turn: 2 };
const header = { from: "2026-10-01", to: "2026-10-03", sessionsInScope: 1, indexedSessions: 1, runsInScope: 1, minutes: 1, activeMinutes: 1, pricedCostUsd: 0, unattributedCostUsd: 0, unpricedRuns: 0, rawChars: 10, truncated: false, notes: [secret], classifierVersion: 1 };
const findUser = { source: "user", header, events: [{ type: "negative", terms: ["broken"], eventRef: { ...ref, record: 3 }, quote: secret, partial: false, originRef: ref, originMinutes: 1, originCostUsd: 0, parentSessionId: null }], groups: [{ type: "negative", count: 1, sessions: 1 }] };
const findTool = { source: "tool", header, groups: [{ toolGroup: "shell", cause: secret, detail: secret, kind: "mistake", count: 1, sessions: 1, firstSeen: "2026-10-01", lastSeen: "2026-10-01", topCommands: [secret], minutes: 1, costUsd: 0, examples: [{ ref, record: 3, errorLine: secret, parentSessionId: null }] }] };
const readOf = (depth) => ({ truncated: false, reads: [{ ref, header: secret, found: true, truncated: false, sections: [{ name: depth === "record" ? "record" : depth === "turn" ? "tool_call" : "prompt", text: secret }] }] });
const log = { store: createMemoryAnalysisStore(), embedder: createLocalEmbedder(), now: () => new Date() };
const viewer = { workspaceId: "w", userId: "u", isAdmin: false, restrictResults: false, onlyMember: null };
// Evidence stored before redaction existed: the stored result holds the credentials.
const stored = await service.recordQuery(log, { workspaceId: "w", userId: "u", host: "plugin" }, { tool: "find", args: { source: "tool" }, trace: {}, output: findTool, outputChars: 10, sessions: [], owners: [] });
await service.saveAnalysis(log, viewer, { analysis: stored.analysis, question: "Why agents fail", finalAnswer: "Answer", findings: [], topics: [], changes: [] });
const client = {
	analysis: {
		find: async (input) => (input.source === "user" ? findUser : findTool),
		read: async (input) => readOf(input.depth),
		history: { query: (input) => service.getStoredQuery(log, viewer, input.query, async () => new Map()) },
	},
	analytics: { sessions: {
		detailOverview: async () => ({ summary: secret, activityTotals: { signalScanVersion: 1, failedCalls: 0 }, turnPage: { items: [{ id: "t", prompt: secret, fileEvents: [{ eventId: "e", path: secret }], subagentEvents: [] }] } }),
		detailTurn: async () => ({ records: [{ id: "r", text: secret, toolInput: { command: secret } }] }),
	} },
};
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const run = (name, args) => served(name).run(client, args, context);
console.log(JSON.stringify({
	secrets: CREDENTIAL_FIXTURES.map((fixture) => fixture.secret),
	findUser: await run("find", { source: "user" }),
	findTool: await run("find", { source: "tool" }),
	readExchange: await run("read", { refs: [ref], depth: "exchange" }),
	readTurn: await run("read", { refs: [ref], depth: "turn" }),
	readRecord: await run("read", { refs: [ref], depth: "record", record: 3 }),
	evidence: await run("get_answer_evidence", { query: stored.query }),
	sessionOverview: await run("get_session", { sessionId: "session-1" }),
	sessionTurn: await run("app_session_turn", { sessionId: "session-1", revision: "1", turnId: "t1", workspace: "w" }),
}));`,
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

const outputs = runTools();

for (const path of [
	"findUser",
	"findTool",
	"readExchange",
	"readTurn",
	"readRecord",
	"evidence",
	"sessionOverview",
	"sessionTurn",
])
	test(`${path}: no credential survives in what the tool returns`, async () => {
		const all = await outputs;
		const output = JSON.stringify(all[path]);
		const secrets = all.secrets as string[];
		expect(secrets.length).toBeGreaterThan(15);
		expect(output).toContain("[redacted]");
		for (const secret of secrets)
			expect({ path, leaked: output.includes(secret) ? secret : null }).toEqual(
				{
					path,
					leaked: null,
				},
			);
	});
