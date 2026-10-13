import { describe, expect, test } from "bun:test";
import { buildRunQuestionsBackfillStatement } from "./history-backfill.service.js";

describe("run questions history selection", () => {
	const base = { organizationId: "ws", days: 60, after: undefined, limit: 10 };

	test("selects every run in the window unless asked for unanswered runs only", () => {
		const statement = buildRunQuestionsBackfillStatement(base);
		expect(statement.query).not.toContain("NOT IN");
	});

	test("unanswered only leaves out runs every question has an answer for from the provider", () => {
		const statement = buildRunQuestionsBackfillStatement({
			...base,
			answered: { questionIds: ["q1", "q2", "q2"], provider: "subq" },
		});
		expect(statement.query).toContain(
			"AND (session_id, agent_id, turn_idx, toUInt64(revision)) NOT IN (",
		);
		expect(statement.query).toContain(
			"HAVING uniqExact(question_id) = {answeredQuestions:UInt32}",
		);
		expect(statement.query_params).toMatchObject({
			answeredProvider: "subq",
			answeredQuestionIds: ["q1", "q2", "q2"],
			answeredQuestions: 2,
		});
	});
});
