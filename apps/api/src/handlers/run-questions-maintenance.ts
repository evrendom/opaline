import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;
/**
 * Answering passes side by side in one invocation: each claims its own jobs
 * under the job lease, so a backlog drains several times faster.
 */
const ANSWER_WORKERS = 4;
/**
 * Above this ClickHouse load no further job is claimed: below the history
 * cron's 12, so search history and uploads get ClickHouse first.
 */
const MAX_LOAD = 10;

/**
 * Minute cron: queued run questions within the invocation budget, with
 * `ANSWER_WORKERS` passes at once. Without a configured provider nothing is
 * sent.
 */
export async function handleRunQuestionsMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	// Unauthorized probes must not initialize database or provider clients.
	const [{ runQuestionsEnv }, { answerQueuedQuestions }] = await Promise.all([
		import("../services/run-questions/env.js"),
		import("../services/run-questions/run-questions.service.js"),
	]);
	const env = runQuestionsEnv();
	if (!env.provider)
		return Response.json({ runQuestions: { enabled: false }, ok: true });
	const passes = await Promise.all(
		Array.from({ length: ANSWER_WORKERS }, () =>
			answerQueuedQuestions(env, {
				budgetMs: INVOCATION_BUDGET_MS,
				maxLoad: MAX_LOAD,
			}),
		),
	);
	const answered = {
		jobs: passes.reduce((sum, pass) => sum + pass.jobs, 0),
		answers: passes.reduce((sum, pass) => sum + pass.answers, 0),
		costUsd: passes.reduce((sum, pass) => sum + pass.costUsd, 0),
		refused: passes.flatMap((pass) => pass.refused),
	};
	if (answered.jobs > 0) await idle.markActivity();
	return Response.json({ runQuestions: { enabled: true, answered }, ok: true });
}
