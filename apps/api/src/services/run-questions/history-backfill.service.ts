import { Buffer } from "node:buffer";
import type { RunQuestion } from "@rudel/api-routes";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import { committedRunsSql, SQL_SCOPE_PARAMS } from "../analysis/sql-views.js";
import {
	type BackfillClock,
	REAL_BACKFILL_CLOCK,
	readClickHouseLoadAverage,
} from "../backfill-pacing.js";
import { answerKey, readAnswers } from "./answers.js";
import { listRunQuestions } from "./catalogue.js";
import { answerQuotaFor, queuedAnswers, remainingAnswerQuota } from "./jobs.js";
import {
	missingAnswers,
	type OwnedRun,
	type PrecomputeEnv,
	queueRunAnswers,
} from "./precompute.js";
import type { answerQueuedQuestions } from "./run-questions.service.js";

/**
 * The history backfill behind `backfill:run-questions` (OPL-401): answers
 * the runs indexed before answers were precomputed, through the same path a
 * new run takes (`queueRunAnswers`, then the cron's `answerQueuedQuestions`),
 * for every question that is on, only in workspaces whose run questions may
 * be answered.
 *
 * - Preview by default: it reads ClickHouse and Postgres and reports the
 *   runs, the answers they lack, and the estimated input tokens and cost at
 *   the provider's prices; nothing is queued or sent.
 * - Selection: committed runs that started in the last `days` days, newest
 *   first per workspace (workspaces by id), at most `maxRuns`, after `after`.
 *   Runs answered already at their revision are counted, never queued.
 * - Paced: at most `runsPerMinute` runs queued a minute, none while
 *   ClickHouse's `LoadAverage1` is above `maxLoad`; each batch is answered
 *   before the next is queued.
 * - Stops cleanly, with `next` naming where to continue, when a workspace's
 *   answer quota cannot take a batch, when the provider refuses for good
 *   (no credits, HTTP 402), or when the run is interrupted.
 */

/** Runs queued (and answered) together, at most. */
const MAX_BATCH_RUNS = 25;
/** How long a run waits before reading ClickHouse's load again. */
const LOAD_RECHECK_MS = 30_000;
/** Runs per statement reading stored answers in the preview. */
const ESTIMATE_BATCH = 500;

const SELECTION_SETTINGS = {
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

export interface RunQuestionsBackfillCursor {
	readonly organizationId: string;
	/** The run's `started_at` as ClickHouse prints it. */
	readonly startedAt: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

export interface RunQuestionsBackfillOptions {
	/** One workspace; undefined means every workspace that may have answers. */
	readonly organizationId: string | undefined;
	/** Runs that started in the last this many days. */
	readonly days: number;
	readonly maxRuns: number;
	readonly after: RunQuestionsBackfillCursor | undefined;
	readonly runsPerMinute: number;
	readonly maxLoad: number;
	/** Stops the run before its next batch. */
	readonly signal?: AbortSignal;
}

export interface RunQuestionsBackfillEnv extends PrecomputeEnv {
	/** Every workspace, for a run over all of them. */
	readonly listWorkspaces: () => Promise<readonly string[]>;
	readonly clock?: BackfillClock;
	/** Progress lines (stderr in the script). */
	readonly log?: (line: string) => void;
}

export interface RunQuestionsBackfillExecuteEnv
	extends RunQuestionsBackfillEnv {
	/** One answering pass over the queued jobs, as the cron runs it. */
	readonly answer: () => ReturnType<typeof answerQueuedQuestions>;
}

interface Summary {
	organizationId: string | null;
	provider: string | null;
	/** The questions that are on, which every run is answered for. */
	questions: number;
	days: number;
	/** Workspaces in scope whose run questions may not be answered. */
	workspacesNotAnswered: number;
	/** Runs the selection found. */
	runs: number;
	message: string | null;
	/** More runs remain: continue with `--after next`. */
	hasMore: boolean;
	next: string | null;
}

export interface RunQuestionsWorkspaceEstimate {
	organizationId: string;
	runs: number;
	/** Runs with at least one answer neither stored nor queued. */
	runsToAnswer: number;
	answers: number;
	estimatedInputTokens: number;
	estimatedCostUsd: number;
	quotaRemaining: number;
	/** The answers fit what is left of the workspace's quota. */
	fitsQuota: boolean;
}

export interface RunQuestionsBackfillPreview extends Summary {
	status: "preview";
	runsToAnswer: number;
	answers: number;
	/** At most the run's text (capped at what the provider reads) and the questions: an upper bound. */
	estimatedInputTokens: number;
	estimatedCostUsd: number;
	workspaces: RunQuestionsWorkspaceEstimate[];
}

export interface RunQuestionsBackfillExecuted extends Summary {
	status: "executed";
	/** Runs with answers queued by this run. */
	runsQueued: number;
	answersQueued: number;
	/** Runs answered (or queued) already. */
	alreadyAnswered: number;
	/** Jobs the answering passes worked on (theirs and any other due job). */
	jobs: number;
	answersBought: number;
	costUsd: number;
	loadPausedSeconds: number;
	stopped: "quota" | "provider" | "interrupted" | null;
}

interface SelectedRun extends OwnedRun {
	readonly workspaceId: string;
	readonly startedAt: string;
	readonly rawChars: number;
}

const RunRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	user_id: z.string(),
	revision: z.string(),
	started_text: z.string(),
	raw_chars: z.coerce.number(),
});

