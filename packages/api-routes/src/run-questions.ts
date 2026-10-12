import { oc } from "@orpc/contract";
import { z } from "zod";
import { RunRefSchema, SQL_QUERY_MAX_CHARS } from "./analysis.js";

/**
 * Run questions (CONTEXT.md "Run question"; docs/retro-architecture.md "Run
 * questions"): yes/no questions Opaline sets, each answered per run as the
 * probability of yes. A new wording is a new question with its own id; earlier
 * answers keep the wording they answered.
 */

export const RUN_QUESTION_MAX_CHARS = 300;
/** Questions one estimate or run may name. */
export const RUN_QUESTIONS_PER_CALL = 10;
/** Runs one estimate or run may cover. */
export const RUN_QUESTION_MAX_RUNS = 5_000;
/** Runs a question is tested on in the internal form. */
export const RUN_QUESTION_TEST_RUNS = 20;

export const RunQuestionStateSchema = z.enum(["draft", "on", "retired"]);

export const RUN_QUESTION_CRITERIA_MAX_CHARS = 300;
const CriterionSchema = z
	.string()
	.trim()
	.min(3)
	.max(RUN_QUESTION_CRITERIA_MAX_CHARS);
/** What a yes and a no look like, for a question whose boundary is subtle. */
export const RunQuestionCriteriaSchema = z
	.object({ true: CriterionSchema, false: CriterionSchema })
	.strict();

export const RunQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	/** What a yes and a no look like; null when the question needs none. Part of the wording: changing it makes a new question. */
	criteria: RunQuestionCriteriaSchema.nullable(),
	/** draft until turned on; retired when removed or reworded. */
	state: RunQuestionStateSchema,
	/** The question this wording replaced, if it was reworded. */
	replaces: z.string().nullable(),
	/** Runs the operator judged in the last test, and the share of yes answers (p >= 0.5) they agreed with. */
	testedRuns: z.number().int().nullable(),
	testedPrecision: z.number().nullable(),
	/** The provider whose test answers the precision judges. */
	testedProvider: z.string().nullable(),
	createdAt: z.string(),
});

const QuestionIdSchema = z.string().trim().min(1).max(40);
const WordingSchema = z.string().trim().min(10).max(RUN_QUESTION_MAX_CHARS);

/** estimate_questions takes these; run_questions takes them with the estimate's token. */
export const RunQuestionsInputSchema = z
	.object({
		questions: z
			.array(QuestionIdSchema)
			.min(1)
			.max(RUN_QUESTIONS_PER_CALL)
			.transform((ids) => [...new Set(ids)]),
		/** One SELECT over the sql views returning session_id, agent_id and turn_idx; default: every run of the last 4 weeks. */
		runs: z.string().trim().min(1).max(SQL_QUERY_MAX_CHARS).optional(),
	})
	.strict();

/** run_questions: the same questions and runs as the estimate, and its token. */
export const RunQuestionsRunInputSchema = RunQuestionsInputSchema.extend({
	/** The token estimate_questions returned for exactly these questions and runs. */
	estimate: z.string().min(1).max(2_000),
}).strict();

const QuotaSchema = z.object({
	/** Answers the workspace may buy per window. */
	answers: z.number().int(),
	windowHours: z.number(),
	remaining: z.number().int(),
});

export const RunQuestionsEstimateSchema = z.object({
	/** Runs the query selected (at most RUN_QUESTION_MAX_RUNS). */
	runs: z.number().int(),
	questions: z.array(
		z.object({
			id: z.string(),
			question: z.string(),
			/** Answers already stored for these runs; reused, never paid again. */
			answered: z.number().int(),
			/** Answers already queued by an earlier run_questions. */
			queued: z.number().int(),
			/** Answers that would be bought. */
			toAnswer: z.number().int(),
		}),
	),
	toAnswer: z.number().int(),
	/** At most what the answers to buy cost (one call per run); null where answering is not configured. */
	costUsd: z.number().nullable(),
	quota: QuotaSchema,
	/** Whether run_questions may answer for this workspace now. */
	available: z.boolean(),
	/**
	 * What run_questions needs to buy these answers: bound to the caller, the
	 * workspace, these questions, exactly these runs and this cost; null when
	 * answering is not available or nothing is to buy.
	 */
	token: z.string().nullable(),
	/** When the token stops being accepted (ISO time). */
	tokenExpiresAt: z.string().nullable(),
	notices: z.array(z.string()),
});

