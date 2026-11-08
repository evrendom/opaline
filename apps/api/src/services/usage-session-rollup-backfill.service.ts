import { getLogger } from "@logtape/logtape";
import { USAGE_SESSION_ROLLUPS_TABLE } from "@rudel/ch-schema/usage-session-rollups";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { readUsageRollupBackfillSkippedOrgIds } from "../lib/env.js";
import { query } from "./analysis/sql.js";
import {
	clickHousePurgeTargetKey,
	findClickHousePurgeTombstones,
} from "./clickhouse-purge-tombstone.service.js";
import {
	backOffUsageSessionRollups,
	refreshUsageSessionRollups,
	USAGE_ROLLUP_BUILD_VERSION,
	type UsageRollupSessionKey,
} from "./usage-session-rollup.service.js";

export const USAGE_ROLLUP_BACKFILL_LIMIT = 300;
export const USAGE_ROLLUP_BACKFILL_BATCH = 25;
export const USAGE_ROLLUP_BACKFILL_BUDGET_MS = 15_000;
export const USAGE_ROLLUP_CANDIDATES_MAX_EXECUTION_SECONDS = 5;
export const USAGE_ROLLUP_INSERT_MAX_EXECUTION_SECONDS = 10;
export const USAGE_ROLLUP_BACKOFF_MAX_EXECUTION_SECONDS = 5;
const RECENT_DAYS = 30;
const SETTLE_MINUTES = 10;
const INCONSISTENT_RECHECK_MINUTES = 60;
const SESSION_ANALYTICS_TABLE = "rudel.session_analytics";
const logger = getLogger(["rudel", "api", "usage-session-rollups"]);

const CandidateSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
});

export function buildUsageRollupCandidatesStatement(input: {
	readonly limit: number;
	readonly skippedOrganizationIds: readonly string[];
}): ClickHouseStatement {
	const sessions = getSafeClickHouseTable(SESSION_ANALYTICS_TABLE);
	const rollups = getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE);
	return {
		clickhouse_settings: {
			join_use_nulls: 0,
			max_execution_time: USAGE_ROLLUP_CANDIDATES_MAX_EXECUTION_SECONDS,
		},
		query: `SELECT sa.organization_id AS organization_id, sa.user_id AS user_id,
				sa.source AS source, sa.session_id AS session_id
			FROM (
				SELECT organization_id, user_id, toString(source) AS source, session_id,
					max(ingested_at) AS ingested_at, max(session_date) AS session_date
				FROM ${sessions}
				WHERE organization_id NOT IN {skipped:Array(String)}
				GROUP BY organization_id, user_id, source, session_id
			) AS sa
			LEFT ANY JOIN (
				SELECT organization_id, user_id, toString(source) AS source, session_id,
					is_consistent, build_version, built_at, retry_after
				FROM ${rollups} FINAL
				WHERE organization_id NOT IN {skipped:Array(String)}
			) AS r
				ON r.organization_id = sa.organization_id
				AND r.user_id = sa.user_id
				AND r.source = sa.source
				AND r.session_id = sa.session_id
			WHERE r.retry_after <= now64(3)
				AND (
					r.build_version != {buildVersion:UInt32}
					OR r.built_at < sa.ingested_at
					OR (r.built_at < sa.ingested_at + INTERVAL ${SETTLE_MINUTES} MINUTE
						AND r.built_at < now64(3) - INTERVAL ${SETTLE_MINUTES} MINUTE)
					OR (r.is_consistent = 0
						AND r.built_at < now64(3) - INTERVAL ${INCONSISTENT_RECHECK_MINUTES} MINUTE)
				)
			ORDER BY (r.session_id != '' AND r.built_at < sa.ingested_at) DESC,
				sa.session_date >= now() - INTERVAL ${RECENT_DAYS} DAY DESC,
				cityHash64(sa.organization_id, sa.user_id, toStartOfHour(now())),
				sa.source, sa.session_id
			LIMIT {limit:UInt32}`,
		query_params: {
			buildVersion: USAGE_ROLLUP_BUILD_VERSION,
			limit: input.limit,
			skipped: [...input.skippedOrganizationIds],
		},
	};
}

