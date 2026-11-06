import {
	decodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";
import { createTranscriptRecordsDeadline } from "./transcript-records-deadline.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	retireSupersededTranscriptRecordsGenerations,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
	TRANSCRIPT_RECORDS_TABLE,
} from "./transcript-records-ingest.service.js";

const MAX_SESSIONS_PER_PASS = 10;
const PASS_TIMEOUT_MS = 60_000;
export const CENSUS_WINDOW_INDEX_ROWS = 2_000_000;
export const CENSUS_WINDOW_SETTINGS = {
	max_bytes_to_read: String(1024 * 1024 * 1024),
	max_execution_time: 10,
	max_rows_to_read: String(2 * CENSUS_WINDOW_INDEX_ROWS),
	result_overflow_mode: "throw",
} as const;
const CENSUS_WINDOW_BOUNDS_SETTINGS = {
	max_execution_time: 10,
	max_rows_to_read: "1000000",
	result_overflow_mode: "throw",
} as const;

export interface TranscriptRecordsSessionKey {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
}

export interface TranscriptRecordsCensusWindow {
	readonly from?: TranscriptRecordsSessionKey;
	readonly to?: TranscriptRecordsSessionKey;
}

interface CensusWindowStartRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

interface RetirementSessionRow {
	organization_id: string;
	user_id: string;
	session_id: string;
	revision_text: string;
	parser_version: number;
	receipt_head: string;
}

/**
 * Sessions with more than one committed generation whose newest receipt was
 * published at or before `retireBefore` (so the generations it superseded
 * are past the grace), in key order, at most `limit`. Shared by the daily pass and the operator drain
 * (`drainTranscriptRecordsRetirement`), so both retire exactly the same
 * sessions.
 */
export function buildTranscriptRecordsRetirementCensusStatement(input: {
	readonly limit: number;
	readonly organizationId?: string;
	readonly retireBefore: number;
	readonly settings?: ClickHouseStatement["clickhouse_settings"];
	readonly window?: TranscriptRecordsCensusWindow;
}): ClickHouseStatement {
	return {
		clickhouse_settings: input.settings ?? CENSUS_WINDOW_SETTINGS,
		query: `
				SELECT organization_id, user_id, session_id,
					toString(newest_generation.1) AS revision_text,
					newest_generation.2 AS parser_version, receipt_head
				FROM (
				SELECT organization_id, user_id, session_id,
					max((revision, parser_version)) AS newest_generation,
					argMax(head, (revision, parser_version, JSONExtractString(head, 'publishedAt'))) AS receipt_head
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
				WHERE agent_id = ''
					AND record_idx = {receiptRecordIdx:UInt32}
					AND block_idx = 0 AND kind = 'receipt'
					${input.organizationId === undefined ? "" : "AND organization_id = {organizationId:String}"}
					${input.window?.from === undefined ? "" : `AND ${keyBound("from", ">")}`}
					${input.window?.to === undefined ? "" : `AND ${keyBound("to", "<")}`}
				GROUP BY organization_id, user_id, session_id
				HAVING uniqExact((revision, parser_version)) > 1
					AND parseDateTime64BestEffortOrNull(JSONExtractString(receipt_head, 'publishedAt'), 3, 'UTC')
						<= fromUnixTimestamp64Milli({retireBefore:Int64}, 'UTC')
				)
				ORDER BY organization_id, user_id, session_id
				LIMIT {maxSessions:UInt32}
			`,
		query_params: {
			maxSessions: input.limit,
			organizationId: input.organizationId,
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			retireBefore: input.retireBefore,
			...keyParams("from", input.window?.from),
			...keyParams("to", input.window?.to),
		},
	};
}

