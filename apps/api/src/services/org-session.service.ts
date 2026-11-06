import { getAllAdapters } from "@rudel/agent-adapters";
import { FINDING_RUNS_TABLE } from "@rudel/ch-schema/finding-runs";
import { MCP_TOOL_CALLS_TABLE } from "@rudel/ch-schema/mcp-tool-calls";
import {
	RUN_SETUP_TABLE,
	SETUP_TEXTS_TABLE,
} from "@rudel/ch-schema/received-setup";
import { REPOSITORY_EVIDENCE_INDEX_TABLE } from "@rudel/ch-schema/repository-evidence-index";
import { RUN_QUESTION_ANSWERS_TABLE } from "@rudel/ch-schema/run-question-answers";
import { SESSION_IMAGES_TABLE } from "@rudel/ch-schema/session-images";
import { SESSION_SAVED_OUTPUTS_TABLE } from "@rudel/ch-schema/session-saved-outputs";
import { WEEKLY_TOTALS_TABLE } from "@rudel/ch-schema/weekly-totals";
import {
	type ClickHouseStatement,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import {
	L1_EDGE_TABLES,
	RUN_INDEX_TABLE,
	RUN_REQUESTS_TABLE,
} from "./l1-edges/l1-edge-tables.js";
import { TRANSCRIPT_SEARCH_TABLES } from "./transcript-search/tables.js";

const SESSION_ANALYTICS_TABLE = "rudel.session_analytics";
const SESSION_LANGUAGE_SIGNALS_TABLE = "rudel.session_language_signals";
const SESSION_LINEAGE_TABLE = "rudel.session_lineage";
const SKILL_RECEIPTS_TABLE = "rudel.skill_receipts";
const SKILL_USES_TABLE = "rudel.skill_uses";
const SKILL_VERSION_CONTENTS_TABLE = "rudel.skill_version_contents";
const TRANSCRIPT_RECORDS_TABLE = "rudel.transcript_records";
const USAGE_EVENTS_TABLE = "rudel.usage_events";
const WRAPPED_USER_ARCHETYPE_SNAPSHOTS_TABLE =
	"rudel.wrapped_user_archetype_snapshots_v1";
const PRIVACY_DELETE_SCAN_SETTINGS = {
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_execution_time: 90,
	max_rows_to_read: "10000000",
} as const;

interface SessionCountRow {
	count: string;
}

interface GetOrgSessionCountOptions {
	querySessionCount?: (
		statement: ClickHouseStatement,
	) => Promise<SessionCountRow[]>;
	rawTableNames?: readonly string[];
}

interface OrgSessionCountCacheEntry {
	expiresAt: number;
	pendingCount: Promise<number>;
}

interface OrgSessionCountCacheOptions {
	load: (organizationId: string, userId?: string) => Promise<number>;
	now?: () => number;
	ttlMs?: number;
}

const ORG_SESSION_COUNT_CACHE_TTL_MS = 2_000;

export function createOrgSessionCountCache(
	options: OrgSessionCountCacheOptions,
): (organizationId: string, userId?: string) => Promise<number> {
	const entries = new Map<string, OrgSessionCountCacheEntry>();
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? ORG_SESSION_COUNT_CACHE_TTL_MS;

	return (organizationId: string, userId?: string) => {
		const currentTime = now();
		const cacheKey = JSON.stringify([organizationId, userId ?? null]);
		const cachedEntry = entries.get(cacheKey);

		if (cachedEntry && cachedEntry.expiresAt > currentTime) {
			return cachedEntry.pendingCount;
		}

		for (const [key, entry] of entries) {
			if (entry.expiresAt <= currentTime) {
				entries.delete(key);
			}
		}

		const pendingCount = options.load(organizationId, userId);
		const entry = {
			expiresAt: currentTime + ttlMs,
			pendingCount,
		};
		entries.set(cacheKey, entry);

		void pendingCount.catch(() => {
			if (entries.get(cacheKey) === entry) {
				entries.delete(cacheKey);
			}
		});

		return pendingCount;
	};
}

export async function getOrgSessionCount(
	orgId: string,
	userId?: string,
	options: GetOrgSessionCountOptions = {},
): Promise<number> {
	const querySessionCount =
		options.querySessionCount ??
		((statement: ClickHouseStatement) =>
			getClickhouse().query<SessionCountRow>(statement));

	if (userId) {
		const rows = await querySessionCount({
			query: `SELECT count() as count FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL WHERE organization_id = {orgId:String} AND user_id = {userId:String}`,
			query_params: {
				orgId,
				userId,
			},
		});

		return Number(rows[0]?.count ?? 0);
	}

	const tables =
		options.rawTableNames ?? getAllAdapters().map((a) => a.rawTableName);
	const results = await Promise.all(
		tables.map((table) =>
			querySessionCount({
				query: `
					SELECT count() AS count
					FROM (
						SELECT
							organization_id,
							user_id,
							session_id,
							max(revision) AS latest_revision
						FROM ${getSafeClickHouseTable(table)}
						WHERE organization_id = {orgId:String}
						GROUP BY organization_id, user_id, session_id
					)
				`,
				query_params: {
					orgId,
				},
			}),
		),
	);
	return results.reduce((sum, rows) => sum + Number(rows[0]?.count ?? 0), 0);
}

export const getCachedOrgSessionCount = createOrgSessionCountCache({
	load: getOrgSessionCount,
});

export async function hasOrgUploadsInLastDays(
	orgId: string,
	days: number,
): Promise<boolean> {
	const ch = getClickhouse();
	const tables = getAllAdapters().map((a) => a.rawTableName);
	const results = await Promise.all(
		tables.map((table) =>
			ch.query<{ count: string }>({
				query: `SELECT count() as count FROM ${getSafeClickHouseTable(table)} WHERE organization_id = {orgId:String} AND session_date >= now64(3) - toIntervalDay({days:UInt32})`,
				query_params: {
					orgId,
					days,
				},
			}),
		),
	);
	return results.some((rows) => Number(rows[0]?.count ?? 0) > 0);
}

export async function deleteOrgSessions(organizationId: string): Promise<void> {
	await deleteSessions("organization_id", organizationId);
}

export async function deleteUserSessions(userId: string): Promise<void> {
	await deleteSessions("user_id", userId);
}

async function deleteSessions(
	column: "organization_id" | "user_id",
	targetId: string,
): Promise<void> {
	const plans = getClickHouseSessionPurgePlans(column);
	const results = await Promise.allSettled(
		plans.map((plan) =>
			deleteSessionsFromTable(plan.table, plan.column, targetId),
		),
	);
	const failures = results.flatMap((result, index) =>
		result.status === "rejected"
			? [
					new Error(
						`ClickHouse purge failed for ${plans[index]?.table ?? "unknown"}`,
						{ cause: result.reason },
					),
				]
			: [],
	);

	if (failures.length > 0) {
		throw new AggregateError(failures, "ClickHouse purge failed");
	}
}

export function getClickHouseSessionPurgePlans(
	column: "organization_id" | "user_id",
): ReadonlyArray<{
	readonly column: "organization_id" | "user_id" | "workspace_id";
	readonly table: string;
}> {
	return [
		...(column === "organization_id"
			? [
					"github_pull_requests",
					"github_pull_request_details",
					"github_pull_request_commits",
					"github_ci_runs",
					"github_ci_run_pull_requests",
					"github_ci_jobs",
				].map((table) => ({
					column: "workspace_id" as const,
					table: `rudel.${table}`,
				}))
			: []),
		...getAllAdapters().map((adapter) => ({
			column,
			table: adapter.rawTableName,
		})),
		{ column, table: SESSION_ANALYTICS_TABLE },
		{ column, table: SESSION_LANGUAGE_SIGNALS_TABLE },
		// Parent and child session ids, models and working directories.
		{ column, table: SESSION_LINEAGE_TABLE },
		{ column, table: SKILL_RECEIPTS_TABLE },
		{ column, table: SKILL_USES_TABLE },
		{ column, table: SKILL_VERSION_CONTENTS_TABLE },
		{ column, table: TRANSCRIPT_RECORDS_TABLE },
		// Transcript search: chunk text with its vectors, and where each appeared.
		...TRANSCRIPT_SEARCH_TABLES.map((table) => ({ column, table })),
		{ column, table: "rudel.session_git_observations" },
		// Session edges carry their owner; GitHub edges (empty user) go with the workspace.
		...L1_EDGE_TABLES.map((table) => ({ column, table })),
		{ column, table: RUN_INDEX_TABLE },
		{ column, table: RUN_REQUESTS_TABLE },
		// Received setup: each run's setup file versions, and each member's copy
		// of the texts (written by the transcript-records writer). The follow-up
		// pass removes texts a write already in flight stored after the first.
		{ column, table: RUN_SETUP_TABLE },
		{ column, table: SETUP_TEXTS_TABLE },
		// Run index sums per member and week. Later refreshes read the run index
		// purged above; the follow-up pass removes a snapshot appended by a
		// refresh that was already running.
		{ column, table: WEEKLY_TOTALS_TABLE },
		// Run question answers name the session's owner; the follow-up pass
		// removes answers a run_questions job stored while the first ran.
		{ column, table: RUN_QUESTION_ANSWERS_TABLE },
		{ column, table: USAGE_EVENTS_TABLE },
		{ column, table: WRAPPED_USER_ARCHETYPE_SNAPSHOTS_TABLE },
		{ column, table: `rudel.${REPOSITORY_EVIDENCE_INDEX_TABLE}` },
		// Saved outputs (task outputs, large tool outputs), published with the
		// evidence index; the follow-up pass removes a publication in flight.
		{ column, table: SESSION_SAVED_OUTPUTS_TABLE },
		// Images (screenshots, pasted images), likewise; their bytes are
		// evidence objects, purged with them.
		{ column, table: SESSION_IMAGES_TABLE },
		// Findings' cited runs, by the run's owner. The rows of analyses the
		// account wrote or whose deletion it causes go in purgeFindingImpact.
		{ column, table: FINDING_RUNS_TABLE },
		{ column, table: MCP_TOOL_CALLS_TABLE },
	];
}

async function deleteSessionsFromTable(
	tableName: string,
	column: "organization_id" | "user_id" | "workspace_id",
	targetId: string,
): Promise<void> {
	await purgeClickHouseRows(tableName, `${column} = {targetId:String}`, {
		targetId,
	});
}

/**
 * Privacy deletion of the rows of `tableName` that match `predicate` (bound
 * with `queryParams`), then a read-back that none is left.
 */
export async function purgeClickHouseRows(
	tableName: string,
	predicate: string,
	queryParams: Record<string, string>,
): Promise<void> {
	const clickhouse = getClickhouse();
	const table = getSafeClickHouseTable(tableName);

	// Privacy deletion is an infrequent mutation, so use a lightweight DELETE.
	// Sync level 3 waits for active SharedMergeTree replicas. The read-back
	// confirms query-level deletion; merges reclaim the physical data later.
	await clickhouse.execute({
		clickhouse_settings: {
			...PRIVACY_DELETE_SCAN_SETTINGS,
			lightweight_deletes_sync: "3",
		},
		query: `DELETE FROM ${table} WHERE ${predicate}`,
		query_params: queryParams,
	});

	const remainingRows = await clickhouse.query({
		clickhouse_settings: PRIVACY_DELETE_SCAN_SETTINGS,
		query: `SELECT 1 FROM ${table} WHERE ${predicate} LIMIT 1`,
		query_params: queryParams,
	});
	if (remainingRows.length > 0) {
		throw new Error(`ClickHouse purge verification failed for ${table}`);
	}
}
