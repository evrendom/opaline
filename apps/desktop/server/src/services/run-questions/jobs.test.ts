import { describe, expect, test } from "bun:test";
import {
	answerQuotaFor,
	INTERNAL_RUN_QUESTION_ANSWER_QUOTA,
	RUN_QUESTION_ANSWER_QUOTA,
} from "./jobs.js";

const env = {
	VITE_ADMIN_ORGANIZATION_ID: "admin_ws",
	RUN_QUESTIONS_INTERNAL_WORKSPACES: "ours_a, ours_b",
	RUN_QUESTIONS_CUSTOMER_WORKSPACES: "true",
};

describe("answer quota", () => {
	test("our own workspaces buy more answers than customers, even with customers on", () => {
		for (const workspace of ["admin_ws", "ours_a", "ours_b"])
			expect(answerQuotaFor(workspace, undefined, env)).toBe(
				INTERNAL_RUN_QUESTION_ANSWER_QUOTA,
			);
		expect(answerQuotaFor("customer_ws", undefined, env)).toBe(
			RUN_QUESTION_ANSWER_QUOTA,
		);
		expect(INTERNAL_RUN_QUESTION_ANSWER_QUOTA.answers).toBeGreaterThan(
			RUN_QUESTION_ANSWER_QUOTA.answers,
		);
	});

	test("a configured quota applies to every workspace", () => {
		const override = { answers: 3, windowMs: 1_000 };
		expect(answerQuotaFor("ours_a", override, env)).toBe(override);
		expect(answerQuotaFor("customer_ws", override, env)).toBe(override);
	});
});
