import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import { createTranscriptRecordsDeadline } from "../transcript-records-deadline.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
} from "../transcript-records-ingest.service.js";
import { RUN_INDEX_TABLE } from "./l1-edge-tables.js";
import { retireRunIndexSnapshots } from "./run-index.service.js";

const MAX_SESSIONS_PER_PASS = 10;
const PASS_TIMEOUT_MS = 10_000;

interface RetirementSessionRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

/**
 * Daily sweep of run index snapshots no reader needs, as for transcript
 * records (`runTranscriptRecordsRetirementPass`). The census is every row,
 * not only receipts, so a build that crashed before its receipt is found
 * even when its session has a single committed snapshot (its cleanup at
 * publication failed); a session qualifies once its last write is older
 * than the retirement grace. `retireRunIndexSnapshots` decides what goes and
 * never retires the committed snapshot, even after its transcript expired.
 */
export async function runRunIndexRetirementPass(
	options: {
		readonly executor?: ClickHouseExecutor;
		readonly deadline?: MaintenanceDeadline;
		readonly maxSessions?: number;
		readonly organizationId?: string;
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
	const deadline = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			options.deadline?.deadlineAt ?? Infinity,
			startedAt + PASS_TIMEOUT_MS,
		),
		now,
		signal: undefined,
	});
	try {
		const sessions = await deadline.wait(() =>
			executor.query<RetirementSessionRow>({
				abortSignal: deadline.signal,
				clickhouse_settings: {
					max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
					max_execution_time: 10,
					max_rows_to_read: "10000000",
					result_overflow_mode: "throw",
				},
				query: `
				SELECT organization_id, user_id, session_id
				FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
				${options.organizationId === undefined ? "" : "WHERE organization_id = {organizationId:String}"}
				GROUP BY organization_id, user_id, session_id
				HAVING uniqExact((revision, parser_version, index_version, build_revision)) > 1
					AND max(toUnixTimestamp64Milli(built_at)) <= {retireBefore:Int64}
				ORDER BY organization_id, user_id, session_id
				LIMIT {maxSessions:UInt32}
			`,
				query_params: {
					maxSessions,
					organizationId: options.organizationId,
					retireBefore: startedAt - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
				},
			}),
		);
		let generationsRetired = 0;
		let hasMore = sessions.length === maxSessions;
		for (const session of sessions) {
			const retired = await deadline.wait(() =>
				retireRunIndexSnapshots(
					executor,
					session.organization_id,
					{ userId: session.user_id, sessionId: session.session_id },
					{
						abortSignal: deadline.signal,
						graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
						now: new Date(startedAt),
					},
				),
			);
			generationsRetired += retired;
			hasMore ||= retired === MAX_RETIRED_GENERATIONS_PER_PASS;
		}
		return {
			generationsRetired,
			hasMore,
			sessionsProcessed: sessions.length,
		};
	} finally {
		deadline.dispose();
	}
}
