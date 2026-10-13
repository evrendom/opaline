import { getLogger } from "@logtape/logtape";
import {
	RUN_QUESTION_MAX_RUNS,
	RUN_QUESTION_TEST_RUNS,
	type RunQuestion,
	type RunQuestionsEstimate,
	type RunQuestionsInput,
	type RunQuestionsRun,
	type RunQuestionsRunInput,
	type RunQuestionTest,
	type RunQuestionVerdictInput,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import type { AgentQueryLimiter } from "../analysis/agent-query-slots.js";
import {
	type SqlCaller,
	type SqlFailure,
	selectRuns,
} from "../analysis/sql-gateway.js";
import type { SqlQuota } from "../analysis/sql-results.js";
import { readSessionReader } from "../session-reader.service.js";
import { readableSessionOwner } from "../session-visibility.js";
import { answerKey, readAnswers, runKey, writeAnswers } from "./answers.js";
import {
	findRunQuestions,
	liveQuestion,
	RunQuestionError,
	recordTestedPrecision,
} from "./catalogue.js";
import { estimateMismatch, signEstimate } from "./estimate-token.js";
import {
	claimRunQuestionJob,
	enqueueRunQuestionJob,
	failRunQuestionJob,
	finishRunQuestionJob,
	type JobRun,
	latestTestJob,
	queuedAnswers,
	RUN_QUESTION_ANSWER_QUOTA,
	type RunQuestionJob,
	recordJobUsage,
	releaseRunQuestionJob,
	remainingAnswerQuota,
	takeAnswerQuota,
	withRunQuestionLock,
} from "./jobs.js";
import {
	type AskedQuestion,
	type ProviderAnswers,
	type RunQuestionProvider,
	RunQuestionProviderBusy,
	RunQuestionProviderFatal,
} from "./provider.js";
import { buildRunState, type RunFacts, readRunFacts } from "./run-notes.js";

/**
 * Run questions (CONTEXT.md "Run question"; docs/retro-architecture.md "Run
 * questions"). In a workspace whose run questions may be answered, every new
 * run is answered for every question that is on as soon as its run index is
 * built (`precompute.ts`). An agent can also estimate (cost, quota, answers
 * already stored or queued; nothing is sent) and ask about other questions or
 * runs: the answers it does not have yet are queued. The run-questions cron
 * answers every queued job with retries, one call per run. Answers are kept
 * per question wording, run revision and provider and reused by every later
 * analysis, so asking again pays nothing.
 */

const logger = getLogger(["rudel", "api", "run-questions"]);

export interface RunQuestionsEnv {
	readonly executor: ClickHouseExecutor;
	readonly sql: postgres.Sql;
	/** Who answers agents; null where none is configured, and then nothing is sent. */
	readonly provider: RunQuestionProvider | null;
	/** Every configured provider by name, for form tests and the jobs they queue; the default alone when absent. */
	readonly providers?: ReadonlyMap<string, RunQuestionProvider>;
	/** Whether run notes of this workspace may be sent to the provider. */
	readonly mayAnswer: (workspaceId: string) => boolean;
	/** The sql quota that selecting runs counts against. */
	readonly sqlQuota: SqlQuota;
	/** The query slots sql takes too: selecting runs reads ClickHouse in one. */
	readonly limiter: AgentQueryLimiter;
	/** The GitHub repositories the runs SQL may read, as for sql. */
	readonly githubRepositories: (
		workspaceId: string,
	) => Promise<readonly string[]>;
	readonly answerQuota?: { answers: number; windowMs: number };
	/** Signs and checks estimate tokens; null where no server secret is set, and then nothing is answered. */
	readonly estimateKey: string | null;
}

export type RunQuestionsOutcome<T> =
	| { readonly ok: true; readonly result: T }
	| { readonly ok: false; readonly error: SqlFailure };

/** The runs answered when an agent names none: the newest of the last 4 weeks, up to the cap. */
export const DEFAULT_RUNS_SQL = `SELECT session_id, agent_id, turn_idx FROM runs
	WHERE started_at >= now() - INTERVAL 28 DAY
	ORDER BY started_at DESC LIMIT ${RUN_QUESTION_MAX_RUNS}`;
/** The runs a test in the internal form answers: the newest main-stream runs with a prompt. */
const TEST_RUNS_SQL = `SELECT session_id, agent_id, turn_idx FROM runs
	WHERE started_at >= now() - INTERVAL 28 DAY AND agent_id = '' AND genuine_prompts > 0
	ORDER BY started_at DESC LIMIT ${RUN_QUESTION_TEST_RUNS}`;
const JOB_LEASE_MS = 300_000;
/** No provider call starts after the budget; one still running is cut an eighth of the budget later (270 s), inside the lease and the 300 s function limit. */
const WORKER_BUDGET_MS = 240_000;
const CALL_OVERRUN_SHARE = 1 / 8;
/** How long a job waits when its workspace's answer quota is used up. */
const QUOTA_WAIT_MS = 900_000;
/** How long a rate-limited job waits when the provider does not say. */
const RATE_LIMIT_WAIT_MS = 60_000;
const NOT_EVIDENCE =
	"Answers say where to read, not why: open the runs with read before naming a cause.";

export async function estimateQuestions(
	caller: SqlCaller,
	input: RunQuestionsInput,
	env: RunQuestionsEnv,
): Promise<RunQuestionsOutcome<RunQuestionsEstimate>> {
	const planned = await plan(caller, input, env);
	if (!planned.ok) return planned;
	const { questions, runs } = planned.result;
	const provider = env.provider;
	const queued = provider
		? await queuedAnswers(
				env.sql,
				caller.workspaceId,
				questions.map((question) => question.id),
				provider.name,
			)
		: new Set<string>();
	const counted = count(planned.result, queued);
	const quota = env.answerQuota ?? RUN_QUESTION_ANSWER_QUOTA;
	const available =
		provider !== null &&
		env.mayAnswer(caller.workspaceId) &&
		env.estimateKey !== null;
	const costUsd = provider
		? ceilingUsd(provider, planned.result, counted)
		: null;
	const signed =
		available && costUsd !== null && env.estimateKey
			? signEstimate(env.estimateKey, {
					...binding(caller, planned.result, provider),
					costUsd,
				})
			: null;
	return {
		ok: true,
		result: {
			runs: runs.length,
			questions: counted.questions,
			toAnswer: counted.toAnswer,
			costUsd,
			quota: {
				answers: quota.answers,
				windowHours: quota.windowMs / 3_600_000,
				remaining: await remainingAnswerQuota(
					env.sql,
					caller.workspaceId,
					quota,
				),
			},
			available,
			token: signed?.token ?? null,
			tokenExpiresAt: signed?.expiresAt ?? null,
			notices: [
				"Nothing was sent: this is an estimate.",
				...(input.runs ? [] : [DEFAULT_RUNS_NOTICE]),
				...(provider
					? [
							"The cost is a ceiling: one call per run with every question about it, at the longest note; the provider bills what the calls use.",
						]
					: [
							"Answering is not configured in this environment, so run_questions cannot answer; use sql and read.",
						]),
				...(provider && !available
					? [
							"This workspace cannot have run questions answered yet; use sql and read.",
						]
					: []),
				...(signed
					? [
							"To buy these answers, call run_questions with the same questions and runs and this token before it expires; it is refused if the runs selected or the cost change.",
						]
					: []),
				NOT_EVIDENCE,
			],
		},
	};
}

export async function runQuestions(
	caller: SqlCaller,
	input: RunQuestionsRunInput,
	env: RunQuestionsEnv,
): Promise<RunQuestionsOutcome<RunQuestionsRun>> {
	const provider = env.provider;
	if (!provider)
		return fatal(
			"Answering run questions is not configured in this environment; nothing was sent.",
		);
	if (!env.mayAnswer(caller.workspaceId) || !env.estimateKey)
		return fatal(
			"This workspace cannot have run questions answered yet; nothing was sent.",
		);
	const estimateKey = env.estimateKey;
	const planned = await plan(caller, input, env);
	if (!planned.ok) return planned;
	const quota = env.answerQuota ?? RUN_QUESTION_ANSWER_QUOTA;
	const remaining = await remainingAnswerQuota(
		env.sql,
		caller.workspaceId,
		quota,
	);
	// Under a per-workspace lock, so two calls never queue the same answer.
	const queuing = await withRunQuestionLock(
		env.sql,
		caller.workspaceId,
		async (sql) => {
			const counted = count(
				planned.result,
				await queuedAnswers(
					sql,
					caller.workspaceId,
					planned.result.questions.map((question) => question.id),
					provider.name,
				),
			);
			const costUsd = ceilingUsd(provider, planned.result, counted);
			// Only what the caller saw estimated: the same caller, workspace,
			// question versions and runs, at no more than the estimated cost.
			const mismatch = estimateMismatch(estimateKey, input.estimate, {
				...binding(caller, planned.result, provider),
				costUsd,
			});
			if (mismatch) return { counted, costUsd, refusal: mismatch };
			if (counted.toAnswer > remaining)
				return {
					counted,
					costUsd,
					refusal: `The workspace's answer quota (${quota.answers} per ${quota.windowMs / 3_600_000} hours) has ${remaining} answers left, fewer than the ${counted.toAnswer} this needs.`,
				};
			const job =
				counted.toAnswer > 0
					? await enqueueRunQuestionJob(sql, {
							workspaceId: caller.workspaceId,
							requestedBy: caller.reader.userId,
							purpose: "analysis",
							provider: provider.name,
							runs: counted.runs,
						})
					: null;
			return { counted, costUsd, job };
		},
	);
	if ("refusal" in queuing)
		return {
			ok: false,
			error: {
				kind: "recoverable",
				message: `${queuing.refusal} Nothing was sent.`,
				fragment: null,
				fix: "Call estimate_questions again with the questions and runs to buy, check the cost, then call run_questions with its token.",
			},
		};
	const { counted, job } = queuing;
	return {
		ok: true,
		result: {
			job,
			runs: planned.result.runs.length,
			reused: sum(counted.questions, "answered"),
			alreadyQueued: sum(counted.questions, "queued"),
			queued: counted.toAnswer,
			costUsd: queuing.costUsd,
			notices: [
				counted.toAnswer > 0
					? "Queued: answers are stored as they arrive, usually within minutes; read them with sql from run_answers."
					: "Nothing to answer: every answer is stored or already queued.",
				...(input.runs ? [] : [DEFAULT_RUNS_NOTICE]),
				"Asking again about the same runs pays nothing.",
				NOT_EVIDENCE,
			],
		},
	};
}

/**
 * One pass of the run-questions cron: claims due jobs and answers what they
 * still need, one call per run with every question about it, until the
 * budget ends. The quota for a call's answers is taken just before the call,
 * and its answers and usage are stored as soon as it returns, so a failure
 * or a cut-off pass keeps what was paid for; the job is retried later with
 * backoff. A job cut by the budget, the quota or the provider's rate limit is
 * handed back without using an attempt.
 */
export async function answerQueuedQuestions(
	env: RunQuestionsEnv,
	options: { budgetMs?: number } = {},
): Promise<{
	jobs: number;
	answers: number;
	costUsd: number;
	/** Providers that refused for good this pass (no credits, HTTP 402), with why. */
	refused: { provider: string; error: string }[];
}> {
	const totals = {
		jobs: 0,
		answers: 0,
		costUsd: 0,
		refused: [] as { provider: string; error: string }[],
	};
	if (!env.provider && !env.providers?.size) return totals;
	const budgetMs = options.budgetMs ?? WORKER_BUDGET_MS;
	const deadline = Date.now() + budgetMs;
	const time = { deadline, stopAt: deadline + budgetMs * CALL_OVERRUN_SHARE };
	// Only jobs of providers configured here; one that refused for good (no
	// credits) is not asked again this pass.
	const answering = new Set(
		env.providers?.keys() ?? (env.provider ? [env.provider.name] : []),
	);
	while (Date.now() < deadline && answering.size > 0) {
		const job = await claimRunQuestionJob(env.sql, JOB_LEASE_MS, [
			...answering,
		]);
		if (!job) break;
		totals.jobs++;
		const spent = { answers: 0, costUsd: 0 };
		try {
			const provider = providerNamed(env, job.provider);
			if (!provider)
				throw new Error(
					`Run question provider ${job.provider} is not configured here`,
				);
			const outcome = await answerJob(job, provider, env, time, spent);
			if (outcome === "done") await finishRunQuestionJob(env.sql, job);
			else
				await releaseRunQuestionJob(
					env.sql,
					job,
					outcome === "quota" ? QUOTA_WAIT_MS : 0,
				);
		} catch (error) {
			if (error instanceof RunQuestionProviderBusy && error.rateLimited)
				await releaseRunQuestionJob(
					env.sql,
					job,
					error.retryAfterMs ?? RATE_LIMIT_WAIT_MS,
				);
			else if (error instanceof RunQuestionProviderFatal) {
				answering.delete(job.provider);
				totals.refused.push({ provider: job.provider, error: error.message });
				logger.error(
					"Run question provider {provider} refused for good: {error}",
					{ provider: job.provider, error: error.message },
				);
				await failRunQuestionJob(env.sql, job, error, { final: true });
			} else
				await failRunQuestionJob(env.sql, job, error, {
					retryAfterMs:
						error instanceof RunQuestionProviderBusy
							? error.retryAfterMs
							: null,
				});
		}
		totals.answers += spent.answers;
		totals.costUsd += spent.costUsd;
	}
	return totals;
}

/**
 * The internal form's test: the newest 20 runs with a prompt in a workspace
 * the operator belongs to are answered for the question, on or not, so the
 * operator can judge the answers before turning it on.
 */
export async function testRunQuestion(
	operatorId: string,
	input: { id: string; workspaceId: string; provider?: string },
	env: RunQuestionsEnv,
): Promise<RunQuestionTest> {
	const question = await liveQuestion(env.sql, input.id);
	const reader = await readSessionReader(
		input.workspaceId,
		operatorId,
		env.sql,
	);
	if (!reader)
		throw new RunQuestionError(
			"FORBIDDEN",
			"You are not a member of this workspace.",
		);
	const provider = providerNamed(env, input.provider);
	if (!provider)
		throw new RunQuestionError(
			"BAD_REQUEST",
			input.provider
				? `Run question provider ${input.provider} is not configured here (RUN_QUESTIONS_PROVIDER); nothing was sent.`
				: "Answering is not configured in this environment (RUN_QUESTIONS_PROVIDER); nothing was sent.",
		);
	if (!env.mayAnswer(input.workspaceId))
		throw new RunQuestionError(
			"FORBIDDEN",
			"This workspace cannot have run questions answered yet; test in one of Opaline's own workspaces.",
		);
	const caller = { workspaceId: input.workspaceId, reader };
	// The runs' facts are read in the same query slot as their selection.
	const selected = await selectRuns(
		caller,
		TEST_RUNS_SQL,
		sqlEnvOf(env),
		RUN_QUESTION_TEST_RUNS,
		({ runs }) =>
			readRunFacts(
				env.executor,
				input.workspaceId,
				runs,
				readableSessionOwner(reader),
			),
	);
	if (!selected.ok)
		throw new RunQuestionError("BAD_REQUEST", selected.error.message);
	const facts = selected.value;
	if (facts.size === 0)
		throw new RunQuestionError(
			"BAD_REQUEST",
			"The workspace has no runs with a prompt in the last 4 weeks.",
		);
	// Every tested run is listed, but under the workspace's lock only the
	// answers neither stored nor queued by another job are to be bought.
	const runs = [...facts.values()];
	await withRunQuestionLock(env.sql, input.workspaceId, async (sql) => {
		const [stored, queued] = await Promise.all([
			readAnswers(
				env.executor,
				input.workspaceId,
				[question.id],
				runs,
				provider.name,
			),
			queuedAnswers(sql, input.workspaceId, [question.id], provider.name),
		]);
		const has = (run: RunFacts) => {
			const key = answerKey(question.id, run);
			return stored.has(key) || queued.has(key);
		};
		await enqueueRunQuestionJob(sql, {
			workspaceId: input.workspaceId,
			requestedBy: operatorId,
			purpose: "test",
			provider: provider.name,
			questionIds: [question.id],
			runs: runs.map((run) => jobRun(run, has(run) ? [] : [question.id])),
		});
	});
	return readRunQuestionTest(operatorId, question.id, env, provider.name);
}

/**
 * The question's newest test, by the provider or any: its runs with their
 * prompts and, once answered, the provider's probabilities. Only a member of
 * the tested workspace sees them, and only the runs they may read.
 */
export async function readRunQuestionTest(
	operatorId: string,
	id: string,
	env: Pick<RunQuestionsEnv, "executor" | "sql">,
	provider: string | null = null,
): Promise<RunQuestionTest> {
	const job = await latestTestJob(env.sql, id, provider);
	if (!job)
		return { status: "none", workspaceId: null, provider: null, runs: [] };
	const reader = await readSessionReader(job.workspaceId, operatorId, env.sql);
	if (!reader)
		throw new RunQuestionError(
			"FORBIDDEN",
			"The newest test ran in a workspace you are not a member of; run a test in one of yours.",
		);
	// Only the tested runs of sessions the operator may read, with their answers.
	const facts = await readRunFacts(
		env.executor,
		job.workspaceId,
		job.runs,
		readableSessionOwner(reader),
	);
	const runs = job.runs.filter((run) => facts.has(runKey(run)));
	const answers = await readAnswers(
		env.executor,
		job.workspaceId,
		[id],
		runs,
		job.provider,
	);
	// A test's answer may be bought by an earlier job; until it is, the test waits.
	const waiting =
		job.status === "done" &&
		runs.some((run) => !answers.has(answerKey(id, run))) &&
		(await queuedAnswers(env.sql, job.workspaceId, [id], job.provider)).size >
			0;
	return {
		status: waiting ? "queued" : job.status,
		workspaceId: job.workspaceId,
		provider: job.provider,
		runs: runs.map((run) => ({
			sessionId: run.sessionId,
			agentId: run.agentId,
			turn: run.turn,
			promptHead: facts.get(runKey(run))?.promptHead ?? "",
			probability: answers.get(answerKey(id, run)) ?? null,
		})),
	};
}

/**
 * The operator's verdicts on the newest test: precision is the share of runs
 * answered yes (probability 0.5 or more) that the operator judged yes; runs
 * without an answer are not counted.
 */
export async function recordRunQuestionVerdicts(
	operatorId: string,
	input: RunQuestionVerdictInput,
	env: Pick<RunQuestionsEnv, "executor" | "sql">,
): Promise<RunQuestion> {
	const test = await readRunQuestionTest(
		operatorId,
		input.id,
		env,
		input.provider ?? null,
	);
	const probabilities = new Map(
		test.runs.map((run) => [runKey(run), run.probability]),
	);
	const judged = input.verdicts.flatMap((verdict) => {
		const probability = probabilities.get(runKey(verdict));
		return probability === undefined || probability === null
			? []
			: [{ yes: verdict.yes, answeredYes: probability >= 0.5 }];
	});
	if (judged.length === 0)
		throw new RunQuestionError(
			"BAD_REQUEST",
			"None of these runs has an answer from the newest test yet.",
		);
	const answeredYes = judged.filter((item) => item.answeredYes);
	return recordTestedPrecision(env.sql, input.id, {
		runs: judged.length,
		provider: test.provider,
		precision: answeredYes.length
			? answeredYes.filter((item) => item.yes).length / answeredYes.length
			: null,
	});
}

const DEFAULT_RUNS_NOTICE = `Runs: the newest ${RUN_QUESTION_MAX_RUNS.toLocaleString("en-US")} runs that started in the last 4 weeks.`;

interface Plan {
	questions: RunQuestion[];
	/** The selected runs the caller may read, with their owners. */
	runs: RunFacts[];
	/** Answers already stored, by `answerKey`. */
	answered: ReadonlyMap<string, number>;
}

/** The questions (on), the selected runs the caller may read, and the answers already stored. */
async function plan(
	caller: SqlCaller,
	input: RunQuestionsInput,
	env: RunQuestionsEnv,
): Promise<RunQuestionsOutcome<Plan>> {
	const found = await findRunQuestions(env.sql, input.questions);
	const usable = found.filter((question) => question.state === "on");
	const unusable = input.questions.filter(
		(id) => !usable.some((question) => question.id === id),
	);
	if (unusable.length > 0)
		return {
			ok: false,
			error: {
				kind: "recoverable",
				message: `Not a run question that is on: ${unusable.join(", ")}.`,
				fragment: unusable[0] ?? null,
				fix: "Call schema without arguments to list the run questions that are on, with their ids.",
			},
		};
	const ids = usable.map((question) => question.id);
	// The selected runs' facts and stored answers are read in the same query
	// slot as their selection, under its one query of the quota.
	const selected = await selectRuns(
		caller,
		input.runs ?? DEFAULT_RUNS_SQL,
		sqlEnvOf(env),
		RUN_QUESTION_MAX_RUNS,
		async ({ runs: chosen, more }) => {
			if (more) return null;
			// Only runs of sessions the caller may read: the query can return
			// any literal ids, so they are looked up again through the scoped
			// runs view.
			const facts = await readRunFacts(
				env.executor,
				caller.workspaceId,
				chosen,
				readableSessionOwner(caller.reader),
			);
			const runs = chosen.flatMap((run) => facts.get(runKey(run)) ?? []);
			return {
				runs,
				answered: await readAnswers(
					env.executor,
					caller.workspaceId,
					ids,
					runs,
					env.provider?.name ?? null,
				),
			};
		},
	);
	if (!selected.ok) return selected;
	if (selected.value === null)
		return {
			ok: false,
			error: {
				kind: "recoverable",
				message: `The query selects more than ${RUN_QUESTION_MAX_RUNS.toLocaleString("en-US")} runs.`,
				fragment: null,
				fix: "Narrow it: a shorter started_at range, the main stream only (agent_id = ''), or runs another answer or fact already ranks high.",
			},
		};
	return {
		ok: true,
		result: { questions: usable, ...selected.value },
	};
}

/** The sql environment that selecting runs reads in: sql's scope, slots and quota. */
function sqlEnvOf(env: RunQuestionsEnv) {
	return {
		executor: env.executor,
		quota: env.sqlQuota,
		limiter: env.limiter,
		githubRepositories: env.githubRepositories,
	};
}

/** Per question: answers stored, queued and to buy; and the runs with the questions to buy for each. */
function count(plan: Plan, queued: ReadonlySet<string>) {
	const toBuy = new Map<string, string[]>();
	const questions = plan.questions.map((question) => {
		const counts = { answered: 0, queued: 0, toAnswer: 0 };
		for (const run of plan.runs) {
			const key = answerKey(question.id, run);
			if (plan.answered.has(key)) counts.answered++;
			else if (queued.has(key)) counts.queued++;
			else {
				counts.toAnswer++;
				toBuy.set(runKey(run), [
					...(toBuy.get(runKey(run)) ?? []),
					question.id,
				]);
			}
		}
		return { id: question.id, question: question.question, ...counts };
	});
	return {
		questions,
		toAnswer: sum(questions, "toAnswer"),
		runs: plan.runs.flatMap((run) => {
			const ids = toBuy.get(runKey(run));
			return ids ? [jobRun(run, ids)] : [];
		}),
	};
}

/**
 * Answers what the job still needs, one call per run: "done", or "deadline"
 * / "quota" when the budget or the workspace's answer quota ran out first.
 */
async function answerJob(
	job: RunQuestionJob,
	provider: RunQuestionProvider,
	env: RunQuestionsEnv,
	time: { deadline: number; stopAt: number },
	spent: { answers: number; costUsd: number },
): Promise<"done" | "deadline" | "quota"> {
	if (!env.mayAnswer(job.workspaceId))
		throw new Error("The workspace may no longer have run questions answered");
	const questions = new Map(
		(await findRunQuestions(env.sql, job.questionIds))
			.filter((question) => question.state !== "retired")
			.map((question) => [question.id, question]),
	);
	const [answered, facts] = await Promise.all([
		readAnswers(
			env.executor,
			job.workspaceId,
			[...questions.keys()],
			job.runs,
			provider.name,
		),
		readRunFacts(env.executor, job.workspaceId, job.runs),
	]);
	const quota = env.answerQuota ?? RUN_QUESTION_ANSWER_QUOTA;
	for (const run of job.runs) {
		const pending = run.questionIds.flatMap((id) => {
			const question = questions.get(id);
			return question && !answered.has(answerKey(id, run)) ? [question] : [];
		});
		// A run whose session was uploaded again since it was asked about is
		// another transcript: it is not answered (a new estimate asks anew).
		const fact = facts.get(runKey(run));
		if (pending.length === 0 || fact?.revision !== run.revision) continue;
		if (Date.now() >= time.deadline) return "deadline";
		const state = await buildRunState(
			env.executor,
			job.workspaceId,
			run,
			fact.promptHead,
			provider,
		);
		if (state === null) continue;
		if (Date.now() >= time.deadline) return "deadline";
		// The quota of exactly the answers this call asks for, just before it.
		if (
			!(await takeAnswerQuota(env.sql, job.workspaceId, pending.length, quota))
		)
			return "quota";
		const call = await askBefore(
			provider,
			{ state: state.text, questions: pending.map(asked) },
			time.stopAt,
		);
		const bought = pending.flatMap((question) => {
			const probability = call.probabilities.get(question.id);
			return probability === undefined ? [] : [{ question, probability }];
		});
		// Stored at once: a pass cut off later keeps every answer paid for.
		await writeAnswers(
			env.executor,
			bought.map(({ question, probability }) => ({
				workspaceId: job.workspaceId,
				ownerId: run.ownerId,
				sessionId: run.sessionId,
				agentId: run.agentId,
				turn: run.turn,
				revision: run.revision,
				questionId: question.id,
				question: question.question,
				probability,
				provider: provider.name,
				input: state.input,
				model: call.model,
				costUsd: call.costUsd / pending.length,
			})),
		);
		await recordJobUsage(env.sql, job, call);
		spent.answers += bought.length;
		spent.costUsd += call.costUsd;
		if (bought.length < pending.length)
			throw new Error(
				`The provider gave no valid answer to ${pending.length - bought.length} of ${pending.length} questions; they are asked again`,
			);
	}
	return "done";
}

/** The provider's answers, or an error once `stopAt` passes (the call is aborted). */
async function askBefore(
	provider: RunQuestionProvider,
	input: { state: string; questions: readonly AskedQuestion[] },
	stopAt: number,
): Promise<ProviderAnswers> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cut = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => {
				controller.abort();
				reject(
					new Error(
						"The provider did not answer before the pass's time ran out",
					),
				);
			},
			Math.max(0, stopAt - Date.now()),
		);
	});
	try {
		return await Promise.race([
			provider.answer({ ...input, signal: controller.signal }),
			cut,
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** The questions as the provider is asked them. */
function asked(question: RunQuestion): AskedQuestion {
	return {
		id: question.id,
		question: question.question,
		criteria: question.criteria,
	};
}

/** The provider of that name, or the default one when no name is given; null when not configured. */
function providerNamed(
	env: RunQuestionsEnv,
	name: string | undefined,
): RunQuestionProvider | null {
	if (name === undefined) return env.provider;
	return (
		env.providers?.get(name) ??
		(env.provider?.name === name ? env.provider : null)
	);
}

/** What an estimate token binds besides the cost. */
function binding(caller: SqlCaller, plan: Plan, provider: RunQuestionProvider) {
	return {
		userId: caller.reader.userId,
		workspaceId: caller.workspaceId,
		provider: provider.name,
		questions: plan.questions.map(asked),
		runs: plan.runs,
	};
}

/** At most what buying the counted answers costs: one call per run with its questions. */
function ceilingUsd(
	provider: RunQuestionProvider,
	plan: Plan,
	counted: ReturnType<typeof count>,
): number {
	const byId = new Map(
		plan.questions.map((question) => [question.id, question]),
	);
	return counted.runs.reduce(
		(total, run) =>
			total +
			provider.callCeilingUsd(
				run.questionIds.flatMap((id) => {
					const question = byId.get(id);
					return question ? [asked(question)] : [];
				}),
			),
		0,
	);
}

function jobRun(run: RunFacts, questionIds: string[]): JobRun {
	return {
		sessionId: run.sessionId,
		agentId: run.agentId,
		turn: run.turn,
		revision: run.revision,
		ownerId: run.ownerId,
		questionIds,
	};
}

function sum<T extends string>(
	items: readonly Record<T, number>[],
	key: T,
): number {
	return items.reduce((total, item) => total + item[key], 0);
}

function fatal(message: string): { ok: false; error: SqlFailure } {
	return {
		ok: false,
		error: {
			kind: "fatal",
			message,
			fragment: null,
			fix: "Do not retry; answer with sql and read.",
		},
	};
}
