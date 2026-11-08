import type postgres from "postgres";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";

interface ClickHousePurgeTombstoneTarget {
	readonly organizationId: string;
	readonly userId?: string;
}

interface ClickHousePurgeTombstoneEnv {
	readonly database: postgres.Sql | postgres.TransactionSql;
}

/**
 * Deletion fence for writers of data that an account or organization purge
 * deletes. A `clickhouse_purge_job` row for the target is the tombstone: it is
 * written in the same transaction as the deletion and outlives the purge.
 * Every long-running writer (backfills, derived-data ingest, R2 PUTs) follows
 * the same three steps, so a write can never resurrect deleted data for good:
 *
 * 1. Check before write: call `assertNoClickHousePurgeTombstone` immediately
 *    before each external publication (ClickHouse insert, R2 PUT, backfill
 *    insert) and abort, cleaning up what was written so far, when it throws.
 * 2. Register intent before a PUT: objects get a durable intent row first, so
 *    purge and orphan cleanup can always find them.
 * 3. Second purge pass: a successful purge schedules one follow-up pass after
 *    `CLICKHOUSE_PURGE_FOLLOWUP_DELAY_MS` (default 15 minutes, longer than any
 *    bounded write) that deletes again. A write that passed step 1 just before
 *    the tombstone appeared is removed by that pass, which closes the
 *    check-then-write race without distributed locks.
 *
 * The tombstone outlives all of that work: a job is never expired while its
 * follow-up is outstanding (`followup_due_at`), and its retention is measured
 * from the last pass that completed (`followup_completed_at`).
 *
 * `userId` may be omitted by organization-owned writers that have no acting
 * account; `database` may be a transaction.
 */
export async function assertNoClickHousePurgeTombstone(
	target: ClickHousePurgeTombstoneTarget,
	env: ClickHousePurgeTombstoneEnv,
): Promise<void> {
	if (await hasClickHousePurgeTombstone(target, env)) {
		throw new ClickHouseWriteFencedError();
	}
}

export async function hasClickHousePurgeTombstone(
	target: ClickHousePurgeTombstoneTarget,
	env: ClickHousePurgeTombstoneEnv,
): Promise<boolean> {
	const rows = await env.database.unsafe<Array<{ found: number }>>(
		`SELECT 1 AS found
		 FROM clickhouse_purge_job
		 WHERE (target_type = 'account' AND target_id = $1)
			OR (target_type = 'organization' AND target_id = $2)
		 LIMIT 1`,
		[target.userId ?? "", target.organizationId],
	);
	return rows.length > 0;
}

export function clickHousePurgeTargetKey(target: {
	readonly organizationId: string;
	readonly userId: string;
}): string {
	return `${target.organizationId}\u0000${target.userId}`;
}

export async function findClickHousePurgeTombstones(
	targets: readonly {
		readonly organizationId: string;
		readonly userId: string;
	}[],
	env: ClickHousePurgeTombstoneEnv,
): Promise<Set<string>> {
	if (targets.length === 0) return new Set();
	const rows = await env.database.unsafe<
		Array<{ target_id: string; target_type: string }>
	>(
		`SELECT target_type, target_id
		 FROM clickhouse_purge_job
		 WHERE (target_type = 'account' AND target_id = ANY($1::text[]))
			OR (target_type = 'organization' AND target_id = ANY($2::text[]))`,
		[
			[...new Set(targets.map((target) => target.userId))],
			[...new Set(targets.map((target) => target.organizationId))],
		],
	);
	const accounts = new Set(
		rows
			.filter((row) => row.target_type === "account")
			.map((row) => row.target_id),
	);
	const organizations = new Set(
		rows
			.filter((row) => row.target_type === "organization")
			.map((row) => row.target_id),
	);
	return new Set(
		targets
			.filter(
				(target) =>
					accounts.has(target.userId) ||
					organizations.has(target.organizationId),
			)
			.map(clickHousePurgeTargetKey),
	);
}
