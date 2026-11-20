import { getLogger } from "@logtape/logtape";
import { CONTEXT_SNAPSHOT_VERSION } from "@rudel/api-routes/session-context/session-context-snapshot";
import { SESSION_CONTEXT_SNAPSHOTS_TABLE } from "@rudel/ch-schema/session-context-snapshots";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { RUN_INDEX_VERSION } from "./analysis/run-index-sql.js";
import { query } from "./analysis/sql.js";
import {
	assertNoClickHousePurgeTombstone,
	hasClickHousePurgeTombstone,
} from "./clickhouse-purge-tombstone.service.js";
import { RUN_INDEX_TABLE } from "./l1-edges/l1-edge-tables.js";
import { writeSessionContextSnapshot } from "./session-context-snapshot.service.js";

export const CONTEXT_SNAPSHOT_BACKFILL_LIMIT = 40;
export const CONTEXT_SNAPSHOT_BACKFILL_BUDGET_MS = 15_000;
const RECENT_DAYS = 30;
const logger = getLogger(["rudel", "api", "context-snapshots"]);

const CandidateSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	session_id: z.string(),
});

export function readContextSnapshotBackfillSkippedOrgIds(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
	return [
		...new Set(
			(environment.CONTEXT_SNAPSHOT_BACKFILL_SKIP_ORG_IDS ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];
}

export function buildContextSnapshotCandidatesStatement(input: {
	skippedOrganizationIds: readonly string[];
	limit: number;
}) {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const snapshots = getSafeClickHouseTable(SESSION_CONTEXT_SNAPSHOTS_TABLE);
	return {
		query: `SELECT r.organization_id, r.user_id, r.session_id
			FROM (
				SELECT organization_id, user_id, session_id, max(started_at) AS started
				FROM ${runIndex}
				WHERE row_kind = 'run' AND organization_id NOT IN {skipped:Array(String)}
				GROUP BY organization_id, user_id, session_id
			) AS r
			LEFT ANTI JOIN (
				SELECT organization_id, user_id, session_id
				FROM ${snapshots} FINAL
				WHERE index_version >= {indexVersion:UInt16}
					AND startsWith(snapshot, {shape:String})
			) AS s
				ON s.organization_id = r.organization_id
				AND s.user_id = r.user_id
				AND s.session_id = r.session_id
			ORDER BY r.started >= now() - INTERVAL ${RECENT_DAYS} DAY DESC,
				cityHash64(r.organization_id, r.user_id, r.session_id, toStartOfHour(now()))
			LIMIT {limit:UInt32}`,
		query_params: {
			skipped: [...input.skippedOrganizationIds],
			limit: input.limit,
			indexVersion: RUN_INDEX_VERSION,
			// A snapshot of an older shape is rebuilt; the version is the JSON's
			// first field (no column carries it).
			shape: `{"version":${CONTEXT_SNAPSHOT_VERSION},`,
		},
	};
}

export async function backfillContextSnapshots(input: {
	executor: ClickHouseExecutor;
	sql: postgres.Sql;
	budgetMs?: number;
	limit?: number;
	skippedOrganizationIds?: readonly string[];
	now?: () => number;
	write?: typeof writeSessionContextSnapshot;
}): Promise<{ candidates: number; written: number }> {
	const now = input.now ?? Date.now;
	const deadline =
		now() + (input.budgetMs ?? CONTEXT_SNAPSHOT_BACKFILL_BUDGET_MS);
	const write = input.write ?? writeSessionContextSnapshot;
	const candidates = await query(
		input.executor,
		CandidateSchema,
		buildContextSnapshotCandidatesStatement({
			skippedOrganizationIds:
				input.skippedOrganizationIds ??
				readContextSnapshotBackfillSkippedOrgIds(),
			limit: input.limit ?? CONTEXT_SNAPSHOT_BACKFILL_LIMIT,
		}),
	);
	let written = 0;
	for (const candidate of candidates) {
		if (now() >= deadline) break;
		const target = {
			organizationId: candidate.organization_id,
			userId: candidate.user_id,
		};
		if (await hasClickHousePurgeTombstone(target, { database: input.sql }))
			continue;
		try {
			if (
				await write(
					input.executor,
					{ ...target, sessionId: candidate.session_id },
					undefined,
					() =>
						assertNoClickHousePurgeTombstone(target, { database: input.sql }),
				)
			)
				written++;
		} catch (error) {
			if (error instanceof ClickHouseWriteFencedError) continue;
			logger.warn("Context snapshot backfill of {session} failed: {error}", {
				session: candidate.session_id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { candidates: candidates.length, written };
}
