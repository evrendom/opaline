import { randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { answerKey, type RunVersion } from "./answers.js";
import { readInternalRunQuestionWorkspaces } from "./provider.js";

/**
 * Answering work in Postgres (`run_question_job`), claimed by the
 * run-questions cron with a lease and retried with capped backoff, and the
 * per-workspace answer quota (`run_question_quota`). A job names its runs and
 * their owners, so the account and workspace purges can delete it.
 */

export interface JobRun extends RunVersion {
	/** The member whose session the run is. */
	readonly ownerId: string;
	/** The questions to answer about this run. */
	readonly questionIds: readonly string[];
}

export interface RunQuestionJob {
	readonly id: string;
	readonly workspaceId: string;
	/** analysis: an agent bought it; test: the internal form; precompute: every new run of an enabled workspace. */
	readonly purpose: "analysis" | "test" | "precompute";
	/** The provider that answers it. */
	readonly provider: string;
	readonly questionIds: readonly string[];
	readonly runs: readonly JobRun[];
	readonly status: "queued" | "done" | "failed";
	readonly leaseToken: string | null;
	readonly attempts: number;
}

/** A job is claimed at most this many times (a crash counts), then marked failed. */
export const RUN_QUESTION_JOB_MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 3_600_000;
/** Answers a workspace may buy per window. */
export const RUN_QUESTION_ANSWER_QUOTA = {
	answers: 20_000,
	windowMs: 86_400_000,
} as const;
/** Answers one of our own workspaces may buy per window: about $50 a day at SubQ Snap's prices. */
export const INTERNAL_RUN_QUESTION_ANSWER_QUOTA = {
	answers: 120_000,
	windowMs: 86_400_000,
} as const;

/** A workspace's answer quota: `override` where one is configured (tests), else ours or the default. */
export function answerQuotaFor(
	workspaceId: string,
	override?: { answers: number; windowMs: number },
	env: NodeJS.ProcessEnv = process.env,
): { answers: number; windowMs: number } {
	if (override) return override;
	return readInternalRunQuestionWorkspaces(env)(workspaceId)
		? INTERNAL_RUN_QUESTION_ANSWER_QUOTA
		: RUN_QUESTION_ANSWER_QUOTA;
}

/**
 * Runs `work` in a transaction holding the workspace's run question lock, so
 * two callers never queue the same answer.
 */
export async function withRunQuestionLock<T>(
	sql: postgres.Sql,
	workspaceId: string,
	work: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
	return (await sql.begin(async (transaction) => {
		// postgres-js types a transaction without the tagged-template call
		// signature (`Omit<Sql, ...>`); at runtime it is one.
		const tx = transaction as unknown as postgres.Sql;
		await tx`SELECT pg_advisory_xact_lock(hashtext(${`run_questions:${workspaceId}`}))`;
		return work(tx);
	})) as T;
}

export async function enqueueRunQuestionJob(
	sql: postgres.Sql,
	job: {
		workspaceId: string;
		requestedBy: string;
		purpose: RunQuestionJob["purpose"];
		provider: string;
		/** Questions the job is about even where no run needs them (a test). */
		questionIds?: readonly string[];
		runs: readonly JobRun[];
	},
): Promise<string> {
	const id = `rqj_${randomBytes(12).toString("base64url")}`;
	await sql`
		INSERT INTO run_question_job
			(id, organization_id, requested_by, purpose, provider, question_ids, runs, owner_ids, answers_requested)
		VALUES (
			${id}, ${job.workspaceId}, ${job.requestedBy}, ${job.purpose}, ${job.provider},
			${[...new Set([...(job.questionIds ?? []), ...job.runs.flatMap((run) => run.questionIds)])].sort()},
			${JSON.stringify(job.runs)}::jsonb,
			${[...new Set(job.runs.map((run) => run.ownerId))].sort()},
			${job.runs.reduce((sum, run) => sum + run.questionIds.length, 0)}
		)
	`;
	return id;
}

/** Question and run pairs queued for the provider and not yet answered in the workspace, by `answerKey`. */
export async function queuedAnswers(
	sql: postgres.Sql,
	workspaceId: string,
	questionIds: readonly string[],
	provider: string,
): Promise<Set<string>> {
	const rows = await sql<{ runs: unknown }[]>`
		SELECT runs FROM run_question_job
		WHERE organization_id = ${workspaceId} AND status = 'queued'
			AND provider = ${provider}
			AND question_ids && ${[...questionIds]}::text[]
	`;
	const keys = new Set<string>();
	for (const row of rows)
		for (const run of JobRunsSchema.parse(row.runs))
			for (const id of run.questionIds) keys.add(answerKey(id, run));
	return keys;
}

/**
 * The oldest due job, leased to the caller; null when none is due. Each claim
 * counts an attempt, so a worker that dies mid-job (its lease expires) uses
 * one up too; a job out of attempts is marked failed instead.
 */
export async function claimRunQuestionJob(
	sql: postgres.Sql,
	leaseMs: number,
	/** Only jobs these providers answer; the others wait for a worker that has them. */
	providers: readonly string[],
): Promise<RunQuestionJob | null> {
	await sql`
		UPDATE run_question_job SET status = 'failed', finished_at = now(),
			lease_token = NULL, lease_expires_at = NULL,
			last_error = coalesce(last_error, 'Out of attempts')
		WHERE status = 'queued' AND attempt_count >= ${RUN_QUESTION_JOB_MAX_ATTEMPTS}
			AND (lease_expires_at IS NULL OR lease_expires_at <= now())
	`;
	const token = randomUUID();
	const [row] = await sql<JobRow[]>`
		UPDATE run_question_job SET
			lease_token = ${token},
			lease_expires_at = now() + ${leaseMs}::bigint * interval '1 millisecond',
			attempt_count = attempt_count + 1
		WHERE id = (
			SELECT id FROM run_question_job
			WHERE status = 'queued' AND next_attempt_at <= now()
				AND (lease_expires_at IS NULL OR lease_expires_at <= now())
				AND provider = ANY(${[...providers]}::text[])
			ORDER BY next_attempt_at, created_at
			FOR UPDATE SKIP LOCKED LIMIT 1
		)
		RETURNING id, organization_id, purpose, provider, question_ids, runs, status, lease_token, attempt_count
	`;
	return row ? toJob(row) : null;
}

/**
 * Adds one provider call's usage and cost to the job as soon as the call
 * returns, whether or not the job still holds its lease, so the provider's
 * invoices can be reconciled with what was bought.
 */
export async function recordJobUsage(
	sql: postgres.Sql,
	job: RunQuestionJob,
	call: {
		costUsd: number;
		usage: { inputTokens: number; outputTokens: number };
	},
): Promise<void> {
	await sql`
		UPDATE run_question_job SET
			cost_usd = cost_usd + ${call.costUsd},
			input_tokens = input_tokens + ${call.usage.inputTokens},
			output_tokens = output_tokens + ${call.usage.outputTokens}
		WHERE id = ${job.id}
	`;
}

/** Marks the leased job done. */
export async function finishRunQuestionJob(
	sql: postgres.Sql,
	job: RunQuestionJob,
): Promise<void> {
	await sql`
		UPDATE run_question_job SET
			status = 'done', finished_at = now(),
			lease_token = NULL, lease_expires_at = NULL, last_error = NULL
		WHERE id = ${job.id} AND lease_token = ${job.leaseToken}
	`;
}

/**
 * Hands the leased job back undone, behind the jobs already due (the pass ran
 * out of time, the workspace's quota is used up for now, or the provider is
 * rate limiting); the claim's attempt is given back.
 */
export async function releaseRunQuestionJob(
	sql: postgres.Sql,
	job: RunQuestionJob,
	delayMs = 0,
): Promise<void> {
	await sql`
		UPDATE run_question_job SET
			lease_token = NULL, lease_expires_at = NULL,
			attempt_count = attempt_count - 1,
			next_attempt_at = now() + ${delayMs}::bigint * interval '1 millisecond'
		WHERE id = ${job.id} AND lease_token = ${job.leaseToken}
	`;
}

/**
 * Schedules a retry with capped exponential backoff, no sooner than the
 * provider asked (`retryAfterMs`), or marks the job failed after the last
 * attempt, or at once when the failure is `final`.
 */
export async function failRunQuestionJob(
	sql: postgres.Sql,
	job: RunQuestionJob,
	error: unknown,
	{
		retryAfterMs = null,
		final = false,
	}: { retryAfterMs?: number | null; final?: boolean } = {},
): Promise<void> {
	// The claim counted this attempt.
	const attempts = final ? RUN_QUESTION_JOB_MAX_ATTEMPTS : job.attempts;
	const delayMs = Math.max(
		retryAfterMs ?? 0,
		Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1)),
	);
	const message = (
		error instanceof Error ? error.message : String(error)
	).slice(0, 1000);
	await sql`
		UPDATE run_question_job SET
			status = ${attempts >= RUN_QUESTION_JOB_MAX_ATTEMPTS ? "failed" : "queued"},
			finished_at = ${attempts >= RUN_QUESTION_JOB_MAX_ATTEMPTS ? sql`now()` : null},
			next_attempt_at = now() + ${delayMs}::bigint * interval '1 millisecond',
			last_error = ${message},
			lease_token = NULL, lease_expires_at = NULL
		WHERE id = ${job.id} AND lease_token = ${job.leaseToken}
	`;
}

