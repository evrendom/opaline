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

/** Of the invocation, what Compass's frustration check may spend first. */
const FRUSTRATION_BUDGET_MS = 45_000;
/** Prompts the frustration check asks SubQ about per invocation at most. */
const FRUSTRATION_MAX_PROMPTS = 200;

/**
 * Minute cron: first Compass's frustration check (SubQ answers "Is the user
 * frustrated?" about recent member prompts, in workspaces with the switch),
 * then queued run questions within the invocation budget, with
 * `ANSWER_WORKERS` passes at once. Without a configured provider nothing is
 * sent.
 */
export async function handleRunQuestionsMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	// Unauthorized probes must not initialize database or provider clients.
	const [
		{ runQuestionsEnv },
		{ answerQueuedQuestions },
		{ frustrationEnv },
		{ checkFrustration },
	] = await Promise.all([
		import("../services/run-questions/env.js"),
		import("../services/run-questions/run-questions.service.js"),
		import("../services/moments/env.js"),
		import("../services/moments/frustration.js"),
	]);
	const frustration = await checkFrustration(frustrationEnv(), {
		budgetMs: FRUSTRATION_BUDGET_MS,
		maxPrompts: FRUSTRATION_MAX_PROMPTS,
	}).catch((error: unknown) => ({
		error: error instanceof Error ? error.message : String(error),
	}));
	const env = runQuestionsEnv();
	if (!env.provider)
		return Response.json({
			frustration,
			runQuestions: { enabled: false },
			ok: true,
		});
	const passes = await Promise.all(
		Array.from({ length: ANSWER_WORKERS }, () =>
			answerQueuedQuestions(env, {
				budgetMs: INVOCATION_BUDGET_MS - FRUSTRATION_BUDGET_MS,
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
	return Response.json({
		frustration,
		runQuestions: { enabled: true, answered },
		ok: true,
	});
}
