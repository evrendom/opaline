import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";
import {
	buildKeyedDeleteOperations,
	type DeleteOperation,
	type DeleteOutcome,
	hasKeyedDeleteTime,
	isDeleteSettled,
	type KeyedDeleteColumn,
	reconcileBudget,
	runDeleteOperation,
} from "./clickhouse-batched-delete.js";
import {
	CENSUS_WINDOW_INDEX_ROWS,
	CENSUS_WINDOW_SETTINGS,
	censusWindowFilter,
	scanCensusWindows,
} from "./transcript-records-retirement.service.js";

export const GENERATIONS_PER_RETIREMENT_PASS = 4_096;
const BELOW_RECEIPT_WINDOW_ROWS = CENSUS_WINDOW_INDEX_ROWS / 2;
const BELOW_RECEIPT_WINDOWS_PER_PASS = 2;
const HOUR_MS = 3_600_000;
const BELOW_RECEIPT_CENSUS_SETTINGS = {
	...CENSUS_WINDOW_SETTINGS,
	max_memory_usage: String(1024 * 1024 * 1024),
} as const;

export interface GenerationRetirementOptions {
	organizationId?: string;
	signal?: AbortSignal;
	deadline?: MaintenanceDeadline;
	limit?: number;
	maxWindows?: number;
}

export interface GenerationRetirement {
	generations: number;
	retired: number;
	hasMore: boolean;
	windows: number;
	windowsScanned: number;
	outcomes: DeleteOutcome[];
}

interface OlderGeneration {
	organization_id: string;
	user_id: string;
	source: string;
	session_id: string;
	revision: string;
	parser_version: number;
}

const SOURCE_SESSION_GENERATION_COLUMNS = [
	{ name: "user_id", type: "String" },
	{ name: "source", type: "String" },
	{ name: "session_id", type: "String" },
	{ name: "revision", type: "UInt64" },
	{ name: "parser_version", type: "UInt16" },
] as const satisfies readonly KeyedDeleteColumn[];

export async function retireGenerationsBelowNewestReceipt(
	executor: ClickHouseExecutor,
	tableName: string,
	options: GenerationRetirementOptions = {},
): Promise<GenerationRetirement> {
	const table = getSafeClickHouseTable(tableName);
	const limit = options.limit ?? GENERATIONS_PER_RETIREMENT_PASS;
	const organizationFilter =
		options.organizationId === undefined
			? ""
			: "AND organization_id = {organizationId:String}";
	const scan = await scanCensusWindows<OlderGeneration>(executor, {
		table,
		windowRows: BELOW_RECEIPT_WINDOW_ROWS,
		limit,
		organizationId: options.organizationId,
		maxWindows:
			options.maxWindows ??
			(options.organizationId === undefined
				? BELOW_RECEIPT_WINDOWS_PER_PASS
				: undefined),
		rotation: Math.floor((options.deadline?.now ?? Date.now)() / HOUR_MS),
		signal: options.signal,
		wait: (operation) => operation(),
		statement: (window, remaining) => {
			const bounds = censusWindowFilter(window);
			return {
				clickhouse_settings: BELOW_RECEIPT_CENSUS_SETTINGS,
				query: `SELECT DISTINCT o.organization_id AS organization_id, o.user_id AS user_id, o.source AS source,
						o.session_id AS session_id, toString(o.revision) AS revision, o.parser_version AS parser_version
					FROM (
						SELECT organization_id, user_id, source, session_id, revision, parser_version
						FROM ${table}
						WHERE 1 = 1 ${organizationFilter} ${bounds.sql}
					) AS o
					INNER JOIN (
						SELECT organization_id, user_id, source, session_id, max(tuple(revision, parser_version)) AS head
						FROM ${table}
						WHERE kind = 'receipt' ${organizationFilter} ${bounds.sql}
						GROUP BY organization_id, user_id, source, session_id
					) AS h
						ON o.organization_id = h.organization_id AND o.user_id = h.user_id
						AND o.source = h.source AND o.session_id = h.session_id
					WHERE tuple(o.revision, o.parser_version) < h.head
					ORDER BY organization_id, user_id, source, session_id, revision, parser_version
					LIMIT {limit:UInt32}`,
				query_params: {
					limit: remaining,
					...bounds.params,
					...(options.organizationId === undefined
						? {}
						: { organizationId: options.organizationId }),
				},
			};
		},
	});
	const older = scan.rows.slice(0, limit);
	const result: GenerationRetirement = {
		generations: older.length,
		retired: 0,
		hasMore: scan.hasMore,
		windows: scan.windows,
		windowsScanned: scan.windowsScanned,
		outcomes: [],
	};
	for (const [organizationId, generations] of groupByOrganization(older)) {
		const operations = buildBelowReceiptDeletes(
			table,
			organizationId,
			generations,
		);
		const outcomes = await runRetirementDeletes(executor, operations, options);
		result.outcomes.push(...outcomes);
		for (const outcome of outcomes)
			if (isDeleteSettled(outcome)) result.retired += outcome.keyCount;
		if (outcomes.length < operations.length || !outcomes.every(isDeleteSettled))
			result.hasMore = true;
		if (outcomes.length < operations.length) break;
	}
	return result;
}

export function buildBelowReceiptDeletes(
	table: string,
	organizationId: string,
	generations: readonly Omit<OlderGeneration, "organization_id">[],
): DeleteOperation[] {
	return buildKeyedDeleteOperations({
		table,
		organizationId,
		columns: SOURCE_SESSION_GENERATION_COLUMNS,
		keys: generations.map((generation) => [
			generation.user_id,
			generation.source,
			generation.session_id,
			generation.revision,
			generation.parser_version,
		]),
	});
}

export async function runRetirementDeletes(
	executor: ClickHouseExecutor,
	operations: readonly DeleteOperation[],
	options: { signal?: AbortSignal; deadline?: MaintenanceDeadline },
	chain = false,
): Promise<DeleteOutcome[]> {
	const outcomes: DeleteOutcome[] = [];
	for (const operation of operations) {
		options.signal?.throwIfAborted();
		if (!hasKeyedDeleteTime(options.deadline)) break;
		const outcome = await runDeleteOperation(executor, operation, {
			deferWhilePending: true,
			skipWhenNoRows: true,
			reconcileBudgetMs: reconcileBudget(options.deadline),
			signal: options.signal,
		});
		outcomes.push(outcome);
		if (chain && !isDeleteSettled(outcome)) break;
	}
	return outcomes;
}

export function groupByOrganization<Row extends { organization_id: string }>(
	rows: readonly Row[],
): Map<string, Row[]> {
	const groups = new Map<string, Row[]>();
	for (const row of rows) {
		const group = groups.get(row.organization_id) ?? [];
		group.push(row);
		groups.set(row.organization_id, group);
	}
	return groups;
}
