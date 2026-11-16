import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { TRANSCRIPT_RECORDS_TABLE } from "./transcript-records-ingest.service.js";

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

export interface RetirementSessionRow {
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
 * are past the grace), in key order, at most `limit`. Shared by the hourly
 * retirement and the operator drain (`drainTranscriptRecordsRetirement`), so
 * both retire exactly the same sessions.
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
					argMax(head, (revision, parser_version, JSONExtractString(head, 'publishedAt'))) AS receipt_head,
					arraySort(groupUniqArray(((revision, parser_version),
						parseDateTime64BestEffortOrNull(JSONExtractString(head, 'publishedAt'), 3, 'UTC')))) AS receipts
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
				WHERE agent_id = ''
					AND record_idx = {receiptRecordIdx:UInt32}
					AND block_idx = 0 AND kind = 'receipt'
					${input.organizationId === undefined ? "" : "AND organization_id = {organizationId:String}"}
					${input.window?.from === undefined ? "" : `AND ${keyBound("from", ">")}`}
					${input.window?.to === undefined ? "" : `AND ${keyBound("to", "<")}`}
				GROUP BY organization_id, user_id, session_id
				HAVING uniqExact((revision, parser_version)) > 1
					AND arrayExists(
						receipt -> receipt.2 <= fromUnixTimestamp64Milli({retireBefore:Int64}, 'UTC'),
						arraySlice(receipts, 2))
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
	readonly table?: string;
}): ClickHouseStatement {
	const [database, table] = getSafeClickHouseTable(
		input.table ?? TRANSCRIPT_RECORDS_TABLE,
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

export function censusWindowFilter(
	window: TranscriptRecordsCensusWindow,
	alias?: string,
): {
	sql: string;
	params: Record<string, string>;
} {
	return {
		sql: [
			window.from === undefined ? "" : `AND ${keyBound("from", ">", alias)}`,
			window.to === undefined ? "" : `AND ${keyBound("to", "<", alias)}`,
		].join(" "),
		params: {
			...keyParams("from", window.from),
			...keyParams("to", window.to),
		},
	};
}

function keyBound(
	side: "from" | "to",
	direction: ">" | "<",
	alias?: string,
): string {
	const column = (name: string) =>
		alias === undefined ? name : `${alias}.${name}`;
	const organization = `{${side}OrganizationId:String}`;
	const user = `{${side}UserId:String}`;
	const session = `{${side}SessionId:String}`;
	const last = direction === ">" ? ">=" : "<";
	return `(${column("organization_id")} ${direction} ${organization} OR (${column("organization_id")} = ${organization} AND (${column("user_id")} ${direction} ${user} OR (${column("user_id")} = ${user} AND ${column("session_id")} ${last} ${session}))))`;
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

export interface CensusWindowScan<Row> {
	rows: Row[];
	windows: number;
	windowsScanned: number;
	hasMore: boolean;
}

export async function scanCensusWindows<Row>(
	executor: ClickHouseExecutor,
	options: {
		readonly table: string;
		readonly windowRows: number;
		readonly limit: number;
		readonly statement: (
			window: TranscriptRecordsCensusWindow,
			remaining: number,
		) => ClickHouseStatement;
		readonly wait: <T>(operation: () => Promise<T>) => Promise<T>;
		readonly signal?: AbortSignal;
		readonly organizationId?: string;
		readonly maxWindows?: number;
		readonly rotation?: number;
	},
): Promise<CensusWindowScan<Row>> {
	const starts = await options.wait(() =>
		executor.query<CensusWindowStartRow>({
			...buildTranscriptRecordsCensusWindowsStatement({
				organizationId: options.organizationId,
				table: options.table,
				windowRows: options.windowRows,
			}),
			abortSignal: options.signal,
		}),
	);
	const windows = transcriptRecordsCensusWindows(
		starts.map((row) => ({
			organizationId: row.organization_id,
			sessionId: row.session_id,
			userId: row.user_id,
		})),
	);
	const maxWindows = Math.min(
		windows.length,
		options.maxWindows ?? windows.length,
	);
	const first =
		((((options.rotation ?? 0) * maxWindows) % windows.length) +
			windows.length) %
		windows.length;
	const rows: Row[] = [];
	let windowsScanned = 0;
	while (windowsScanned < maxWindows && rows.length < options.limit) {
		const window = windows[(first + windowsScanned) % windows.length] ?? {};
		const found = await options.wait(() =>
			executor.query<Row>({
				...options.statement(window, options.limit - rows.length),
				abortSignal: options.signal,
			}),
		);
		rows.push(...found);
		windowsScanned++;
	}
	return {
		rows,
		windows: windows.length,
		windowsScanned,
		hasMore: rows.length >= options.limit || windowsScanned < windows.length,
	};
}

export async function findTranscriptRecordsRetirementSessions(
	executor: ClickHouseExecutor,
	options: {
		readonly maxSessions: number;
		readonly retireBefore: number;
		readonly wait: <T>(operation: () => Promise<T>) => Promise<T>;
		readonly signal?: AbortSignal;
		readonly organizationId?: string;
		readonly maxWindows?: number;
		readonly rotation?: number;
	},
): Promise<CensusWindowScan<RetirementSessionRow>> {
	return scanCensusWindows<RetirementSessionRow>(executor, {
		...options,
		limit: options.maxSessions,
		table: TRANSCRIPT_RECORDS_TABLE,
		windowRows: CENSUS_WINDOW_INDEX_ROWS,
		statement: (window, remaining) =>
			buildTranscriptRecordsRetirementCensusStatement({
				limit: remaining,
				organizationId: options.organizationId,
				retireBefore: options.retireBefore,
				window,
			}),
	});
}
