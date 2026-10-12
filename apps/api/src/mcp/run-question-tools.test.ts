import { expect, test } from "bun:test";

/**
 * estimate_questions and run_questions as a client sees them: how bad input is
 * refused and the text an estimate or a run renders to. MCP_TOOLS loads in a
 * child process because the module opens the Postgres pool on import
 * (without connecting); the analysis procedures are stand-ins.
 */

type Outcome = { result: string } | { error: string };

async function load(): Promise<{
	calls: { tool: string; input: unknown }[];
	flow: Record<string, Outcome>;
}> {
	const subprocess = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"--eval",
			`const { MCP_TOOLS } = await import(${JSON.stringify(new URL("./mcp-tools.ts", import.meta.url).href)});
const tool = (name) => MCP_TOOLS.find((candidate) => candidate.name === name);
const context = { userId: "u", workspace: { id: "w", slug: "w" }, authSession: {} };
const calls = [];
const client = { analysis: {
	estimateQuestions: async (input) => {
		calls.push({ tool: "estimate", input });
		return {
			runs: 120, toAnswer: 80, costUsd: 0.16, available: true, token: "tok.sig", tokenExpiresAt: "2026-10-12T12:15:00.000Z",
			questions: [{ id: "rq_1", question: "Did the agent go in circles?", answered: 40, queued: 0, toAnswer: 80 }],
			quota: { answers: 20000, windowHours: 24, remaining: 19900 },
			notices: ["Nothing was sent: this is an estimate."],
		};
	},
	runQuestions: async (input) => {
		calls.push({ tool: "run", input });
		return { job: "rqj_1", runs: 120, reused: 40, alreadyQueued: 0, queued: 80, costUsd: 0.16, notices: ["Asking again about the same runs pays nothing."] };
	},
} };
const outcome = (promise) => promise.then((result) => ({ result }), (error) => ({ error: error.message }));
const flow = {
	estimate: await outcome(tool("estimate_questions").run(client, { questions: ["rq_1", "rq_1"], workspace: "w" }, context)),
	run: await outcome(tool("run_questions").run(client, { questions: ["rq_1"], runs: "SELECT session_id, agent_id, turn_idx FROM runs", estimate: "tok.sig" }, context)),
	noQuestions: await outcome(tool("run_questions").run(client, { questions: [], estimate: "tok.sig" }, context)),
	noEstimate: await outcome(tool("run_questions").run(client, { questions: ["rq_1"] }, context)),
	tooMany: await outcome(tool("estimate_questions").run(client, { questions: Array.from({ length: 11 }, (_, index) => "rq_" + index) }, context)),
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

test("an estimate renders the most it costs, the quota left, what each question reuses and the token; a run renders what was queued", async () => {
	const { flow, calls } = await loaded;
	expect(flow.estimate).toEqual({
		result: [
			"estimate runs=120 to_answer=80 cost_at_most=$0.1600 quota_remaining=19900 of 20000 per 24 hours available=true",
			"token=tok.sig expires_at=2026-10-12T12:15:00.000Z",
			"question_id | question | answered (reused) | queued | to answer",
			"rq_1 | Did the agent go in circles? | 40 | 0 | 80",
			"note: Nothing was sent: this is an estimate.",
		].join("\n"),
	});
	expect(flow.run).toEqual({
		result: [
			"run_questions job=rqj_1 runs=120 queued=80 reused=40 already_queued=0 cost_at_most=$0.1600",
			"note: Asking again about the same runs pays nothing.",
		].join("\n"),
	});
	expect(calls).toEqual([
		{ tool: "estimate", input: { questions: ["rq_1"] } },
		{
			tool: "run",
			input: {
				questions: ["rq_1"],
				runs: "SELECT session_id, agent_id, turn_idx FROM runs",
				estimate: "tok.sig",
			},
		},
	]);
});

test("no question, more than ten, or a run without the estimate's token is refused before the server is called", async () => {
	const { flow } = await loaded;
	expect(flow.noQuestions).toEqual({
		error: "questions: Too small: expected array to have >=1 items",
	});
	expect(flow.noEstimate).toEqual({
		error: "estimate: Invalid input: expected string, received undefined",
	});
	expect(flow.tooMany).toEqual({
		error: "questions: Too big: expected array to have <=10 items",
	});
});
