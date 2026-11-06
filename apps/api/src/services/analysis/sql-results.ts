import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
	type AnalysisHistorySqlResultOutput,
	type AnalysisSqlOutput,
	AnalysisSqlOutputSchema,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { driftNotice } from "./retro-measures.js";

/**
 * Stored SQL results (docs/adr/0005-agents-query-l1-with-sql.md): every `sql`
 * result is kept under an id with its title, SQL and what it covered, so it
 * can be opened later and removed with the sessions it counted. ADR 0001 as
 * amended: deleting an account deletes the results it ran and every result
 * whose rows carried text from the sessions it could read (`owners`), and
 * removes the rows of every other one that only counted them, keeping its
 * title and, unless it carries text of its own, its SQL; deleting a
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
	/** The shown rows carried only numbers, times and ids (`rowsQuote`). */
	readonly counts: boolean;
	/** The SQL has a literal, quoted name or comment (`carriesText`). */
	readonly queryCarriesText: boolean;
}

/** A stored result as it is now: without its result once removed. */
export interface StoredSqlResult extends Omit<SqlResultRecord, "output"> {
	readonly id: string;
	readonly output: SqlResultRecord["output"] | null;
	readonly createdAt: string;
	/** A member whose sessions it counted deleted their account. */
	readonly removed: boolean;
}

export interface SqlResultStore {
	/** Stores the result and returns its id. */
	save(record: SqlResultRecord): Promise<string>;
	get(id: string): Promise<StoredSqlResult | null>;
	/** Removes one result, when the call that stored it failed afterwards. */
	discard(id: string): Promise<void>;
	/**
	 * A workspace's results are deleted. For an account, its own results and
	 * every result among whose owners it is that does not only count are
	 * deleted; every other result among whose owners it is is removed: no
	 * output, the account no longer among its owners, the title kept, and the
	 * SQL kept unless it carries text (then empty).
	 */
	purge(target: SqlPurgeTarget): Promise<void>;
}

export type SqlPurgeTarget =
	| { targetType: "account"; targetId: string }
	| { targetType: "organization"; targetId: string };

const StoredSqlOutputSchema = AnalysisSqlOutputSchema.omit({
	id: true,
	trace: true,
});

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

/**
 * One stored result for the member who ran it: its title, SQL and rows, or
 * why the rows are gone (removed, or past the retention before the daily
 * cleanup deleted it). Results belong to their author's draft or analysis,
 * so nobody else opens one by id; a shared analysis shows its sql steps
 * through their stored queries.
 */
export async function openSqlResult(
	results: Pick<SqlResultStore, "get">,
	viewer: { workspaceId: string; userId: string },
	id: string,
	now: Date,
): Promise<AnalysisHistorySqlResultOutput> {
	const stored = await results.get(id);
	if (
		!stored ||
		stored.workspaceId !== viewer.workspaceId ||
		stored.authorId !== viewer.userId
	)
		throw new ORPCError("NOT_FOUND", {
			message: `No sql result ${id} of yours; a shared answer's sql steps open by their query id (answers action=open lists them)`,
		});
	const expired =
		now.getTime() - Date.parse(stored.createdAt) >
		SQL_RESULT_RETENTION_DAYS * 86_400_000;
	const unavailable = stored.removed ? "removed" : expired ? "expired" : null;
	const drift = stored.output?.measure
		? driftNotice(stored.output.measure)
		: null;
	return {
		id: stored.id,
		title: stored.title,
		query: stored.query,
		createdAt: stored.createdAt,
		unavailable,
		output:
			unavailable || !stored.output
				? null
				: drift
					? {
							...stored.output,
							notices: [drift, ...stored.output.notices],
						}
					: stored.output,
	};
}

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

/** Stored sql result ids start with it; analysis query ids do not. */
export const SQL_RESULT_ID_PREFIX = "sr_";

export function newSqlResultId(): string {
	return `${SQL_RESULT_ID_PREFIX}${randomBytes(12).toString("base64url")}`;
}

export function createMemorySqlResultStore(
	now: () => Date = () => new Date(),
): SqlResultStore & {
	readonly records: Map<string, StoredSqlResult>;
} {
	const records = new Map<string, StoredSqlResult>();
	return {
		records,
		async save(record) {
			const id = newSqlResultId();
			records.set(id, {
				...record,
				id,
				createdAt: now().toISOString(),
				removed: false,
			});
			return id;
		},
		async get(id) {
			return records.get(id) ?? null;
		},
		async discard(id) {
			records.delete(id);
		},
		async purge(target) {
			for (const [id, record] of records) {
				if (target.targetType === "organization") {
					if (record.workspaceId === target.targetId) records.delete(id);
				} else if (record.authorId === target.targetId) records.delete(id);
				else if (!record.owners.includes(target.targetId)) continue;
				else if (!record.counts) records.delete(id);
				else
					records.set(id, {
						...record,
						query: record.queryCarriesText ? "" : record.query,
						output: null,
						removed: true,
						owners: record.owners.filter((owner) => owner !== target.targetId),
					});
			}
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
					(id, organization_id, author_id, title, query, output, owner_ids,
						counts, query_carries_text)
				VALUES (
					${id}, ${record.workspaceId}, ${record.authorId}, ${record.title},
					${record.query}, ${JSON.stringify(record.output)}::jsonb, ${[...record.owners]},
					${record.counts}, ${record.queryCarriesText}
				)
			`;
			return id;
		},
		async get(id) {
			const [row] = await sql<
				{
					id: string;
					organization_id: string;
					author_id: string;
					title: string;
					query: string;
					output: unknown;
					owner_ids: string[];
					counts: boolean;
					query_carries_text: boolean;
					created_at: Date | string;
					removed_at: Date | string | null;
				}[]
			>`
				SELECT id, organization_id, author_id, title, query, output, owner_ids,
					counts, query_carries_text, created_at, removed_at
				FROM analysis_sql_result WHERE id = ${id}
			`;
			if (!row) return null;
			return {
				id: row.id,
				workspaceId: row.organization_id,
				authorId: row.author_id,
				title: row.title,
				query: row.query,
				output:
					row.output === null ? null : StoredSqlOutputSchema.parse(row.output),
				owners: row.owner_ids,
				counts: row.counts,
				queryCarriesText: row.query_carries_text,
				createdAt: new Date(row.created_at).toISOString(),
				removed: row.removed_at !== null,
			};
		},
		async discard(id) {
			await sql`DELETE FROM analysis_sql_result WHERE id = ${id}`;
		},
		async purge(target) {
			if (target.targetType === "organization") {
				await sql`DELETE FROM analysis_sql_result WHERE organization_id = ${target.targetId}`;
				return;
			}
			await sql`
				DELETE FROM analysis_sql_result
				WHERE author_id = ${target.targetId}
					OR (${target.targetId} = ANY(owner_ids) AND NOT counts)
			`;
			await sql`
				UPDATE analysis_sql_result SET
					output = NULL,
					query = CASE WHEN query_carries_text THEN '' ELSE query END,
					removed_at = coalesce(removed_at, now()),
					owner_ids = array_remove(owner_ids, ${target.targetId})
				WHERE ${target.targetId} = ANY(owner_ids)
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
				{ query_count: number; window_started_at: Date | string }[]
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
				resetsAt: new Date(
					new Date(row.window_started_at).getTime() + limits.windowMs,
				),
			};
		},
	};
}
