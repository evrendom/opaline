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

/** Characters of the short name the dashboard shows as a tag. */
export const RUN_QUESTION_LABEL_MAX_CHARS = 40;
export const RunQuestionLabelSchema = z
	.string()
	.trim()
	.min(2)
	.max(RUN_QUESTION_LABEL_MAX_CHARS);

export const RunQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	/** The short name the dashboard shows as a tag; null shows the wording cut short. Not part of the wording: it changes in place. */
	label: z.string().nullable(),
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
					label: RunQuestionLabelSchema.optional(),
					criteria: RunQuestionCriteriaSchema.optional(),
				})
				.strict(),
		)
		.output(RunQuestionSchema),
	/** A new wording or criteria make a new question; a new label alone changes the question in place. */
	edit: oc
		.input(
			z
				.object({
					id: QuestionIdSchema,
					question: WordingSchema,
					label: RunQuestionLabelSchema.optional(),
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

/**
 * Run question answers the dashboard shows (sessions list and reader), only
 * in a workspace whose runs are answered: elsewhere `enabled` is false and
 * nothing is read. An answer counts as yes from `RUN_QUESTION_YES_PROBABILITY`.
 */
export const RUN_QUESTION_YES_PROBABILITY = 0.5;
/** Sessions one tags call may name. */
export const SESSION_RUN_QUESTION_TAGS_MAX_SESSIONS = 100;

const SessionIdSchema = z.string().min(1).max(200);

export const SessionRunQuestionTagsInputSchema = z
	.object({
		sessionIds: z
			.array(SessionIdSchema)
			.min(1)
			.max(SESSION_RUN_QUESTION_TAGS_MAX_SESSIONS)
			.transform((ids) => [...new Set(ids)]),
	})
	.strict();

/** One question answered yes about at least one run of a session. */
export const SessionRunQuestionTagSchema = z.object({
	id: z.string(),
	question: z.string(),
	/** The short name to show; null shows the wording cut short. */
	label: z.string().nullable(),
	/** Runs of the session (every stream) answered yes. */
	runs: z.number().int().positive(),
	/** The highest probability of yes among those runs. */
	probability: z.number(),
});

export const SessionRunQuestionTagsSchema = z.object({
	/** Whether this workspace's runs are answered; false leaves `sessions` empty. */
	enabled: z.boolean(),
	/** Only sessions with at least one yes, in no particular order. */
	sessions: z.array(
		z.object({
			sessionId: z.string(),
			questions: z.array(SessionRunQuestionTagSchema),
		}),
	),
});

export const SessionRunAnswersInputSchema = z
	.object({ sessionId: SessionIdSchema })
	.strict();

/** Every answer stored about one run of the session's committed transcript. */
export const SessionRunAnswersRunSchema = z.object({
	/** The stream: empty for the main transcript, else the subagent. */
	agentId: z.string(),
	/** The run within its stream (runs.turn_idx). */
	turn: z.number().int(),
	/** ISO time of the run's first record, which is its prompt; matches the reader's turn start. */
	startedAt: z.string(),
	questions: z.array(
		z.object({
			id: z.string(),
			question: z.string(),
			label: z.string().nullable(),
			probability: z.number(),
		}),
	),
});

export const SessionRunAnswersSchema = z.object({
	enabled: z.boolean(),
	runs: z.array(SessionRunAnswersRunSchema),
});

/** Runs one agent runs page lists. */
export const AGENT_RUNS_MAX_LIMIT = 200;
/** Questions one agent runs page may filter on. */
export const AGENT_RUNS_MAX_FILTERS = 20;

/** Runs whose newest answer to one question lies in [min, max] (probabilities of yes, 0 to 1). */
export const AgentRunsFilterSchema = z
	.object({
		questionId: QuestionIdSchema,
		min: z.number().min(0).max(1),
		max: z.number().min(0).max(1),
	})
	.strict()
	.refine((filter) => filter.min <= filter.max, {
		message: "min must not exceed max",
	});

export const AgentRunsInputSchema = z
	.object({
		/** First and last day (UTC) of the runs' start, inclusive. */
		startDate: z.string().date(),
		endDate: z.string().date(),
		/** Every filter must hold; ignored where the workspace's runs are not answered. */
		filters: z.array(AgentRunsFilterSchema).max(AGENT_RUNS_MAX_FILTERS),
		limit: z.number().int().min(1).max(AGENT_RUNS_MAX_LIMIT).default(100),
		/** The previous page's `nextCursor`. */
		cursor: z.string().min(1).max(1_000).optional(),
	})
	.strict();

/** One run of a session's committed transcript, with every answer about it. */
export const AgentRunSchema = z.object({
	sessionId: z.string(),
	/** The member whose session it is. */
	userId: z.string(),
	/** The stream: empty for the main transcript, else the subagent. */
	agentId: z.string(),
	/** The run within its stream (runs.turn_idx). */
	turn: z.number().int(),
	/** ISO time of the run's first record, its prompt; matches the reader's turn start. */
	startedAt: z.string(),
	endedAt: z.string(),
	/** claude_code or codex. */
	source: z.string(),
	/** First model the run recorded; null when not recorded. */
	model: z.string().nullable(),
	/** The first 160 characters of the run's prompt; null when it has none. */
	prompt: z.string().nullable(),
	/** Wall-clock minutes from the prompt to the last record. */
	minutes: z.number(),
	/** Priced cost; null when none is priced. */
	costUsd: z.number().nullable(),
	toolCalls: z.number().int(),
	failedCalls: z.number().int(),
	/** The session's repository key; empty when none was recorded. */
	repository: z.string(),
	/** The newest answer per question, most likely yes first. */
	answers: z.array(z.object({ id: z.string(), probability: z.number() })),
});

export const AgentRunsSchema = z.object({
	/** Whether this workspace's runs are answered; false lists runs without answers or filters. */
	enabled: z.boolean(),
	/** The questions answered now (turned on), to filter and name the answers by. */
	questions: z.array(
		z.object({
			id: z.string(),
			question: z.string(),
			label: z.string().nullable(),
		}),
	),
	/** Newest run first. */
	runs: z.array(AgentRunSchema),
	/** Pass as `cursor` for the next page; null on the last. */
	nextCursor: z.string().nullable(),
});

/** Whether the caller's workspace may open Agent traces (`AGENT_TRACES_WORKSPACES`). */
export const AgentTracesAccessSchema = z.object({ enabled: z.boolean() });

export const sessionRunQuestionsContract = {
	/** Refused (FORBIDDEN) where `agentTracesAccess` is not enabled. */
	agentRuns: oc.input(AgentRunsInputSchema).output(AgentRunsSchema),
	agentTracesAccess: oc.output(AgentTracesAccessSchema),
	runQuestionTags: oc
		.input(SessionRunQuestionTagsInputSchema)
		.output(SessionRunQuestionTagsSchema),
	runAnswers: oc
		.input(SessionRunAnswersInputSchema)
		.output(SessionRunAnswersSchema),
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
export type SessionRunQuestionTag = z.infer<typeof SessionRunQuestionTagSchema>;
export type SessionRunQuestionTags = z.infer<
	typeof SessionRunQuestionTagsSchema
>;
export type SessionRunAnswersRun = z.infer<typeof SessionRunAnswersRunSchema>;
export type SessionRunAnswers = z.infer<typeof SessionRunAnswersSchema>;
export type AgentRunsFilter = z.infer<typeof AgentRunsFilterSchema>;
export type AgentRunsInput = z.input<typeof AgentRunsInputSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentRuns = z.infer<typeof AgentRunsSchema>;