/**
 * The committed runs of one workspace that started in the last `days` days,
 * newest first, after `after`.
 */
export function buildRunQuestionsBackfillStatement(input: {
	readonly organizationId: string;
	readonly days: number;
	readonly after: RunQuestionsBackfillCursor | undefined;
	readonly limit: number;
}): ClickHouseStatement {
	const after =
		input.after === undefined
			? ""
			: `AND (started_at, session_id, agent_id, turn_idx)
				< ({afterStartedAt:DateTime64(3, 'UTC')}, {afterSessionId:String}, {afterAgentId:String}, {afterTurn:UInt32})`;
	return {
		clickhouse_settings: {
			...SELECTION_SETTINGS,
			max_result_rows: String(input.limit),
		},
		query: `SELECT session_id, agent_id, turn_idx, user_id, revision, toString(started_at) AS started_text, raw_chars
			FROM (${committedRunsSql(false, [
				"session_id",
				"agent_id",
				"turn_idx",
				"user_id",
				"toString(revision) AS revision",
				"started_at",
				"raw_chars",
			])})
			WHERE started_at >= now64(3) - toIntervalDay({days:UInt32})
				${after}
			ORDER BY started_at DESC, session_id DESC, agent_id DESC, turn_idx DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			[SQL_SCOPE_PARAMS.workspace]: input.organizationId,
			days: input.days,
			limit: input.limit,
			afterStartedAt: input.after?.startedAt ?? "1970-01-01 00:00:00.000",
			afterSessionId: input.after?.sessionId ?? "",
			afterAgentId: input.after?.agentId ?? "",
			afterTurn: input.after?.turn ?? 0,
		},
	};
}

/** Reads what a run would answer and what it would cost; never queues or sends anything. */
export async function previewRunQuestionsBackfill(
	env: RunQuestionsBackfillEnv,
	options: RunQuestionsBackfillOptions,
): Promise<RunQuestionsBackfillPreview> {
	const selection = await select(env, options);
	const provider = env.provider;
	const byId = new Map(selection.questions.map((q) => [q.id, q]));
	const ids = [...byId.keys()];
	const workspaces: RunQuestionsWorkspaceEstimate[] = [];
	for (const [workspaceId, runs] of byWorkspace(selection.rows)) {
		const estimate: RunQuestionsWorkspaceEstimate = {
			organizationId: workspaceId,
			runs: runs.length,
			runsToAnswer: 0,
			answers: 0,
			estimatedInputTokens: 0,
			estimatedCostUsd: 0,
			quotaRemaining: await remainingAnswerQuota(
				env.sql,
				workspaceId,
				answerQuotaFor(workspaceId, env.answerQuota),
			),
			fitsQuota: true,
		};
		if (provider && ids.length > 0) {
			const queued = await queuedAnswers(
				env.sql,
				workspaceId,
				ids,
				provider.name,
			);
			for (let start = 0; start < runs.length; start += ESTIMATE_BATCH) {
				const batch = runs.slice(start, start + ESTIMATE_BATCH);
				const stored = await readAnswers(
					env.executor,
					workspaceId,
					ids,
					batch,
					provider.name,
				);
				const chars = new Map(
					batch.map((run) => [answerKey("", run), run.rawChars]),
				);
				for (const run of missingAnswers(
					batch,
					ids,
					(key) => stored.has(key) || queued.has(key),
				)) {
					const call = provider.estimateCall(
						run.questionIds.flatMap((id) => {
							const question = byId.get(id);
							return question ? [question] : [];
						}),
						chars.get(answerKey("", run)) ?? provider.stateMaxChars,
					);
					estimate.runsToAnswer++;
					estimate.answers += run.questionIds.length;
					estimate.estimatedInputTokens += call.inputTokens;
					estimate.estimatedCostUsd += call.costUsd;
				}
			}
			estimate.quotaRemaining = Math.max(
				0,
				estimate.quotaRemaining - queued.size,
			);
		}
		estimate.estimatedCostUsd = dollars(estimate.estimatedCostUsd);
		estimate.fitsQuota = estimate.answers <= estimate.quotaRemaining;
		workspaces.push(estimate);
	}
	const total = (key: "runsToAnswer" | "answers" | "estimatedInputTokens") =>
		workspaces.reduce((sum, workspace) => sum + workspace[key], 0);
	return {
		status: "preview",
		...selection.summary,
		runsToAnswer: total("runsToAnswer"),
		answers: total("answers"),
		estimatedInputTokens: total("estimatedInputTokens"),
		estimatedCostUsd: dollars(
			workspaces.reduce(
				(sum, workspace) => sum + workspace.estimatedCostUsd,
				0,
			),
		),
		workspaces,
	};
}

/**
 * Queues the selected runs' missing answers batch by batch, newest first,
 * paced, and answers each batch before the next; stops at the first
 * workspace out of quota, a provider that refuses for good, or when
 * `signal` aborts.
 */
export async function backfillRunQuestions(
	env: RunQuestionsBackfillExecuteEnv,
	options: RunQuestionsBackfillOptions,
): Promise<RunQuestionsBackfillExecuted> {
	const selection = await select(env, options);
	const clock = env.clock ?? REAL_BACKFILL_CLOCK;
	const log = env.log ?? (() => {});
	const result: RunQuestionsBackfillExecuted = {
		status: "executed",
		...selection.summary,
		runsQueued: 0,
		answersQueued: 0,
		alreadyAnswered: 0,
		jobs: 0,
		answersBought: 0,
		costUsd: 0,
		loadPausedSeconds: 0,
		stopped: null,
	};
	const ids = selection.questions.map((question) => question.id);
	const intervalMs = 60_000 / options.runsPerMinute;
	const batchRuns = Math.min(MAX_BATCH_RUNS, options.runsPerMinute);
	let nextStartAt: number | null = null;
	/** Waits for the rate and for ClickHouse's load; false when interrupted. */
	const pace = async (runs: number): Promise<boolean> => {
		if (nextStartAt !== null) {
			const wait = nextStartAt - clock.now();
			if (wait > 0) await clock.sleep(wait, options.signal);
		}
		for (;;) {
			if (options.signal?.aborted) return false;
			const load = await readClickHouseLoadAverage(env.executor);
			if (load <= options.maxLoad) break;
			log(
				`ClickHouse LoadAverage1 is ${load}, above ${options.maxLoad}: pausing ${LOAD_RECHECK_MS / 1_000}s`,
			);
			const pausedAt = clock.now();
			await clock.sleep(LOAD_RECHECK_MS, options.signal);
			result.loadPausedSeconds += (clock.now() - pausedAt) / 1_000;
		}
		nextStartAt = clock.now() + runs * intervalMs;
		return true;
	};

	let done: RunQuestionsBackfillCursor | undefined = options.after;
	batches: for (const [workspaceId, runs] of byWorkspace(selection.rows))
		for (let start = 0; start < runs.length; start += batchRuns) {
			const batch = runs.slice(start, start + batchRuns);
			if (!(await pace(batch.length))) {
				result.stopped = "interrupted";
				break batches;
			}
			const queued = await queueRunAnswers(env, workspaceId, batch, ids);
			if (queued.status === "quota") {
				result.stopped = "quota";
				result.message = `Stopped: workspace ${workspaceId} has ${queued.available} answers left in its quota (${answerQuotaFor(workspaceId, env.answerQuota).answers} per ${answerQuotaFor(workspaceId, env.answerQuota).windowMs / 3_600_000} hours, less the answers queued), fewer than the ${queued.answers} the next ${queued.runs} runs need.`;
				break batches;
			}
			if (queued.status === "off") {
				result.message = `Nothing is answered: ${offReason(queued.reason)}`;
				break batches;
			}
			if (queued.status === "queued") {
				result.runsQueued += queued.runs;
				result.answersQueued += queued.answers;
				result.alreadyAnswered += batch.length - queued.runs;
			} else result.alreadyAnswered += batch.length;
			// Answered before the next batch is queued, so the pace bounds the calls too.
			for (;;) {
				const pass = await env.answer();
				result.jobs += pass.jobs;
				result.answersBought += pass.answers;
				result.costUsd += pass.costUsd;
				const refused = pass.refused[0];
				if (refused) {
					result.stopped = "provider";
					result.message = `Stopped: ${refused.error}`;
					// This batch's jobs failed: continuing asks it again.
					break batches;
				}
				if (pass.jobs === 0 || options.signal?.aborted) break;
			}
			const last = batch.at(-1);
			if (last) done = cursorOf(last);
			log(
				`${result.runsQueued + result.alreadyAnswered}/${selection.rows.length} runs, ${result.answersBought} answers, $${dollars(result.costUsd)}`,
			);
		}

	result.costUsd = dollars(result.costUsd);
	if (result.stopped !== null) {
		result.hasMore = true;
		if (result.stopped === "interrupted")
			result.message = "Interrupted: the run stopped before its next batch.";
	}
	result.next =
		result.hasMore && done ? encodeRunQuestionsBackfillCursor(done) : null;
	if (result.stopped !== null)
		result.message = `${result.message ?? ""} ${
			result.next
				? `Continue with --after ${result.next}.`
				: "Continue by running it again without --after."
		}`.trim();
	return result;
}

async function select(
	env: RunQuestionsBackfillEnv,
	options: RunQuestionsBackfillOptions,
): Promise<{
	rows: SelectedRun[];
	questions: RunQuestion[];
	summary: Omit<Summary, "next"> & { next: null };
}> {
	if (
		options.after !== undefined &&
		options.organizationId !== undefined &&
		options.after.organizationId !== options.organizationId
	)
		throw new Error("--after must name a run of --organization-id");
	const questions = (await listRunQuestions(env.sql)).filter(
		(question) => question.state === "on",
	);
	const inScope =
		options.organizationId === undefined
			? [...(await env.listWorkspaces())].sort()
			: [options.organizationId];
	const answered = inScope.filter((id) => env.mayAnswer(id));
	const summary = {
		organizationId: options.organizationId ?? null,
		provider: env.provider?.name ?? null,
		questions: questions.length,
		days: options.days,
		workspacesNotAnswered: inScope.length - answered.length,
		runs: 0,
		message: null as string | null,
		hasMore: false,
		next: null,
	};
	const message = !env.provider
		? `No run question provider is configured (RUN_QUESTIONS_PROVIDER and its key): ${offReason("provider")}`
		: questions.length === 0
			? `No run question is on: ${offReason("questions")}`
			: answered.length === 0
				? `${offReason("workspace")}`
				: null;
	if (message) return { rows: [], questions, summary: { ...summary, message } };
	const rows: SelectedRun[] = [];
	// Workspaces by id; a cursor continues inside its workspace.
	const from = options.after?.organizationId;
	for (const workspaceId of answered) {
		if (from !== undefined && workspaceId < from) continue;
		const remaining = options.maxRuns - rows.length;
		if (remaining <= 0) {
			summary.hasMore = true;
			break;
		}
		const found = z.array(RunRowSchema).parse(
			await env.executor.query<unknown>(
				buildRunQuestionsBackfillStatement({
					organizationId: workspaceId,
					days: options.days,
					after: workspaceId === from ? options.after : undefined,
					limit: remaining + 1,
				}),
			),
		);
		if (found.length > remaining) summary.hasMore = true;
		rows.push(
			...found.slice(0, remaining).map((row) => ({
				workspaceId,
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
				revision: row.revision,
				ownerId: row.user_id,
				startedAt: row.started_text,
				rawChars: row.raw_chars,
			})),
		);
	}
	summary.runs = rows.length;
	return { rows, questions, summary };
}

function offReason(reason: "provider" | "workspace" | "questions"): string {
	switch (reason) {
		case "provider":
			return "without a provider nothing is answered or sent anywhere.";
		case "questions":
			return "turn questions on in /admin/run-questions (or add them with run-questions:add --on).";
		case "workspace":
			return "no workspace in scope may have run questions answered (VITE_ADMIN_ORGANIZATION_ID, RUN_QUESTIONS_INTERNAL_WORKSPACES, RUN_QUESTIONS_CUSTOMER_WORKSPACES).";
	}
}

function byWorkspace(rows: readonly SelectedRun[]): Map<string, SelectedRun[]> {
	const workspaces = new Map<string, SelectedRun[]>();
	for (const row of rows)
		workspaces.set(row.workspaceId, [
			...(workspaces.get(row.workspaceId) ?? []),
			row,
		]);
	return workspaces;
}

/** Dollars, to a hundredth of a cent. */
function dollars(usd: number): number {
	return Math.round(usd * 10_000) / 10_000;
}

function cursorOf(run: SelectedRun): RunQuestionsBackfillCursor {
	return {
		organizationId: run.workspaceId,
		startedAt: run.startedAt,
		sessionId: run.sessionId,
		agentId: run.agentId,
		turn: run.turn,
	};
}

/** An opaque `--after` value: the last run a run went through. */
export function encodeRunQuestionsBackfillCursor(
	cursor: RunQuestionsBackfillCursor,
): string {
	return Buffer.from(
		JSON.stringify([
			cursor.organizationId,
			cursor.startedAt,
			cursor.sessionId,
			cursor.agentId,
			cursor.turn,
		]),
	).toString("base64url");
}

export function decodeRunQuestionsBackfillCursor(
	value: string,
): RunQuestionsBackfillCursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		parsed = undefined;
	}
	const tuple = z
		.tuple([
			z.string().min(1),
			z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/u),
			z.string().min(1),
			z.string(),
			z.number().int().nonnegative(),
		])
		.safeParse(parsed);
	if (!tuple.success)
		throw new Error("--after must be the `next` value a previous run printed.");
	const [organizationId, startedAt, sessionId, agentId, turn] = tuple.data;
	return { organizationId, startedAt, sessionId, agentId, turn };
}
