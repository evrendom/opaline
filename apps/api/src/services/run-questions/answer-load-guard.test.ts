import { expect, test } from "bun:test";
import type { RunQuestionsEnv } from "./run-questions.service.js";

// The service's module graph opens the API's client, which connects lazily.
process.env.PG_CONNECTION_STRING ??= "postgres://unused@127.0.0.1:1/unused";
const { answerQueuedQuestions } = await import("./run-questions.service.js");

function envAtLoad(load: number, claimed: string[]): RunQuestionsEnv {
	return {
		provider: { name: "subq" },
		executor: { query: async () => [{ value: load }] },
		// Any statement is a claim here: the guard must come first.
		sql: (() => {
			claimed.push("claim");
			return Promise.resolve([]);
		}) as never,
	} as unknown as RunQuestionsEnv;
}

test("a pass claims no job while ClickHouse is above its load", async () => {
	const claimed: string[] = [];
	const pass = await answerQueuedQuestions(envAtLoad(20, claimed), {
		budgetMs: 1_000,
		maxLoad: 10,
	});
	expect(pass).toEqual({ jobs: 0, answers: 0, costUsd: 0, refused: [] });
	expect(claimed).toEqual([]);
});

test("below its load a pass goes on to claim jobs", async () => {
	const claimed: string[] = [];
	await answerQueuedQuestions(envAtLoad(4, claimed), {
		budgetMs: 1_000,
		maxLoad: 10,
	});
	expect(claimed.length).toBeGreaterThan(0);
});
