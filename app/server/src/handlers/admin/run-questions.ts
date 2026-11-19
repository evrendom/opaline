import { ORPCError } from "@orpc/server";
import { sqlClient } from "../../db.js";
import { adminMiddleware, os } from "../../middleware.js";
import {
	addRunQuestion,
	editRunQuestion,
	listRunQuestions,
	RunQuestionError,
	removeRunQuestion,
	turnOnRunQuestion,
} from "../../services/run-questions/catalogue.js";
import { runQuestionsEnv } from "../../services/run-questions/env.js";
import {
	readRunQuestionTest,
	recordRunQuestionVerdicts,
	testRunQuestion,
} from "../../services/run-questions/run-questions.service.js";

/**
 * The internal run question form (CONTEXT.md "Run question"): only members
 * of Opaline's admin organization manage the catalogue, test a question on a
 * workspace's newest runs and record their verdicts.
 */
const procedures = os.admin.runQuestions;

export const runQuestionsAdminRouter = {
	list: procedures.list.use(adminMiddleware).handler(async () => ({
		questions: await listRunQuestions(sqlClient),
		providers: [...(runQuestionsEnv().providers?.keys() ?? [])],
	})),
	add: procedures.add
		.use(adminMiddleware)
		.handler(({ input }) =>
			refusals(
				addRunQuestion(
					sqlClient,
					input.question,
					input.criteria ?? null,
					null,
					input.label ?? null,
				),
			),
		),
	edit: procedures.edit
		.use(adminMiddleware)
		.handler(({ input }) =>
			refusals(
				editRunQuestion(
					sqlClient,
					input.id,
					input.question,
					input.criteria ?? null,
					input.label ?? null,
				),
			),
		),
	remove: procedures.remove
		.use(adminMiddleware)
		.handler(({ input }) => refusals(removeRunQuestion(sqlClient, input.id))),
	turnOn: procedures.turnOn
		.use(adminMiddleware)
		.handler(({ input }) => refusals(turnOnRunQuestion(sqlClient, input.id))),
	test: procedures.test
		.use(adminMiddleware)
		.handler(({ input, context }) =>
			refusals(testRunQuestion(context.user.id, input, runQuestionsEnv())),
		),
	testResult: procedures.testResult
		.use(adminMiddleware)
		.handler(({ input, context }) =>
			refusals(
				readRunQuestionTest(
					context.user.id,
					input.id,
					runQuestionsEnv(),
					input.provider ?? null,
				),
			),
		),
	recordVerdicts: procedures.recordVerdicts
		.use(adminMiddleware)
		.handler(({ input, context }) =>
			refusals(
				recordRunQuestionVerdicts(context.user.id, input, runQuestionsEnv()),
			),
		),
};

/** A catalogue refusal as the form shows it. */
async function refusals<T>(work: Promise<T>): Promise<T> {
	try {
		return await work;
	} catch (error) {
		if (error instanceof RunQuestionError)
			throw new ORPCError(error.code, { message: error.message });
		throw error;
	}
}
