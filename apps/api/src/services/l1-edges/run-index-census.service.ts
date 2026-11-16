import { getLogger } from "@logtape/logtape";
import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import type postgres from "postgres";
import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "../analysis/run-index-sql.js";
import { newestGenerations } from "../transcript-generations/generations.js";
import { enqueueL1EdgeScope } from "./l1-edge-queue.service.js";
import { RUN_INDEX_TABLE } from "./l1-edge-tables.js";

/**
 * The run index census: the durable path that queues run index builds
 * (docs/l1-literal-schema.md, "Scale"). Upload paths never wait on the queue
 * for the run index; the request that rides on a session's edges request
 * can be lost, and usage written after a build changes nothing in Postgres.
 * Daily, this finds recently ingested sessions whose committed run index
 * snapshot is missing or stale (another transcript generation, index
 * version, pricing version or usage extraction) and queues them. The build
 * itself skips a session that turns out to be current.
 *
 * Bounds: sessions ingested in the last `LOOKBACK_DAYS` (started at most
 * `SESSION_START_SLACK_DAYS` before that) with a committed transcript
 * generation; at most `MAX_CENSUS` per source, in a daily-rotating order, so
 * a backlog drains over days. Older sessions are the run index backfill's.
 */

const LOOKBACK_DAYS = 14;
const SESSION_START_SLACK_DAYS = 30;
const MAX_CENSUS = 500;
/** Leave this much of the deadline for the response; stop queueing without it. */
const MIN_REMAINING_MS = 2_000;
const CENSUS_SETTINGS = {
	join_use_nulls: 0,
	max_execution_time: 30,
	max_rows_to_read: "100000000",
	max_bytes_to_read: String(16 * 1024 * 1024 * 1024),
	max_result_rows: String(MAX_CENSUS),
	result_overflow_mode: "throw",
} as const;

const logger = getLogger(["rudel", "api", "l1-edges"]);

interface CensusRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

export interface RunIndexCensusResult {
	readonly candidates: number;
	readonly queued: number;
	readonly hasMore: boolean;
}

/** Queues the run index builds the census finds missing or stale. */
export async function requeueStaleRunIndexScopes(options: {
	readonly sql: postgres.Sql;
	readonly deadline: MaintenanceDeadline;
	readonly executor?: ClickHouseExecutor;
	/** Narrows the census (tests and operators). */
	readonly organizationId?: string;
}): Promise<RunIndexCensusResult> {
	if (process.env.L1_EDGES_ENQUEUE_ENABLED === "false")
		return { candidates: 0, queued: 0, hasMore: false };
	const executor = options.executor ?? getClickhouse();
	const now = options.deadline.now();
	const sources = ["claude_code", "codex"] as const;
	const found = await Promise.all(
		sources.map((source) =>
			executor.query<CensusRow>(
				buildRunIndexCensusStatement(source, now, options.organizationId),
			),
		),
	);
	let queued = 0;
	let hasMore = found.some((rows) => rows.length >= MAX_CENSUS);
	for (const [index, rows] of found.entries()) {
		const source = sources[index] as TranscriptSource;
		for (const row of rows) {
			if (
				options.deadline.deadlineAt - options.deadline.now() <
				MIN_REMAINING_MS
			) {
				hasMore = true;
				break;
			}
			try {
				await enqueueL1EdgeScope(options.sql, {
					kind: "run_index",
					organizationId: row.organization_id,
					userId: row.user_id,
					source,
					sessionId: row.session_id,
				});
				queued++;
			} catch (error) {
				logger.warn(
					"Run index census could not queue session {sessionId}: {error}",
					{
						sessionId: row.session_id,
						error: error instanceof Error ? error.message : String(error),
					},
				);
			}
		}
	}
	return {
		candidates: found.reduce((sum, rows) => sum + rows.length, 0),
		queued,
		hasMore,
	};
}

/**
 * Recently ingested sessions of one source with a committed transcript
 * generation whose committed run index snapshot is missing, of another
 * generation, index or pricing version, or built from another usage
 * extraction than the session's newest usage receipt.
 */
export function buildRunIndexCensusStatement(
	source: TranscriptSource,
	now: number,
	organizationId?: string,
) {
	const rawTable = getSafeClickHouseTable(
		source === "claude_code" ? "rudel.claude_sessions" : "rudel.codex_sessions",
	);
	const organizationFilter =
		organizationId === undefined
			? ""
			: "AND organization_id = {organizationId:String}";
	const identities =
		"(organization_id, user_id, session_id) IN (SELECT organization_id, user_id, session_id FROM raw)";
	const joined = (alias: string) =>
		`raw.organization_id = ${alias}.organization_id AND raw.user_id = ${alias}.user_id AND raw.session_id = ${alias}.session_id`;
	return {
		clickhouse_settings: CENSUS_SETTINGS,
		query: `WITH raw AS (
				SELECT DISTINCT organization_id, user_id, session_id
				FROM ${rawTable}
				WHERE ingested_at >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
					AND session_date >= fromUnixTimestamp64Milli({startedSince:Int64}, 'UTC')
					${organizationFilter}
			),
			records AS (
				${newestGenerations({ and: `AND source = {source:String} AND ${identities}` })}
			),
			indexed AS (
				SELECT organization_id, user_id, session_id, toUInt8(1) AS present,
					argMax(tuple(revision, parser_version, index_version, pricing_version, usage_receipt),
						tuple(revision, parser_version, index_version, build_revision)) AS committed
				FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
				WHERE row_kind = 'receipt' AND ${identities}
				GROUP BY organization_id, user_id, session_id
			),
			usage_receipts AS (
				SELECT organization_id, user_id, session_id, toString(max(event_version)) AS usage_generation
				FROM ${getSafeClickHouseTable("rudel.usage_events")}
				WHERE record_kind = 'receipt' AND ${identities}
				GROUP BY organization_id, user_id, session_id
			)
			SELECT raw.organization_id AS organization_id, raw.user_id AS user_id, raw.session_id AS session_id
			FROM raw
			INNER JOIN records ON ${joined("records")}
			LEFT JOIN indexed ON ${joined("indexed")}
			LEFT JOIN usage_receipts ON ${joined("usage_receipts")}
			WHERE indexed.present = 0
				OR tuple(indexed.committed.1, indexed.committed.2) != records.generation
				OR indexed.committed.3 != {indexVersion:UInt16}
				OR indexed.committed.4 != {pricingVersion:String}
				OR (splitByChar(':', indexed.committed.5)[1] != usage_receipts.usage_generation
					AND NOT (startsWith(indexed.committed.5, 'unreceipted') AND usage_receipts.usage_generation = ''))
				-- Usage that was incomplete when indexed may have recovered.
				OR endsWith(indexed.committed.5, ':incomplete')
			ORDER BY cityHash64(raw.session_id, {seed:String})
			LIMIT {limit:UInt32}`,
		query_params: {
			indexVersion: RUN_INDEX_VERSION,
			limit: MAX_CENSUS,
			organizationId: organizationId ?? "",
			pricingVersion: RUN_INDEX_PRICING_VERSION,
			seed: new Date(now).toISOString().slice(0, 10),
			since: now - LOOKBACK_DAYS * 86_400_000,
			source,
			startedSince:
				now - (LOOKBACK_DAYS + SESSION_START_SLACK_DAYS) * 86_400_000,
		},
	};
}