export function buildTranscriptRecordsCensusWindowsStatement(input: {
	readonly organizationId?: string;
	readonly windowRows: number;
}): ClickHouseStatement {
	const [database, table] = getSafeClickHouseTable(
		TRANSCRIPT_RECORDS_TABLE,
	).split(".");
	return {
		clickhouse_settings: CENSUS_WINDOW_BOUNDS_SETTINGS,
		query: `
				SELECT first_key.1 AS organization_id, first_key.2 AS user_id, first_key.3 AS session_id
				FROM (
					SELECT window_index, min((organization_id, user_id, session_id)) AS first_key
					FROM (
						SELECT organization_id, user_id, session_id,
							intDiv(sum(index_rows) OVER (ORDER BY organization_id, user_id, session_id ROWS UNBOUNDED PRECEDING) - index_rows, {windowRows:UInt64}) AS window_index
						FROM (
							SELECT organization_id, user_id, session_id, sum(rows_in_granule) AS index_rows
							FROM mergeTreeIndex({database:String}, {table:String})
							${input.organizationId === undefined ? "" : "WHERE organization_id = {organizationId:String}"}
							GROUP BY organization_id, user_id, session_id
						)
					)
					GROUP BY window_index
				)
				ORDER BY window_index
			`,
		query_params: {
			database,
			organizationId: input.organizationId,
			table,
			windowRows: input.windowRows,
		},
	};
}

export function transcriptRecordsCensusWindows(
	starts: readonly TranscriptRecordsSessionKey[],
): TranscriptRecordsCensusWindow[] {
	const cuts = starts.slice(1);
	if (cuts.length === 0) return [{}];
	return [
		{ to: cuts[0] },
		...cuts.map((from, index) => ({ from, to: cuts[index + 1] })),
	];
}

function keyBound(side: "from" | "to", direction: ">" | "<"): string {
	const organization = `{${side}OrganizationId:String}`;
	const user = `{${side}UserId:String}`;
	const session = `{${side}SessionId:String}`;
	const last = direction === ">" ? ">=" : "<";
	return `(organization_id ${direction} ${organization} OR (organization_id = ${organization} AND (user_id ${direction} ${user} OR (user_id = ${user} AND session_id ${last} ${session}))))`;
}

function keyParams(
	side: "from" | "to",
	key: TranscriptRecordsSessionKey | undefined,
): Record<string, string> {
	if (key === undefined) return {};
	return {
		[`${side}OrganizationId`]: key.organizationId,
		[`${side}UserId`]: key.userId,
		[`${side}SessionId`]: key.sessionId,
	};
}

export async function runTranscriptRecordsRetirementPass(
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
		const starts = await deadline.wait(() =>
			executor.query<CensusWindowStartRow>({
				...buildTranscriptRecordsCensusWindowsStatement({
					organizationId: options.organizationId,
					windowRows: CENSUS_WINDOW_INDEX_ROWS,
				}),
				abortSignal: deadline.signal,
			}),
		);
		const windows = transcriptRecordsCensusWindows(
			starts.map((row) => ({
				organizationId: row.organization_id,
				sessionId: row.session_id,
				userId: row.user_id,
			})),
		);
		const sessions: RetirementSessionRow[] = [];
		let windowsScanned = 0;
		for (const window of windows) {
			if (sessions.length >= maxSessions) break;
			const found = await deadline.wait(() =>
				executor.query<RetirementSessionRow>({
					...buildTranscriptRecordsRetirementCensusStatement({
						limit: maxSessions - sessions.length,
						organizationId: options.organizationId,
						retireBefore: startedAt - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
						window,
					}),
					abortSignal: deadline.signal,
				}),
			);
			sessions.push(...found);
			windowsScanned++;
		}
		let generationsRetired = 0;
		let hasMore = sessions.length === maxSessions;
		for (const session of sessions) {
			const receipt = decodeTranscriptRecordsReceipt(session.receipt_head);
			if (receipt === undefined) continue;
			const retired = await deadline.wait(() =>
				retireSupersededTranscriptRecordsGenerations(
					executor,
					{
						organizationId: session.organization_id,
						sessionId: session.session_id,
						userId: session.user_id,
					},
					{
						abortSignal: deadline.signal,
						graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
						now: new Date(startedAt),
						published: {
							revision: session.revision_text,
							parserVersion: session.parser_version,
						},
						publishedAtMs: Date.parse(receipt.publishedAt),
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
			windows: windows.length,
			windowsScanned,
		};
	} finally {
		deadline.dispose();
	}
}
