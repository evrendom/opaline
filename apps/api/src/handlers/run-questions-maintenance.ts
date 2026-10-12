import { isAuthorizedCronRequest } from "../lib/cron-auth.js";

const INVOCATION_BUDGET_MS = 240_000;

/**
 * Minute cron: answers queued run questions within the invocation budget.
 * Without a configured provider it returns at once and nothing is sent.
 */
export async function handleRunQuestionsMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or provider clients.
	const [{ runQuestionsEnv }, { answerQueuedQuestions }] = await Promise.all([
		import("../services/run-questions/env.js"),
		import("../services/run-questions/run-questions.service.js"),
	]);
	const env = runQuestionsEnv();
	if (!env.provider)
		return Response.json({ runQuestions: { enabled: false }, ok: true });
	const answered = await answerQueuedQuestions(env, {
		budgetMs: INVOCATION_BUDGET_MS,
	});
	return Response.json({ runQuestions: { enabled: true, answered }, ok: true });
}