export const RunQuestionsRunSchema = z.object({
	/** The queued job, or null when every answer was already stored or queued. */
	job: z.string().nullable(),
	runs: z.number().int(),
	reused: z.number().int(),
	alreadyQueued: z.number().int(),
	queued: z.number().int(),
	/** At most what the queued answers cost. */
	costUsd: z.number(),
	notices: z.array(z.string()),
});

/** The internal form (Opaline operators only). */
const QuestionRefSchema = z.object({ id: QuestionIdSchema }).strict();
/** A configured provider, e.g. subq, jev or subq:run; omitted, the default (the first configured). */
const ProviderNameSchema = z.string().trim().min(1).max(40);

export const RunQuestionTestInputSchema = z
	.object({
		id: QuestionIdSchema,
		/** The workspace whose last 20 runs are answered; the operator must be a member. */
		workspaceId: z.string().min(1).max(200),
		provider: ProviderNameSchema.optional(),
	})
	.strict();

/** The newest test of a question, by one provider or any. */
export const RunQuestionTestRefSchema = z
	.object({ id: QuestionIdSchema, provider: ProviderNameSchema.optional() })
	.strict();

export const RunQuestionTestSchema = z.object({
	status: z.enum(["none", "queued", "done", "failed"]),
	workspaceId: z.string().nullable(),
	/** The provider that answered the test. */
	provider: z.string().nullable(),
	runs: z.array(
		RunRefSchema.extend({
			promptHead: z.string(),
			/** The probability of yes, once answered. */
			probability: z.number().nullable(),
		}),
	),
});

export const RunQuestionVerdictInputSchema = z
	.object({
		id: QuestionIdSchema,
		/** The provider whose newest test is judged; omitted, the newest test by any. */
		provider: ProviderNameSchema.optional(),
		/** The operator's judgement per tested run: is the true answer yes? */
		verdicts: z
			.array(RunRefSchema.extend({ yes: z.boolean() }).strict())
			.min(1)
			.max(RUN_QUESTION_TEST_RUNS),
	})
	.strict();

export const runQuestionsAdminContract = {
	list: oc.input(z.object({}).strict()).output(
		z.object({
			questions: z.array(RunQuestionSchema),
			/** Providers configured here, the default (which answers agents) first; empty when answering is off. */
			providers: z.array(z.string()),
		}),
	),
	add: oc
		.input(
			z
				.object({
					question: WordingSchema,
					criteria: RunQuestionCriteriaSchema.optional(),
				})
				.strict(),
		)
		.output(RunQuestionSchema),
	edit: oc
		.input(
			z
				.object({
					id: QuestionIdSchema,
					question: WordingSchema,
					criteria: RunQuestionCriteriaSchema.optional(),
				})
				.strict(),
		)
		.output(RunQuestionSchema),
	remove: oc.input(QuestionRefSchema).output(RunQuestionSchema),
	turnOn: oc.input(QuestionRefSchema).output(RunQuestionSchema),
	test: oc.input(RunQuestionTestInputSchema).output(RunQuestionTestSchema),
	testResult: oc.input(RunQuestionTestRefSchema).output(RunQuestionTestSchema),
	recordVerdicts: oc
		.input(RunQuestionVerdictInputSchema)
		.output(RunQuestionSchema),
};

export const runQuestionsAnalysisContract = {
	estimateQuestions: oc
		.input(RunQuestionsInputSchema)
		.output(RunQuestionsEstimateSchema),
	runQuestions: oc
		.input(RunQuestionsRunInputSchema)
		.output(RunQuestionsRunSchema),
};

export type RunQuestion = z.infer<typeof RunQuestionSchema>;
export type RunQuestionCriteria = z.infer<typeof RunQuestionCriteriaSchema>;
export type RunQuestionsInput = z.infer<typeof RunQuestionsInputSchema>;
export type RunQuestionsRunInput = z.infer<typeof RunQuestionsRunInputSchema>;
export type RunQuestionsEstimate = z.infer<typeof RunQuestionsEstimateSchema>;
export type RunQuestionsRun = z.infer<typeof RunQuestionsRunSchema>;
export type RunQuestionTest = z.infer<typeof RunQuestionTestSchema>;
export type RunQuestionVerdictInput = z.infer<
	typeof RunQuestionVerdictInputSchema
>;
