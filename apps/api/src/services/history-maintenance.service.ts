import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import { withPostgresLease } from "./postgres-lease.service.js";
import { runQuestionsEnv } from "./run-questions/env.js";
import {
	backfillRunQuestions,
	type RunQuestionsBackfillExecuted,
} from "./run-questions/history-backfill.service.js";
import {
	createSearchAccess,
	postgresSubscriptions,
} from "./transcript-search/access.js";
import {
	readEmbeddingQuotaLimits,
	transcriptEmbedder,
} from "./transcript-search/config.js";
import {
	backfillTranscriptSearch,
	type TranscriptSearchBackfillExecuted,
} from "./transcript-search/history-backfill.service.js";
import { createPostgresEmbeddingQuota } from "./transcript-search/quota.js";

/**
 * Search lanes: sessions split by a hash of their id. Each lane is held by one
 * invocation at a time, so lanes run side by side and never take the same
 * session.
 */
export const SEARCH_HISTORY_LANES = 8;
/** Run questions are queued for the runs of the last this many days. */
export const RUN_QUESTION_HISTORY_DAYS = 60;
/** Of an invocation, the most spent queuing run questions; search gets the rest. */
const RUN_QUESTION_QUEUE_MS = 45_000;
const LEASE_TTL_MS = 60_000;
/** Paced by ClickHouse's load, not by a rate: the lanes are the parallelism. */
const UNPACED_PER_MINUTE = 6_000;
const MAX_LOAD = 12;

export interface HistoryMaintenanceResult {
	readonly runQuestions:
		| { readonly status: "busy" | "off" }
		| ({ readonly status: "queued" } & Pick<
				RunQuestionsBackfillExecuted,
				"runsQueued" | "answersQueued" | "hasMore" | "stopped" | "message"
		  >);
	readonly search:
		| { readonly status: "busy" | "off" }
		| ({ readonly status: "indexed"; readonly lane: number } & Pick<
				TranscriptSearchBackfillExecuted,
				| "indexed"
				| "incomplete"
				| "failed"
				| "embeddedChunks"
				| "costUsd"
				| "hasMore"
				| "stopped"
				| "message"
		  >);
}

/**
 * Fills in what sessions uploaded before a feature was on did not get, in
 * every workspace the feature is on for: run question answers (queued here,
 * answered by the run-questions cron) and search chunks. Both select only
 * what is still missing, newest first, so a missed, repeated or cut-off
 * invocation loses nothing and nothing is bought twice.
 */
export async function runHistoryMaintenance(options: {
	readonly budgetMs: number;
}): Promise<HistoryMaintenanceResult> {
	const deadline = AbortSignal.timeout(options.budgetMs);
	const runQuestions = await queueRunQuestionHistory(
		AbortSignal.any([deadline, AbortSignal.timeout(RUN_QUESTION_QUEUE_MS)]),
	);
	const search = await indexSearchHistory(deadline);
	return { runQuestions, search };
}

async function listWorkspaces(): Promise<string[]> {
	return (
		await sqlClient<{ id: string }[]>`SELECT id FROM organization ORDER BY id`
	).map((row) => row.id);
}

async function queueRunQuestionHistory(
	signal: AbortSignal,
): Promise<HistoryMaintenanceResult["runQuestions"]> {
	const answering = runQuestionsEnv();
	if (!answering.provider) return { status: "off" };
	const outcome = await withPostgresLease(
		"run-questions-history",
		(lease) =>
			backfillRunQuestions(
				{
					executor: answering.executor,
					sql: sqlClient,
					provider: answering.provider,
					mayAnswer: answering.mayAnswer,
					listWorkspaces,
					// Queued only: the run-questions cron answers them.
					answer: async () => ({
						jobs: 0,
						answers: 0,
						costUsd: 0,
						refused: [],
					}),
				},
				{
					organizationId: undefined,
					days: RUN_QUESTION_HISTORY_DAYS,
					maxRuns: 100_000,
					after: undefined,
					runsPerMinute: UNPACED_PER_MINUTE,
					maxLoad: MAX_LOAD,
					unansweredOnly: true,
					signal: AbortSignal.any([signal, lease.signal]),
				},
			),
		{ database: sqlClient, ttlMs: LEASE_TTL_MS },
	);
	if (outcome.status === "busy") return { status: "busy" };
	const { runsQueued, answersQueued, hasMore, stopped, message } =
		outcome.result;
	return {
		status: "queued",
		runsQueued,
		answersQueued,
		hasMore,
		stopped,
		message,
	};
}

async function indexSearchHistory(
	signal: AbortSignal,
): Promise<HistoryMaintenanceResult["search"]> {
	const embedder = transcriptEmbedder();
	if (!embedder) return { status: "off" };
	const env = {
		executor: getClickhouse(),
		access: createSearchAccess(postgresSubscriptions(sqlClient)),
		quota: createPostgresEmbeddingQuota(sqlClient, readEmbeddingQuotaLimits()),
		listWorkspaces,
		assertWritable: (target: { organizationId: string; userId: string }) =>
			assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
		embedder,
	};
	// A random first lane, so overlapping invocations spread over the lanes.
	const first = Math.floor(Math.random() * SEARCH_HISTORY_LANES);
	for (let step = 0; step < SEARCH_HISTORY_LANES; step++) {
		if (signal.aborted) break;
		const lane = (first + step) % SEARCH_HISTORY_LANES;
		const outcome = await withPostgresLease(
			`transcript-search-history:${lane}`,
			(lease) =>
				backfillTranscriptSearch(env, {
					organizationId: undefined,
					maxSessions: 1_000,
					after: undefined,
					sessionsPerMinute: UNPACED_PER_MINUTE,
					maxLoad: MAX_LOAD,
					signal: AbortSignal.any([signal, lease.signal]),
					shard: { index: lane, count: SEARCH_HISTORY_LANES },
				}),
			{ database: sqlClient, ttlMs: LEASE_TTL_MS },
		);
		if (outcome.status === "busy") continue;
		const {
			indexed,
			incomplete,
			failed,
			embeddedChunks,
			costUsd,
			hasMore,
			stopped,
			message,
		} = outcome.result;
		return {
			status: "indexed",
			lane,
			indexed,
			incomplete,
			failed,
			embeddedChunks,
			costUsd,
			hasMore,
			stopped,
			message,
		};
	}
	return { status: "busy" };
}
