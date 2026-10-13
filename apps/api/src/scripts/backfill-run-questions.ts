import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { runQuestionsEnv } from "../services/run-questions/env.js";
import {
	backfillRunQuestions,
	decodeRunQuestionsBackfillCursor,
	previewRunQuestionsBackfill,
	type RunQuestionsBackfillEnv,
} from "../services/run-questions/history-backfill.service.js";
import { answerQueuedQuestions } from "../services/run-questions/run-questions.service.js";
import { parseRunQuestionsBackfillArgs } from "./l1-script-args.js";

// Preview by default (nothing queued or sent); --execute answers the run
// questions that are on for past runs through the path new runs take,
// paced, newest runs first; with --queue-only it only queues them, and the
// run-questions cron answers them in production. Ctrl-C stops it before its
// next batch and still prints the summary.
const args = parseRunQuestionsBackfillArgs(Bun.argv.slice(2));
const answering = runQuestionsEnv();
if (args.execute && !answering.provider)
	throw new Error(
		"No run question provider is configured (RUN_QUESTIONS_PROVIDER, SUBQ_API_KEY): --execute would answer nothing.",
	);
const options = {
	organizationId: args.organizationId,
	days: args.days,
	maxRuns: args.maxRuns,
	after:
		args.after === undefined
			? undefined
			: decodeRunQuestionsBackfillCursor(args.after),
	runsPerMinute: args.runsPerMinute,
	maxLoad: args.maxLoad,
};
const controller = new AbortController();
process.on("SIGINT", () => {
	if (controller.signal.aborted) process.exit(130);
	console.error("Stopping before the next batch (Ctrl-C again to quit now)");
	controller.abort();
});
const executor = getClickhouse();
const env: RunQuestionsBackfillEnv = {
	executor,
	sql: sqlClient,
	provider: answering.provider,
	mayAnswer: answering.mayAnswer,
	listWorkspaces: async () =>
		(
			await sqlClient<{ id: string }[]>`SELECT id FROM organization ORDER BY id`
		).map((row) => row.id),
	log: (line) => console.error(line),
};
try {
	const result = args.execute
		? await backfillRunQuestions(
				{
					...env,
					// --queue-only: the run-questions cron answers what is queued.
					answer: args.queueOnly
						? async () => ({ jobs: 0, answers: 0, costUsd: 0, refused: [] })
						: () => answerQueuedQuestions(answering),
				},
				{ ...options, signal: controller.signal },
			)
		: await previewRunQuestionsBackfill(env, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.message) console.error(result.message);
	else if (result.next)
		console.error(`More runs remain: run again with --after ${result.next}`);
	if (result.status === "executed" && result.stopped === "provider")
		process.exitCode = 2;
} finally {
	await executor.close();
	await sqlClient.end();
}
