import { expect, test } from "bun:test";

/**
 * The search MCP tool as a client sees it: its published input, how bad
 * input is refused before the server is called, and the text a result, an
 * empty result and a refusal render to. MCP_TOOLS loads in a child process
 * because the module opens the Postgres pool on import (without connecting);
 * the search procedure is a stand-in that answers like the server.
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
const found = {
	text: "--legacy", requestedMode: "hybrid", mode: "exact",
	since: "2026-09-12T00:00:00.000Z", until: "2026-10-12T10:00:00.000Z",
	results: [{ runId: "u1/claude_code/s1//12", sessionId: "s1", agentId: "", turn: 3, startedAt: "2026-10-11 09:00:00.000", score: 0.016393, why: "exact ×2 in tool_call", snippet: "bun run build --legacy | tail\\nnext line" }],
	coverage: { sessions: 42, searched: 42, partial: 2, indexed: 40, pending: 3 },
	exactMatches: { runs: 9, sessions: 4 },
	hiddenInjected: { matches: 6, runs: 5 },
	quota: { usedTokens: 1234567, limitTokens: 50000000, resetsAt: "2026-11-11T00:00:00.000Z" },
	suggestion: null,
	notices: ["only exact matches: search by meaning is not available (the workspace used its OpenAI quota).", "not evidence: a match says where to look, not why."],
};
const empty = { ...found, text: "billing file", mode: "hybrid", results: [], coverage: { sessions: 5, searched: 5, partial: 0, indexed: 5, pending: 0 }, exactMatches: { runs: 0, sessions: 0 }, hiddenInjected: { matches: 0, runs: 0 }, quota: null, suggestion: "Nothing close to \\"billing file\\". Describe what happened in other words.", notices: ["not evidence: a match says where to look, not why."] };
const client = { analysis: {
	search: async (input) => {
		calls.push({ tool: "search", input });
		if (input.mode === "meaning")
			throw new ORPCError("BAD_REQUEST", { message: "error, recoverable: Search by meaning is not available.\\nfix: Search with mode exact." });
		return input.text === "--legacy" ? found : empty;
	},
} };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const flow = {
	found: await outcome(tool("search").run(client, { text: "--legacy", workspace: "w" }, context)),
	empty: await outcome(tool("search").run(client, { text: "billing file", filters: { since: "2026-09-01", kinds: ["user_prompt"] } }, context)),
	refused: await outcome(tool("search").run(client, { text: "billing file", mode: "meaning" }, context)),
	badMode: await outcome(tool("search").run(client, { text: "x y", mode: "fuzzy" }, context)),
	extra: await outcome(tool("search").run(client, { text: "x y", limit: 5 }, context)),
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

test("search takes the text, a mode and filters, only reads, and says results are not evidence", async () => {
	const { listed } = await loaded;
	const search = listed.find((tool) => tool.name === "search");
	expect(search?.inputSchema).toMatchObject({
		type: "object",
		required: ["text"],
		additionalProperties: false,
		properties: {
			text: { type: "string", maxLength: 800 },
			mode: {
				enum: ["hybrid", "meaning", "exact", "regex"],
				default: "hybrid",
			},
			filters: { type: "object", additionalProperties: false },
		},
	});
	expect(Object.keys(search?.inputSchema.properties ?? {}).sort()).toEqual([
		"filters",
		"mode",
		"text",
		"workspace",
	]);
	expect(search?.annotations).toMatchObject({ readOnlyHint: true });
	expect(search?.description).toContain("search('");
});

test("bad input is refused before the server is called; the workspace never reaches it", async () => {
	const { flow, calls } = await loaded;
	expect(flow.badMode).toEqual({
		error:
			'mode: Invalid option: expected one of "hybrid"|"meaning"|"exact"|"regex"',
	});
	expect(flow.extra).toEqual({ error: 'input: Unrecognized key: "limit"' });
	expect(calls.map((call) => call.input)).toEqual([
		{ text: "--legacy", mode: "hybrid" },
		{
			text: "billing file",
			mode: "hybrid",
			filters: { since: "2026-09-01", kinds: ["user_prompt"] },
		},
		{ text: "billing file", mode: "meaning" },
	]);
});

test("a result renders the runs with why each matched and a snippet, then coverage, quota and notices", async () => {
	const { flow } = await loaded;
	expect(flow.found).toEqual({
		result: [
			"url: http://localhost:4011/w/sessions?from=2026-09-12&to=2026-10-12",
			'search "--legacy" mode=exact (asked hybrid) 2026-09-12..2026-10-12 results=1',
			"run_id | session_id | agent_id | turn | started_at | score | why | snippet",
			"u1/claude_code/s1//12 | s1 |  | 3 | 2026-10-11 09:00:00.000 | 0.016393 | exact ×2 in tool_call | bun run build --legacy \\| tail\\nnext line",
			"coverage: 42 of 42 sessions in the window searched by exact string over every stored record, 2 partly; 9 runs in 4 sessions match",
			"hidden: 6 matches in injected context (reminders, task notifications, instructions, compaction summaries), 5 runs with no other match; filters.includeInjected=true searches them",
			"quota: 1,234,567 of 50,000,000 OpenAI tokens used; resets 2026-11-11T00:00:00.000Z",
			"note: only exact matches: search by meaning is not available (the workspace used its OpenAI quota).",
			"note: not evidence: a match says where to look, not why.",
		].join("\n"),
	});
});

test("an empty result suggests a rewrite; a refusal reaches the agent as the server phrased it", async () => {
	const { flow } = await loaded;
	expect(flow.empty).toEqual({
		result: [
			"url: http://localhost:4011/w/sessions?from=2026-09-12&to=2026-10-12",
			'search "billing file" mode=hybrid 2026-09-12..2026-10-12 results=0',
			"(no runs matched)",
			'suggestion: Nothing close to "billing file". Describe what happened in other words.',
			"coverage: 5 of 5 sessions in the window searched by exact string over every stored record; 0 runs in 0 sessions match",
			"coverage: 5 of 5 sessions in the window are indexed for meaning",
			"note: not evidence: a match says where to look, not why.",
		].join("\n"),
	});
	expect(flow.refused).toEqual({
		error:
			"error, recoverable: Search by meaning is not available.\nfix: Search with mode exact.",
	});
});
