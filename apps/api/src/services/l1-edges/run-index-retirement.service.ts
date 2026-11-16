import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import {
	hasKeyedDeleteTime,
	submittedStatements,
} from "../clickhouse-batched-delete.js";
import { createTranscriptRecordsDeadline } from "../transcript-records-deadline.js";
import { TRANSCRIPT_RECORDS_RETIRE_GRACE_MS } from "../transcript-records-ingest.service.js";
import {
	CENSUS_WINDOW_INDEX_ROWS,
	CENSUS_WINDOW_SETTINGS,
	type CensusWindowScan,
	censusWindowFilter,
	scanCensusWindows,
} from "../transcript-records-retirement.service.js";
import { RUN_INDEX_TABLE } from "./l1-edge-tables.js";
import { retireRunIndexSnapshots } from "./run-index.service.js";

const MAX_SESSIONS_PER_PASS = 1_000;
const SESSIONS_PER_READ = 100;
const CENSUS_TIMEOUT_MS = 30_000;
const WINDOWS_PER_PASS = 2;
const HOUR_MS = 3_600_000;

interface RetirementSessionRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

/**
 * Sweep of run index snapshots no reader needs. The census is every row, not
 * only receipts, so a build that crashed before its receipt is found even
 * when its session has a single committed snapshot; a session qualifies once
 * its last write is older than the retirement grace.
 * `retireRunIndexSnapshots` decides what goes, one organization's sessions
 * at a time, and never retires the committed snapshot.
 */
export async function runRunIndexRetirementPass(
	options: {
		readonly executor?: ClickHouseExecutor;
		readonly deadline?: MaintenanceDeadline;
		readonly maxSessions?: number;
		readonly organizationId?: string;
		readonly maxWindows?: number;
	} = {},
) {
	const executor = options.executor ?? getClickhouse();
	const now = options.deadline?.now ?? Date.now;
	const startedAt = now();
	const maxSessions = options.maxSessions ?? MAX_SESSIONS_PER_PASS;
	if (
		!Number.isSafeInteger(maxSessions) ||
		maxSessions < 1 ||
		maxSessions > MAX_SESSIONS_PER_PASS
	) {
		throw new Error(
			`maxSessions must be between 1 and ${MAX_SESSIONS_PER_PASS}`,
		);
	}
	const census = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			options.deadline?.deadlineAt ?? Infinity,
			startedAt + CENSUS_TIMEOUT_MS,
		),
		now,
		signal: undefined,
	});
	let scan: CensusWindowScan<RetirementSessionRow>;
	try {
		scan = await scanCensusWindows<RetirementSessionRow>(executor, {
			table: RUN_INDEX_TABLE,
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
			limit: maxSessions,
			organizationId: options.organizationId,
			maxWindows:
				options.maxWindows ??
				(options.organizationId === undefined ? WINDOWS_PER_PASS : undefined),
			rotation: Math.floor(startedAt / HOUR_MS),
			signal: census.signal,
			wait: census.wait,
			statement: (window, remaining) => {
				const bounds = censusWindowFilter(window);
				return {
					clickhouse_settings: CENSUS_WINDOW_SETTINGS,
					query: `
				SELECT organization_id, user_id, session_id
				FROM (
					SELECT organization_id, user_id, session_id,
						(revision, parser_version, index_version, build_revision) AS generation,
						countIf(row_kind = 'receipt') AS receipts,
						maxIf(toUnixTimestamp64Milli(built_at), row_kind = 'receipt') AS receipt_ms,
						max(toUnixTimestamp64Milli(built_at)) AS written_ms
					FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
					WHERE 1 = 1 ${options.organizationId === undefined ? "" : "AND organization_id = {organizationId:String}"} ${bounds.sql}
					GROUP BY organization_id, user_id, session_id, generation
				)
				GROUP BY organization_id, user_id, session_id
				HAVING count() > 1
					AND (max(written_ms) <= {retireBefore:Int64}
						OR arrayExists(
							snapshot -> snapshot.2 > 0 AND snapshot.3 <= {retireBefore:Int64},
							arraySlice(arraySort(groupArray((generation, receipts, receipt_ms))), 2)))
				ORDER BY organization_id, user_id, session_id
				LIMIT {maxSessions:UInt32}
			`,
					query_params: {
						maxSessions: remaining,
						organizationId: options.organizationId,
						retireBefore: startedAt - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
						...bounds.params,
					},
				};
			},
		});
	} finally {
		census.dispose();
	}
	const sessions = scan.rows;
	let generationsRetired = 0;
	let deleteStatements = 0;
	let hasMore = scan.hasMore;
	for (const page of organizationPages(sessions)) {
		if (!hasKeyedDeleteTime(options.deadline)) {
			hasMore = true;
			break;
		}
		const retirement = await retireRunIndexSnapshots(
			executor,
			page[0]?.organization_id ?? "",
			page.map((session) => ({
				userId: session.user_id,
				sessionId: session.session_id,
			})),
			{
				deadline: options.deadline,
				graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
				now: new Date(startedAt),
			},
		);
		generationsRetired += retirement.retired;
		deleteStatements += submittedStatements(retirement.outcomes);
		if (!retirement.settled) {
			hasMore = true;
			break;
		}
	}
	return {
		deleteStatements,
		generationsRetired,
		hasMore,
		sessionsProcessed: sessions.length,
	};
}

function* organizationPages(
	sessions: readonly RetirementSessionRow[],
): Generator<RetirementSessionRow[]> {
	let page: RetirementSessionRow[] = [];
	for (const session of sessions) {
		if (
			page.length >= SESSIONS_PER_READ ||
			(page[0] !== undefined &&
				page[0].organization_id !== session.organization_id)
		) {
			yield page;
			page = [];
		}
		page.push(session);
	}
	if (page.length > 0) yield page;
}
