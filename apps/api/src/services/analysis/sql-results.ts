import { randomBytes } from "node:crypto";
import type { AnalysisSqlOutput } from "@rudel/api-routes";
import type postgres from "postgres";

/**
 * Stored SQL results (docs/adr/0005-agents-query-l1-with-sql.md): every `sql`
 * result is kept under an id with its title, SQL and what it covered, so it
 * can be quoted later and deleted with the sessions it read. ADR 0001 as
 * amended: deleting an account deletes the results it ran and every result
 * that read one of its sessions (`owners`), in any author's name; deleting a
 * workspace deletes all of the workspace's results.
 */

export interface SqlResultRecord {
	readonly workspaceId: string;
	readonly authorId: string;
	readonly title: string;
	readonly query: string;
	/** The result as returned, without its id. */
	readonly output: Omit<AnalysisSqlOutput, "id" | "trace">;
	/** Every member whose sessions the query could read, sorted. */
	readonly owners: readonly string[];
}

export interface SqlResultStore {
	/** Stores the result and returns its id. */
	save(record: SqlResultRecord): Promise<string>;
	/** Removes one result, when the call that stored it failed afterwards. */
	discard(id: string): Promise<void>;
	/** Deletes the results of the target: a workspace's, or an account's and every result that read its sessions. */
	purge(target: SqlPurgeTarget): Promise<void>;
}

export type SqlPurgeTarget =
	| { targetType: "account"; targetId: string }
	| { targetType: "organization"; targetId: string };

/** A per-workspace budget of queries in a fixed window. */
export interface SqlQuota {
	take(
		workspaceId: string,
	): Promise<{ allowed: true } | { allowed: false; resetsAt: Date }>;
	readonly queries: number;
	readonly windowMs: number;
}

/** Stored results are deleted this long after they were stored (ADR 0001's result retention). */
export const SQL_RESULT_RETENTION_DAYS = 90;

/** Deletes stored results older than the retention; the daily API maintenance runs it. */
export async function expireSqlResults(
	sql: postgres.Sql,
): Promise<{ deleted: number }> {
	const deleted = await sql`
		DELETE FROM analysis_sql_result
		WHERE created_at < now() - ${`${SQL_RESULT_RETENTION_DAYS} days`}::interval
	`;
	return { deleted: deleted.count };
}

/**
 * Queries a workspace may run per hour: ClickHouse has 6 cores and about
 * 5.4 GiB for everyone, ingest and merges included.
 */
export const SQL_QUOTA = { queries: 120, windowMs: 3_600_000 } as const;

export function newSqlResultId(): string {
	return `sr_${randomBytes(12).toString("base64url")}`;
}

export function createMemorySqlResultStore(): SqlResultStore & {
	readonly records: Map<string, SqlResultRecord>;
} {
	const records = new Map<string, SqlResultRecord>();
	return {
		records,
		async save(record) {
			const id = newSqlResultId();
			records.set(id, record);
			return id;
		},
		async discard(id) {
			records.delete(id);
		},
		async purge(target) {
			for (const [id, record] of records)
				if (
					target.targetType === "organization"
						? record.workspaceId === target.targetId
						: record.authorId === target.targetId ||
							record.owners.includes(target.targetId)
				)
					records.delete(id);
		},
	};
}

export function createMemorySqlQuota(
	limits: { queries: number; windowMs: number },
	now: () => Date = () => new Date(),
): SqlQuota {
	const windows = new Map<string, { startedAt: number; count: number }>();
	return {
		...limits,
		async take(workspaceId) {
			const at = now().getTime();
			const current = windows.get(workspaceId);
			const window =
				current && at - current.startedAt < limits.windowMs
					? current
					: { startedAt: at, count: 0 };
			windows.set(workspaceId, window);
			if (window.count >= limits.queries)
				return {
					allowed: false,
					resetsAt: new Date(window.startedAt + limits.windowMs),
				};
			window.count++;
			return { allowed: true };
		},
	};
}

/** Results in Postgres (`analysis_sql_result`), deleted by the account and workspace purges. */
export function createPostgresSqlResultStore(
	sql: postgres.Sql,
): SqlResultStore {
	return {
		async save(record) {
			const id = newSqlResultId();
			await sql`
				INSERT INTO analysis_sql_result
					(id, organization_id, author_id, title, query, output, owner_ids)
				VALUES (
					${id}, ${record.workspaceId}, ${record.authorId}, ${record.title},
					${record.query}, ${sql.json(record.output)}, ${[...record.owners]}
				)
			`;
			return id;
		},
		async discard(id) {
			await sql`DELETE FROM analysis_sql_result WHERE id = ${id}`;
		},
		async purge(target) {
			if (target.targetType === "organization")
				await sql`DELETE FROM analysis_sql_result WHERE organization_id = ${target.targetId}`;
			else
				await sql`
					DELETE FROM analysis_sql_result
					WHERE author_id = ${target.targetId} OR ${target.targetId} = ANY(owner_ids)
				`;
		},
	};
}

/** One fixed window per workspace (`analysis_sql_quota`), taken atomically. */
export function createPostgresSqlQuota(
	sql: postgres.Sql,
	limits: { queries: number; windowMs: number } = SQL_QUOTA,
): SqlQuota {
	return {
		...limits,
		async take(workspaceId) {
			const [row] = await sql<
				{ query_count: number; window_started_at: Date }[]
			>`
				INSERT INTO analysis_sql_quota (organization_id, window_started_at, query_count)
				VALUES (${workspaceId}, now(), 1)
				ON CONFLICT (organization_id) DO UPDATE SET
					window_started_at = CASE
						WHEN analysis_sql_quota.window_started_at <= now() - ${`${limits.windowMs} milliseconds`}::interval
						THEN now() ELSE analysis_sql_quota.window_started_at END,
					query_count = CASE
						WHEN analysis_sql_quota.window_started_at <= now() - ${`${limits.windowMs} milliseconds`}::interval
						THEN 1 ELSE analysis_sql_quota.query_count + 1 END
				RETURNING query_count, window_started_at
			`;
			if (!row || row.query_count <= limits.queries) return { allowed: true };
			return {
				allowed: false,
				resetsAt: new Date(row.window_started_at.getTime() + limits.windowMs),
			};
		},
	};
}