export interface UsageRollupBackfillResult {
	readonly candidates: number;
	readonly failed: number;
	readonly fenced: number;
	readonly written: number;
}

export async function backfillUsageSessionRollups(input: {
	readonly backOff?: typeof backOffUsageSessionRollups;
	readonly batchSize?: number;
	readonly budgetMs?: number;
	readonly executor: ClickHouseExecutor;
	readonly limit?: number;
	readonly now?: () => number;
	readonly refresh?: typeof refreshUsageSessionRollups;
	readonly skippedOrganizationIds?: readonly string[];
	readonly sql: postgres.Sql;
}): Promise<UsageRollupBackfillResult> {
	const now = input.now ?? Date.now;
	const deadline = now() + (input.budgetMs ?? USAGE_ROLLUP_BACKFILL_BUDGET_MS);
	const refresh = input.refresh ?? refreshUsageSessionRollups;
	const backOff = input.backOff ?? backOffUsageSessionRollups;
	const batchSize = input.batchSize ?? USAGE_ROLLUP_BACKFILL_BATCH;
	const env = { database: input.sql };
	const candidates = (
		await query(
			input.executor,
			CandidateSchema,
			buildUsageRollupCandidatesStatement({
				limit: input.limit ?? USAGE_ROLLUP_BACKFILL_LIMIT,
				skippedOrganizationIds:
					input.skippedOrganizationIds ??
					readUsageRollupBackfillSkippedOrgIds(),
			}),
		)
	).map(
		(candidate): UsageRollupSessionKey => ({
			organizationId: candidate.organization_id,
			sessionId: candidate.session_id,
			source: candidate.source,
			userId: candidate.user_id,
		}),
	);
	const purged = await findClickHousePurgeTombstones(candidates, env);
	const writable = candidates.filter(
		(session) => !purged.has(clickHousePurgeTargetKey(session)),
	);
	let fenced = candidates.length - writable.length;
	let written = 0;
	const failed: UsageRollupSessionKey[] = [];
	const insert = (sessions: readonly UsageRollupSessionKey[]) =>
		refresh(input.executor, sessions, {
			maxExecutionSeconds: USAGE_ROLLUP_INSERT_MAX_EXECUTION_SECONDS,
		});
	for (let start = 0; start < writable.length; start += batchSize) {
		if (now() >= deadline) break;
		const members = writable.slice(start, start + batchSize);
		const fencedNow = await findClickHousePurgeTombstones(members, env);
		const batch = members.filter(
			(session) => !fencedNow.has(clickHousePurgeTargetKey(session)),
		);
		fenced += members.length - batch.length;
		if (batch.length === 0) continue;
		try {
			await insert(batch);
			written += batch.length;
			continue;
		} catch (error) {
			logger.warn(
				"Usage rollup backfill of {count} sessions failed, retrying them one by one: {error}",
				{ count: batch.length, error: describe(error) },
			);
		}
		for (const session of batch) {
			if (now() >= deadline) break;
			try {
				await insert([session]);
				written++;
			} catch (error) {
				failed.push(session);
				logger.warn(
					"Usage rollup backfill of session {session} failed; retrying after the back-off: {error}",
					{ error: describe(error), session: session.sessionId },
				);
			}
		}
	}
	if (failed.length > 0)
		await backOff(input.executor, failed, {
			maxExecutionSeconds: USAGE_ROLLUP_BACKOFF_MAX_EXECUTION_SECONDS,
		}).catch((error: unknown) => {
			logger.warn("Usage rollup back-off of {count} sessions failed: {error}", {
				count: failed.length,
				error: describe(error),
			});
		});
	return {
		candidates: candidates.length,
		failed: failed.length,
		fenced,
		written,
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
