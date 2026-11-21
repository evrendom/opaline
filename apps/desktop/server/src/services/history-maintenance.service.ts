import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import {
	acquirePostgresLease,
	withPostgresLease,
} from "./postgres-lease.service.js";
import { createSearchAccess } from "./transcript-search/access.js";
import {
	readEmbeddingQuotaLimits,
	transcriptEmbedder,
} from "./transcript-search/config.js";
import { backfillTranscriptSearch } from "./transcript-search/history-backfill.service.js";
import {
	type HistoryMaintenanceResult,
	indexSearchHistory,
	SEARCH_HISTORY_LANES,
	SEARCH_HISTORY_REST_MS,
	type SearchHistoryLanes,
} from "./transcript-search/history-lanes.js";
import { createPostgresEmbeddingQuota } from "./transcript-search/quota.js";

const LEASE_TTL_MS = 60_000;
/** Paced by ClickHouse's load, not by a rate: the lanes are the parallelism. */
const UNPACED_PER_MINUTE = 6_000;
const MAX_LOAD = 12;
const REST_PREFIX = "transcript-search-history-rest:";

/**
 * Fills in the search chunks that sessions uploaded before search was on did
 * not get, in every workspace it is on for. It selects only what is still
 * missing, newest first, so a missed, repeated or cut-off invocation loses
 * nothing and nothing is bought twice.
 */
export async function runHistoryMaintenance(options: {
	readonly budgetMs: number;
}): Promise<HistoryMaintenanceResult> {
	const lanes = postgresSearchHistoryLanes(sqlClient);
	const search = lanes
		? await indexSearchHistory(AbortSignal.timeout(options.budgetMs), lanes)
		: ({ status: "off" } as const);
	return { search };
}

async function listWorkspaces(): Promise<string[]> {
	return (
		await sqlClient<{ id: string }[]>`SELECT id FROM organization ORDER BY id`
	).map((row) => row.id);
}

function postgresSearchHistoryLanes(
	database: postgres.Sql,
): SearchHistoryLanes | null {
	const embedder = transcriptEmbedder();
	if (!embedder) return null;
	const env = {
		executor: getClickhouse(),
		access: createSearchAccess(),
		quota: createPostgresEmbeddingQuota(database, readEmbeddingQuotaLimits()),
		listWorkspaces,
		assertWritable: (target: { organizationId: string; userId: string }) =>
			assertNoClickHousePurgeTombstone(target, { database }),
		embedder,
	};
	return {
		async resting() {
			const rows = await database.unsafe<Array<{ name: string }>>(
				`SELECT name FROM coordination_lease
				 WHERE name LIKE $1 AND expires_at > now()`,
				[`${REST_PREFIX}%`],
			);
			return new Set(
				rows.map((row) => Number(row.name.slice(REST_PREFIX.length))),
			);
		},
		async rest(lane) {
			await acquirePostgresLease(
				`${REST_PREFIX}${lane}`,
				randomUUID(),
				SEARCH_HISTORY_REST_MS,
				database,
			);
		},
		run: (lane, signal) =>
			withPostgresLease(
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
				{ database, ttlMs: LEASE_TTL_MS },
			),
	};
}
