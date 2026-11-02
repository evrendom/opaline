import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import { withPostgresLease } from "./postgres-lease.service.js";
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
const LEASE_TTL_MS = 60_000;
/** Paced by ClickHouse's load, not by a rate: the lanes are the parallelism. */
const UNPACED_PER_MINUTE = 6_000;
const MAX_LOAD = 12;

export interface HistoryMaintenanceResult {
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
 * Fills in the search chunks that sessions uploaded before search was on did
 * not get, in every workspace it is on for. It selects only what is still
 * missing, newest first, so a missed, repeated or cut-off invocation loses
 * nothing and nothing is bought twice.
 */
export async function runHistoryMaintenance(options: {
	readonly budgetMs: number;
}): Promise<HistoryMaintenanceResult> {
	const search = await indexSearchHistory(
		AbortSignal.timeout(options.budgetMs),
	);
	return { search };
}

async function listWorkspaces(): Promise<string[]> {
	return (
		await sqlClient<{ id: string }[]>`SELECT id FROM organization ORDER BY id`
	).map((row) => row.id);
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
