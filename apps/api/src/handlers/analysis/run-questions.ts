import { orgMiddleware, os } from "../../middleware.js";
import { analysisLimiter } from "../../services/analysis/concurrency.js";
import { runQuestionsEnv } from "../../services/run-questions/env.js";
import {
	estimateQuestions,
	type RunQuestionsEnv,
	runQuestions,
} from "../../services/run-questions/run-questions.service.js";
import type { SessionReader } from "../../services/session-visibility.js";
import { sqlError } from "./sql-error.js";

/**
 * estimate_questions and run_questions (docs/retro-architecture.md "Run
 * questions"): estimating sends nothing; asking queues the answers not stored
 * yet. Both select runs with the agent's SQL, scoped like `sql`.
 */
export function createRunQuestionProcedures(
	env: () => RunQuestionsEnv = runQuestionsEnv,
) {
	const callerOf = (context: {
		organizationId: string;
		sessionReader: SessionReader;
	}) => ({
		workspaceId: context.organizationId,
		reader: context.sessionReader,
	});

	return {
		estimateQuestions: os.analysis.estimateQuestions
			.use(orgMiddleware)
			.use(({ context, next, signal }) =>
				analysisLimiter.run(context.user.id, async () => next(), signal),
			)
			.handler(async ({ input, context }) => {
				const outcome = await estimateQuestions(
					callerOf(context),
					input,
					env(),
				);
				if (!outcome.ok) throw sqlError(outcome.error);
				return outcome.result;
			}),
		runQuestions: os.analysis.runQuestions
			.use(orgMiddleware)
			.use(({ context, next, signal }) =>
				analysisLimiter.run(context.user.id, async () => next(), signal),
			)
			.handler(async ({ input, context }) => {
				const outcome = await runQuestions(callerOf(context), input, env());
				if (!outcome.ok) throw sqlError(outcome.error);
				return outcome.result;
			}),
	};
}
