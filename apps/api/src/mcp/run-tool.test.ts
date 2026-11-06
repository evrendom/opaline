import { expect, test } from "bun:test";

/**
 * The run MCP tool as a client sees it: its published input, how bad input
 * is refused before the server is called, and the text a view renders to.
 * MCP_TOOLS loads in a child process because the module opens the Postgres
 * pool on import (without connecting); the run procedure is a stand-in.
 */

type Outcome = { result: string } | { error: string };

interface Loaded {
	listed: {
		name: string;
		inputSchema: Record<string, unknown>;
		annotations: Record<string, unknown>;
	}[];
	calls: unknown[];
	flow: Record<string, Outcome>;
}

async function load(): Promise<Loaded> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS, listedTool } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const tool = MCP_TOOLS.find((candidate) => candidate.name === "run");
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const calls = [];
const client = { analysis: { run: async (input) => {
	calls.push(input);
	return { id: input.id, phaseRule: 1, truncated: input.maxChars < 2000, text: "run u/claude_code/s//4 · claude_code" };
} } };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const flow = {
	view: await outcome(tool.run(client, { id: "u/claude_code/s//4", expand: ["p2", "c9"], sections: ["header"], workspace: "w" }, context)),
	cut: await outcome(tool.run(client, { id: "u/claude_code/s//4", maxChars: 1500 }, context)),
	withoutId: await outcome(tool.run(client, { expand: ["p1"] }, context)),
	extra: await outcome(tool.run(client, { id: "u/claude_code/s//4", depth: "turn" }, context)),
	pastedRun: await outcome(tool.run(client, { url: "https://opaline.so/acme/sessions/s?turn=0b6f0c1e-8d4f-4a39-9a51-3c1f0f6f2a10&from=2026-10-01&to=2026-10-07" }, context)),
	pastedSession: await outcome(tool.run(client, { url: "https://opaline.so/acme/sessions/s?from=2026-10-01&to=2026-10-07" }, context)),
	pastedDashboard: await outcome(tool.run(client, { url: "https://opaline.so/acme/dashboard?from=2026-10-01&to=2026-10-07&metric=sessions&repo=acme/web" }, context)),
	pastedElsewhere: await outcome(tool.run(client, { url: "https://example.com/w/sessions/s" }, context)),
	both: await outcome(tool.run(client, { id: "u/claude_code/s//4", url: "https://opaline.so/w/sessions/s" }, context)),
	json: await outcome(tool.run(client, { id: "u/claude_code/s//4", format: "json" }, context)),
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

test("run takes a run id, the ids to expand, the sections and a character budget, and only reads", async () => {
	const { listed } = await loaded;
	const run = listed.find((tool) => tool.name === "run");
	expect(run?.inputSchema).toMatchObject({
		type: "object",
		additionalProperties: false,
		properties: {
			id: { type: "string" },
			expand: { type: "array", maxItems: 20 },
			sections: { type: "array", maxItems: 10 },
			maxChars: { type: "integer", default: 12_000, maximum: 40_000 },
			workspace: { type: "string" },
		},
	});
	expect(run?.inputSchema.required ?? []).not.toContain("id");
	expect(run?.annotations).toMatchObject({ readOnlyHint: true });
});

test("bad input is refused before the server is called, and good input reaches it without the workspace", async () => {
	const { calls, flow } = await loaded;
	expect(flow.withoutId).toEqual({ error: expect.stringContaining("id") });
	expect(flow.extra).toEqual({ error: expect.stringContaining("depth") });
	expect(calls).toEqual([
		{
			id: "u/claude_code/s//4",
			expand: ["p2", "c9"],
			sections: ["header"],
			maxChars: 12_000,
		},
		{ id: "u/claude_code/s//4", maxChars: 1500 },
		{ id: "0b6f0c1e-8d4f-4a39-9a51-3c1f0f6f2a10", maxChars: 12_000 },
		{ id: "u/claude_code/s//4", maxChars: 12_000 },
	]);
});

test("a pasted link opens the run it names, or says which call opens what it shows, keeping its dates", async () => {
	const { flow } = await loaded;
	expect(flow.pastedRun).toEqual({
		result: "run u/claude_code/s//4 · claude_code",
	});
	const pasted = flow.pastedSession;
	const session = pasted && "result" in pasted ? pasted.result : "";
	expect(session).toContain(
		"SELECT run_id, agent_id, turn_idx, started_at FROM runs WHERE session_id = 's'",
	);
	expect(session).toContain(
		'{"source":"runs","sessionId":"s","from":"2026-10-01","to":"2026-10-07"}',
	);
	expect(flow.pastedDashboard).toEqual({
		result:
			'This is the Opaline dashboard, not a run: call get_dashboard with {"startDate":"2026-10-01","endDate":"2026-10-07","metric":"sessions","repositories":["acme/web"]}.',
	});
	expect(flow.pastedElsewhere).toEqual({
		error: expect.stringContaining("not an Opaline link"),
	});
	expect(flow.both).toEqual({ error: "Give id or url, not both" });
});

test("format json returns the view as one JSON object with its link", async () => {
	const { flow } = await loaded;
	const outcome = flow.json;
	const json = JSON.parse(
		outcome && "result" in outcome ? outcome.result : "{}",
	);
	expect(json).toEqual({
		tool: "run",
		id: "u/claude_code/s//4",
		phaseRule: 1,
		truncated: false,
		text: "run u/claude_code/s//4 · claude_code",
		_markers: [],
		_opalineUrl: "http://localhost:4011/w/sessions/s",
	});
});

test("a view renders as its text, and a cut view says how to see the rest", async () => {
	const { flow } = await loaded;
	expect(flow.view).toEqual({
		result:
			"url: http://localhost:4011/w/sessions/s\nrun u/claude_code/s//4 · claude_code",
	});
	expect(flow.cut).toEqual({
		result:
			"url: http://localhost:4011/w/sessions/s\nrun u/claude_code/s//4 · claude_code\nnote: cut to maxChars; expand fewer ids at once, ask for fewer sections, or raise maxChars",
	});
});
