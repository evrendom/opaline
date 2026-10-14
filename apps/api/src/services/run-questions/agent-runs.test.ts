import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	type AgentRunsEnv,
	InvalidAgentRunsCursorError,
	listAgentRuns,
} from "./agent-runs.js";

/** An executor answering its queries in turn with these row sets, remembering what it was asked. */
function executorOf(responses: readonly Record<string, unknown>[][]) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			return (responses[statements.length - 1] ?? []) as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

function envOf(
	responses: readonly Record<string, unknown>[][],
	mayAnswer = true,
) {
	const executor = executorOf(responses);
	const env: AgentRunsEnv = {
		executor,
		mayAnswer: () => mayAnswer,
		onQuestions: async () => [
			{ id: "rq_a", question: "Did the agent hunt for files?", label: "Hunt" },
		],
	};
	return { env, executor };
}

const STARTED = Date.UTC(2026, 9, 13, 10, 30, 0, 123);
const run = (over: Record<string, unknown>) => ({
	user_id: "u1",
	session_id: "s1",
	agent_id: "",
	turn_idx: 1,
	source: "claude_code",
	started_ms: String(STARTED),
	ended_ms: String(STARTED + 60_000),
	model: "claude-opus-4-1",
	prompt_head: "Fix the login bug",
	minutes: 1,
	cost_usd: null,
	tool_calls: 4,
	failed_calls: 0,
	repository: "github.com/acme/app",
	...over,
});
const answer = (over: Record<string, unknown>) => ({
	session_id: "s1",
	agent_id: "",
	turn_idx: 1,
	started_ms: String(STARTED),
	question_id: "rq_a",
	question: "Did the agent hunt for files?",
	probability: 0.8,
	...over,
});
const request = {
	startDate: "2026-10-01",
	endDate: "2026-10-14",
	filters: [{ questionId: "rq_a", min: 0.7, max: 1 }],
	limit: 2,
};

describe("listAgentRuns", () => {
	test("pages runs with their newest answers and filters by each question's probability range", async () => {
		const { env, executor } = envOf([
			[
				run({}),
				run({ turn_idx: 2, started_ms: String(STARTED - 1) }),
				run({ session_id: "s2", started_ms: String(STARTED - 2) }),
			],
			[
				answer({ probability: 0.3 }),
				answer({ probability: 0.9 }),
				answer({ question_id: "rq_b", probability: 0.95 }),
			],
		]);
		const page = await listAgentRuns(
			env,
			{ workspaceId: "w", member: "u1" },
			request,
		);
		expect(page.enabled).toBe(true);
		expect(page.questions.map((question) => question.label)).toEqual(["Hunt"]);
		expect(page.runs).toHaveLength(2);
		expect(page.runs[0]?.answers).toEqual([
			{ id: "rq_b", probability: 0.95 },
			{ id: "rq_a", probability: 0.9 },
		]);
		expect(page.runs[1]?.answers).toEqual([]);
		expect(page.runs[0]?.costUsd).toBeNull();
		expect(page.nextCursor).toBe(JSON.stringify([STARTED - 1, "s1", "", 2]));
		expect(executor.statements[0]?.query_params).toMatchObject({
			question0: "rq_a",
			min0: 0.7,
			max0: 1,
			member: "u1",
			limit: 3,
		});
		expect(executor.statements[0]?.query).toContain(
			"HAVING argMax(probability, answered_at) BETWEEN {min0:Float64} AND {max0:Float64}",
		);

		const next = envOf([[]]);
		await listAgentRuns(
			next.env,
			{ workspaceId: "w", member: null },
			{ ...request, cursor: page.nextCursor ?? undefined },
		);
		expect(next.executor.statements[0]?.query_params).toMatchObject({
			cursorMs: STARTED - 1,
			cursorSession: "s1",
			cursorAgent: "",
			cursorTurn: 2,
		});
	});

	test("lists runs without answers or filters where the workspace's runs are not answered", async () => {
		const { env, executor } = envOf([[run({})]], false);
		const page = await listAgentRuns(
			env,
			{ workspaceId: "w", member: null },
			request,
		);
		expect(page).toMatchObject({ enabled: false, questions: [] });
		expect(page.runs[0]?.answers).toEqual([]);
		expect(page.nextCursor).toBeNull();
		expect(executor.statements).toHaveLength(1);
		expect(executor.statements[0]?.query).not.toContain("question_id");
	});

	test("rejects a cursor it did not write", async () => {
		const { env } = envOf([]);
		await expect(
			listAgentRuns(
				env,
				{ workspaceId: "w", member: null },
				{ ...request, cursor: '["x"]' },
			),
		).rejects.toThrow(InvalidAgentRunsCursorError);
	});
});
