import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	type SessionAnswersEnv,
	sessionRunAnswers,
	sessionRunQuestionTags,
} from "./session-answers.js";

/** An executor answering every query with these rows, remembering what it was asked. */
function executorOf(rows: readonly Record<string, unknown>[]) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			return rows as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

function envOf(
	rows: readonly Record<string, unknown>[],
	mayAnswer = true,
	labels: Record<string, string | null> = {},
) {
	const executor = executorOf(rows);
	const asked: string[][] = [];
	const env: SessionAnswersEnv = {
		executor,
		mayAnswer: () => mayAnswer,
		labelsOf: async (ids) => {
			asked.push([...ids]);
			return new Map(ids.map((id) => [id, labels[id] ?? null]));
		},
	};
	return { env, executor, asked };
}

const STARTED = Date.UTC(2026, 9, 13, 10, 30, 0, 123);
const row = (over: Record<string, unknown>) => ({
	session_id: "s1",
	agent_id: "",
	turn_idx: 1,
	started_ms: String(STARTED),
	question_id: "rq_a",
	question: "Did the agent hunt for files?",
	probability: 0.8,
	...over,
});

describe("sessionRunQuestionTags", () => {
	test("reads nothing in a workspace whose runs are not answered", async () => {
		const { env, executor, asked } = envOf([row({})], false);
		expect(
			await sessionRunQuestionTags(env, { workspaceId: "w", member: null }, [
				"s1",
			]),
		).toEqual({ enabled: false, sessions: [] });
		expect(executor.statements).toHaveLength(0);
		expect(asked).toHaveLength(0);
	});

	test("tags a session with each question answered yes, counting its runs, and keeps the newest answer per run", async () => {
		const { env, executor } = envOf(
			[
				row({ probability: 0.2 }),
				// A later answer by another provider replaces the first.
				row({ probability: 0.9 }),
				row({ turn_idx: 2, probability: 0.6 }),
				row({ agent_id: "sub", turn_idx: 1, probability: 0.7 }),
				row({
					question_id: "rq_b",
					question: "Was it told twice?",
					probability: 0.4,
				}),
				row({
					session_id: "s2",
					question_id: "rq_b",
					question: "Was it told twice?",
					probability: 0.55,
				}),
				row({ session_id: "s3", probability: 0.1 }),
			],
			true,
			{ rq_a: "Hunted for files" },
		);
		const tags = await sessionRunQuestionTags(
			env,
			{ workspaceId: "w", member: "m1" },
			["s1", "s2", "s3", "s1"],
		);
		expect(tags).toEqual({
			enabled: true,
			sessions: [
				{
					sessionId: "s1",
					questions: [
						{
							id: "rq_a",
							question: "Did the agent hunt for files?",
							label: "Hunted for files",
							runs: 3,
							probability: 0.9,
						},
					],
				},
				{
					sessionId: "s2",
					questions: [
						{
							id: "rq_b",
							question: "Was it told twice?",
							label: null,
							runs: 1,
							probability: 0.55,
						},
					],
				},
			],
		});
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionIds: ["s1", "s2", "s3"],
			member: "m1",
		});
		expect(statement?.query).toContain("user_id = {member:String}");
		expect(statement?.query).toContain("row_kind = 'receipt'");
		expect(statement?.query).toContain("ORDER BY a.answered_at");
	});

	test("binds no member where the reader reads every session", async () => {
		const { env, executor } = envOf([]);
		await sessionRunQuestionTags(env, { workspaceId: "w", member: null }, [
			"s1",
		]);
		const [statement] = executor.statements;
		expect(statement?.query_params).toEqual({
			workspaceId: "w",
			sessionIds: ["s1"],
		});
		expect(statement?.query).not.toContain("{member:String}");
	});
});

describe("sessionRunAnswers", () => {
	test("reads nothing in a workspace whose runs are not answered", async () => {
		const { env, executor } = envOf([row({})], false);
		expect(
			await sessionRunAnswers(env, { workspaceId: "w", member: "m1" }, "s1"),
		).toEqual({ enabled: false, runs: [] });
		expect(executor.statements).toHaveLength(0);
	});

	test("groups every answer by run, surest first, with the run's prompt time", async () => {
		const { env } = envOf(
			[
				row({ probability: 0.3 }),
				row({
					question_id: "rq_b",
					question: "Was it told twice?",
					probability: 0.7,
				}),
				row({
					agent_id: "sub",
					turn_idx: 1,
					started_ms: String(STARTED + 5_000),
					probability: 0.6,
				}),
				row({
					turn_idx: 2,
					started_ms: String(STARTED + 60_000),
					probability: 0.1,
				}),
			],
			true,
			{ rq_b: "Told twice" },
		);
		expect(
			await sessionRunAnswers(env, { workspaceId: "w", member: "m1" }, "s1"),
		).toEqual({
			enabled: true,
			runs: [
				{
					agentId: "",
					turn: 1,
					startedAt: "2026-10-13T10:30:00.123Z",
					questions: [
						{
							id: "rq_b",
							question: "Was it told twice?",
							label: "Told twice",
							probability: 0.7,
						},
						{
							id: "rq_a",
							question: "Did the agent hunt for files?",
							label: null,
							probability: 0.3,
						},
					],
				},
				{
					agentId: "",
					turn: 2,
					startedAt: "2026-10-13T10:31:00.123Z",
					questions: [
						{
							id: "rq_a",
							question: "Did the agent hunt for files?",
							label: null,
							probability: 0.1,
						},
					],
				},
				{
					agentId: "sub",
					turn: 1,
					startedAt: "2026-10-13T10:30:05.123Z",
					questions: [
						{
							id: "rq_a",
							question: "Did the agent hunt for files?",
							label: null,
							probability: 0.6,
						},
					],
				},
			],
		});
	});
});
