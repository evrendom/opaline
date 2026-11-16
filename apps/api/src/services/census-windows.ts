import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";

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

export interface CensusSessionKey {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
}

export interface CensusWindow {
	readonly from?: CensusSessionKey;
	readonly to?: CensusSessionKey;
}

interface CensusWindowStartRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

export function buildCensusWindowsStatement(input: {
	readonly organizationId?: string;
	readonly windowRows: number;
	readonly table: string;
}): ClickHouseStatement {
	const [database, table] = getSafeClickHouseTable(input.table).split(".");
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

export function censusWindows(
	starts: readonly CensusSessionKey[],
): CensusWindow[] {
	const cuts = starts.slice(1);
	if (cuts.length === 0) return [{}];
	return [
		{ to: cuts[0] },
		...cuts.map((from, index) => ({ from, to: cuts[index + 1] })),
	];
}

export function censusWindowFilter(
	window: CensusWindow,
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
	key: CensusSessionKey | undefined,
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
		readonly read: (
			window: CensusWindow,
			remaining: number,
			signal: AbortSignal | undefined,
		) => Promise<Row[]>;
		readonly wait: <T>(operation: () => Promise<T>) => Promise<T>;
		readonly signal?: AbortSignal;
		readonly organizationId?: string;
		readonly maxWindows?: number;
		readonly rotation?: number;
	},
): Promise<CensusWindowScan<Row>> {
	const starts = await options.wait(() =>
		executor.query<CensusWindowStartRow>({
			...buildCensusWindowsStatement({
				organizationId: options.organizationId,
				table: options.table,
				windowRows: options.windowRows,
			}),
			abortSignal: options.signal,
		}),
	);
	const windows = censusWindows(
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
			options.read(window, options.limit - rows.length, options.signal),
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