/** The newest test of a question in the internal form, by the provider or any. */
export async function latestTestJob(
	sql: postgres.Sql,
	questionId: string,
	provider: string | null,
): Promise<RunQuestionJob | null> {
	const [row] = await sql<JobRow[]>`
		SELECT id, organization_id, purpose, provider, question_ids, runs, status, lease_token, attempt_count
		FROM run_question_job
		WHERE purpose = 'test' AND question_ids @> ${[questionId]}::text[]
			${provider === null ? sql`` : sql`AND provider = ${provider}`}
		ORDER BY created_at DESC, id LIMIT 1
	`;
	return row ? toJob(row) : null;
}

/** Answers the workspace may still buy in its current window. */
export async function remainingAnswerQuota(
	sql: postgres.Sql,
	workspaceId: string,
	limits: { answers: number; windowMs: number },
): Promise<number> {
	const [row] = await sql<{ answers: string }[]>`
		SELECT answers FROM run_question_quota
		WHERE organization_id = ${workspaceId}
			AND window_started_at > now() - ${limits.windowMs}::bigint * interval '1 millisecond'
	`;
	return Math.max(0, limits.answers - Number(row?.answers ?? 0));
}

/** Takes `answers` from the workspace's window atomically, or nothing when they do not fit; the worker takes them just before buying. */
export async function takeAnswerQuota(
	sql: postgres.Sql,
	workspaceId: string,
	answers: number,
	limits: { answers: number; windowMs: number },
): Promise<boolean> {
	const window = sql`${limits.windowMs}::bigint * interval '1 millisecond'`;
	const [row] = await sql<{ answers: string }[]>`
		INSERT INTO run_question_quota (organization_id, window_started_at, answers)
		SELECT ${workspaceId}, now(), ${answers}::bigint
		WHERE ${answers}::bigint <= ${limits.answers}::bigint
		ON CONFLICT (organization_id) DO UPDATE SET
			window_started_at = CASE
				WHEN run_question_quota.window_started_at <= now() - ${window}
				THEN now() ELSE run_question_quota.window_started_at END,
			answers = CASE
				WHEN run_question_quota.window_started_at <= now() - ${window}
				THEN EXCLUDED.answers ELSE run_question_quota.answers + EXCLUDED.answers END
		WHERE run_question_quota.window_started_at <= now() - ${window}
			OR run_question_quota.answers + EXCLUDED.answers <= ${limits.answers}::bigint
		RETURNING answers
	`;
	return row !== undefined;
}

