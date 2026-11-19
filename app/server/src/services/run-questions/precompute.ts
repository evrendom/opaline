import { answerKey, type RunVersion, readAnswers, runKey } from "./answers.js";
import { listOnRunQuestions } from "./catalogue.js";
import {
	answerQuotaFor,
	enqueueRunQuestionJob,
	type JobRun,
	queuedAnswers,
	remainingAnswerQuota,
	withRunQuestionLock,
} from "./jobs.js";
import { readSessionRuns } from "./run-notes.js";
import type { RunQuestionsEnv } from "./run-questions.service.js";

/**
 * Precomputed run answers (OPL-401). Answers are facts like the others:
 * every run of a workspace whose run questions may be answered gets every
 * question that is on answered by the default provider shortly after its
 * session's run index is built, so agents filter `run_answers` with sql
 * without waiting or paying at analysis time. This only queues; the
 * run-questions cron answers (`answerQueuedQuestions`). An answer stored or
 * queued for the question, run revision and provider is never queued again,
 * so rebuilds and uploads of an unchanged transcript pay nothing, and nothing
 * is queued beyond what is left of the workspace's answer quota.
 */

export type PrecomputeEnv = Pick<
	RunQuestionsEnv,
	"executor" | "sql" | "provider" | "mayAnswer" | "answerQuota"
>;

/** A run revision with the member whose session it is. */
export interface OwnedRun extends RunVersion {
	readonly ownerId: string;
}

export type PrecomputeOutcome =
	/** Nothing is answered here: no provider, a workspace that may not have answers, or no question on. */
	| {
			readonly status: "off";
			readonly reason: "provider" | "workspace" | "questions";
	  }
	/** Every answer is stored or queued already. */
	| { readonly status: "current"; readonly runs: number }
	/** The answers needed do not fit what is left of the quota; nothing was queued. */
	| {
			readonly status: "quota";
			readonly runs: number;
			readonly answers: number;
			readonly available: number;
	  }
	| {
			readonly status: "queued";
			/** Runs with at least one answer queued. */
			readonly runs: number;
			readonly answers: number;
			readonly jobs: readonly string[];
	  };

/** Why nothing would be answered for the workspace, without reading anything; null when it would. */
export function precomputeOff(
	env: Pick<PrecomputeEnv, "provider" | "mayAnswer">,
	workspaceId: string,
): "provider" | "workspace" | null {
	if (!env.provider) return "provider";
	if (!env.mayAnswer(workspaceId)) return "workspace";
	return null;
}

/** The ids of the questions that are on, which every run is answered for. */
export async function precomputedQuestionIds(
	env: Pick<PrecomputeEnv, "sql">,
): Promise<string[]> {
	return (await listOnRunQuestions(env.sql)).map((question) => question.id);
}

/**
 * Queues the answers a session's runs lack, after its run index build
 * committed: every question that is on, about each run of the session's
 * committed build.
 */
export async function precomputeSessionAnswers(
	env: PrecomputeEnv,
	session: { organizationId: string; userId: string; sessionId: string },
): Promise<PrecomputeOutcome> {
	const off = precomputeOff(env, session.organizationId);
	if (off) return { status: "off", reason: off };
	const questionIds = await precomputedQuestionIds(env);
	if (questionIds.length === 0) return { status: "off", reason: "questions" };
	const runs = await readSessionRuns(
		env.executor,
		session.organizationId,
		[session.sessionId],
		session.userId,
	);
	return queueRunAnswers(env, session.organizationId, runs, questionIds);
}

/**
 * Queues, one job per member, the answers to `questionIds` these runs lack
 * at their revision from the default provider: neither stored nor queued.
 * Under the workspace's lock, so two callers never queue the same answer;
 * nothing is queued when the answers needed exceed the quota left after the
 * answers already queued.
 */
export async function queueRunAnswers(
	env: PrecomputeEnv,
	workspaceId: string,
	runs: readonly OwnedRun[],
	questionIds: readonly string[],
): Promise<PrecomputeOutcome> {
	const provider = env.provider;
	if (!provider) return { status: "off", reason: "provider" };
	if (!env.mayAnswer(workspaceId))
		return { status: "off", reason: "workspace" };
	if (questionIds.length === 0) return { status: "off", reason: "questions" };
	if (runs.length === 0) return { status: "current", runs: 0 };
	const stored = await readAnswers(
		env.executor,
		workspaceId,
		questionIds,
		runs,
		provider.name,
	);
	const quota = answerQuotaFor(workspaceId, env.answerQuota);
	return withRunQuestionLock(env.sql, workspaceId, async (sql) => {
		const queued = await queuedAnswers(
			sql,
			workspaceId,
			questionIds,
			provider.name,
		);
		const needed = missingAnswers(
			runs,
			questionIds,
			(key) => stored.has(key) || queued.has(key),
		);
		const answers = needed.reduce(
			(total, run) => total + run.questionIds.length,
			0,
		);
		if (answers === 0) return { status: "current", runs: runs.length };
		const available =
			(await remainingAnswerQuota(sql, workspaceId, quota)) - queued.size;
		if (answers > available)
			return {
				status: "quota",
				runs: needed.length,
				answers,
				available: Math.max(0, available),
			};
		const jobs: string[] = [];
		for (const [ownerId, owned] of byOwner(needed))
			jobs.push(
				await enqueueRunQuestionJob(sql, {
					workspaceId,
					requestedBy: ownerId,
					purpose: "precompute",
					provider: provider.name,
					runs: owned,
				}),
			);
		return { status: "queued", runs: needed.length, answers, jobs };
	});
}

/** Each run with the questions it has no answer to (stored or queued), by `answerKey`; runs answered fully are left out. */
export function missingAnswers(
	runs: readonly OwnedRun[],
	questionIds: readonly string[],
	has: (key: string) => boolean,
): JobRun[] {
	const seen = new Set<string>();
	return runs.flatMap((run) => {
		// A run listed twice is queued once.
		if (seen.has(runKey(run))) return [];
		seen.add(runKey(run));
		const missing = questionIds.filter((id) => !has(answerKey(id, run)));
		return missing.length
			? [
					{
						sessionId: run.sessionId,
						agentId: run.agentId,
						turn: run.turn,
						revision: run.revision,
						ownerId: run.ownerId,
						questionIds: missing,
					},
				]
			: [];
	});
}

function byOwner(runs: readonly JobRun[]): Map<string, JobRun[]> {
	const owners = new Map<string, JobRun[]>();
	for (const run of runs)
		owners.set(run.ownerId, [...(owners.get(run.ownerId) ?? []), run]);
	return owners;
}