/**
 * Deletes the target's jobs: a workspace's, or every job an account asked
 * for or that names one of its sessions. Cascades already cover deleted
 * workspaces and accounts; this covers jobs that name a deleted member's
 * sessions in a workspace that stays.
 */
export async function purgeRunQuestionJobs(
	sql: postgres.Sql,
	target: {
		targetType: "account" | "organization";
		targetId: string;
	},
): Promise<void> {
	if (target.targetType === "organization")
		await sql`DELETE FROM run_question_job WHERE organization_id = ${target.targetId}`;
	else
		await sql`
			DELETE FROM run_question_job
			WHERE requested_by = ${target.targetId} OR ${target.targetId} = ANY(owner_ids)
		`;
}

interface JobRow {
	id: string;
	organization_id: string;
	purpose: RunQuestionJob["purpose"];
	provider: string;
	question_ids: string[];
	runs: unknown;
	status: RunQuestionJob["status"];
	lease_token: string | null;
	attempt_count: number;
}

const JobRunsSchema = z.array(
	z.object({
		sessionId: z.string(),
		agentId: z.string(),
		turn: z.number(),
		revision: z.string(),
		ownerId: z.string(),
		questionIds: z.array(z.string()),
	}),
);

function toJob(row: JobRow): RunQuestionJob {
	return {
		id: row.id,
		workspaceId: row.organization_id,
		purpose: row.purpose,
		provider: row.provider,
		questionIds: row.question_ids,
		runs: JobRunsSchema.parse(row.runs),
		status: row.status,
		leaseToken: row.lease_token,
		attempts: row.attempt_count,
	};
}
