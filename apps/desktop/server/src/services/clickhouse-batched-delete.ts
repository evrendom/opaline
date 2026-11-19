import { createHash } from "node:crypto";
import {
	ClickHouseError,
	type ClickHouseSettings,
	TupleParam,
} from "@clickhouse/client-web";
import { getLogger } from "@logtape/logtape";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";

// A lightweight DELETE's mutation visits every part of the table whatever its
// key count; parameters must fit PARAM_BYTES_PER_STATEMENT (96 KiB).
export const DELETE_KEYS_PER_STATEMENT = 256;

export const KEYED_DELETE_MAX_EXECUTION_SECONDS = 60;

const RECONCILE_BUDGET_MS = 60_000;
const RECONCILE_POLL_MS = 5_000;
const CHECK_TIMEOUT_MS = 20_000;
const CHECK_SETTINGS = {
	max_execution_time: 20,
	timeout_before_checking_execution_speed: 0,
} as const satisfies ClickHouseSettings;

// After these the mutation a DELETE submitted may still run or have run.
const UNKNOWN_OUTCOME_CODES = new Set([
	"159",
	"209",
	"210",
	"216",
	"341",
	"394",
	"999",
]);

const logger = getLogger(["rudel", "api", "clickhouse-batched-delete"]);

export type KeyedDeleteColumnType = "String" | "UInt16" | "UInt64";

export interface KeyedDeleteColumn {
	readonly name: string;
	readonly type: KeyedDeleteColumnType;
}

export type KeyedDeleteKey = readonly (string | number)[];

export interface DeleteOperation {
	readonly table: string;
	readonly operationId: string;
	readonly keyCount: number;
	readonly mutationMarker: string;
	readonly predicate: string;
	readonly queryParams: Record<string, unknown>;
	readonly settings: ClickHouseSettings;
}

export type DeleteOutcomeStatus =
	| "completed"
	| "completed-late"
	| "deferred"
	| "empty"
	| "running"
	| "unresolved";

export interface DeleteOutcome {
	readonly status: DeleteOutcomeStatus;
	readonly table: string;
	readonly operationId: string;
	readonly keyCount: number;
	readonly queryIds: readonly string[];
}

export type DeleteReconciliation = "completed" | "wait" | "resubmit" | "stop";

export function decideDeleteReconciliation(state: {
	readonly rowsRemain: boolean;
	readonly mutationsPending: boolean | null;
	readonly resubmitted: boolean;
	readonly canWait: boolean;
}): DeleteReconciliation {
	if (!state.rowsRemain) return "completed";
	if (state.mutationsPending === true) return state.canWait ? "wait" : "stop";
	if (state.mutationsPending === false && !state.resubmitted) return "resubmit";
	return "stop";
}

export function isUnknownDeleteOutcome(error: unknown): boolean {
	if (error instanceof ClickHouseError)
		return UNKNOWN_OUTCOME_CODES.has(error.code);
	if (!(error instanceof Error)) return false;
	if (/^ClickHouse request failed with HTTP 4\d\d\b/u.test(error.message))
		return false;
	return true;
}

export function deleteQueryId(operationId: string, attempt: number): string {
	return `opaline-delete-${operationId}-${attempt}`;
}

export function buildKeyedDeleteOperations(input: {
	readonly table: string;
	readonly organizationId: string;
	readonly columns: readonly KeyedDeleteColumn[];
	readonly keys: readonly KeyedDeleteKey[];
	readonly maxExecutionSeconds?: number;
	readonly keysPerStatement?: number;
}): DeleteOperation[] {
	const table = getSafeClickHouseTable(input.table);
	if (input.columns.length === 0) throw new Error("No key columns");
	const keysPerStatement = input.keysPerStatement ?? DELETE_KEYS_PER_STATEMENT;
	const byText = new Map<string, KeyedDeleteKey>();
	for (const key of input.keys) {
		if (key.length !== input.columns.length)
			throw new Error("Key does not match its columns");
		byText.set(JSON.stringify(key.map(String)), key);
	}
	const sorted = [...byText.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([, key]) => key);
	const names = input.columns.map((column) => column.name);
	const types = input.columns.map((column) => column.type);
	const keyExpression = names.length === 1 ? names[0] : `(${names.join(", ")})`;
	const keyType = types.length === 1 ? types[0] : `Tuple(${types.join(", ")})`;
	const predicate = `organization_id = {organizationId:String} AND ${keyExpression} IN {keys:Array(${keyType})}`;
	const operations: DeleteOperation[] = [];
	for (let start = 0; start < sorted.length; start += keysPerStatement) {
		const chunk = sorted.slice(start, start + keysPerStatement);
		const values = chunk.map((key) => {
			const typed = key.map((value, index) =>
				toParamValue(value, types[index] ?? "String"),
			);
			return typed.length === 1 ? typed[0] : new TupleParam(typed);
		});
		operations.push({
			table,
			operationId: deleteOperationId(table, [
				input.organizationId,
				...chunk.map((key) => key.map(String)),
			]),
			keyCount: chunk.length,
			mutationMarker: input.organizationId,
			predicate,
			queryParams: { organizationId: input.organizationId, keys: values },
			settings: {
				lightweight_deletes_sync: "1",
				max_execution_time:
					input.maxExecutionSeconds ?? KEYED_DELETE_MAX_EXECUTION_SECONDS,
				timeout_before_checking_execution_speed: 0,
			},
		});
	}
	return operations;
}

export function deleteOperationId(table: string, content: unknown): string {
	const name = table.slice(table.indexOf(".") + 1);
	const digest = createHash("sha256")
		.update(table)
		.update("\u0000")
		.update(JSON.stringify(content))
		.digest("hex")
		.slice(0, 20);
	return `${name}-${digest}`;
}

export async function runDeleteOperation(
	executor: ClickHouseExecutor,
	operation: DeleteOperation,
	options: {
		readonly signal?: AbortSignal;
		readonly now?: () => number;
		readonly sleep?: (ms: number) => Promise<void>;
		readonly reconcileBudgetMs?: number;
		readonly pollMs?: number;
		readonly deferWhilePending?: boolean;
		readonly skipWhenNoRows?: boolean;
	} = {},
): Promise<DeleteOutcome> {
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const pollMs = options.pollMs ?? RECONCILE_POLL_MS;
	const queryIds: string[] = [];
	const outcome = (status: DeleteOutcomeStatus): DeleteOutcome => {
		const result = {
			status,
			table: operation.table,
			operationId: operation.operationId,
			keyCount: operation.keyCount,
			queryIds,
		};
		const message =
			"ClickHouse DELETE {status} (table={table} operation_id={operationId} keys={keyCount} query_ids={queryIds})";
		const properties = { ...result, queryIds: queryIds.join(",") };
		if (status === "completed" || status === "empty")
			logger.info(message, properties);
		else logger.warn(message, properties);
		return result;
	};
	if (
		options.deferWhilePending &&
		(await readMutationsPending(executor, operation)) === true
	)
		return outcome("deferred");
	if (
		options.skipWhenNoRows &&
		(await readRowsRemain(executor, operation)) === false
	)
		return outcome("empty");
	let resubmitted = false;
	for (let attempt = 1; ; attempt++) {
		const queryId = deleteQueryId(operation.operationId, attempt);
		queryIds.push(queryId);
		try {
			await executor.execute({
				abortSignal: options.signal,
				clickhouse_settings: operation.settings,
				query: `DELETE FROM ${operation.table} WHERE ${operation.predicate}`,
				query_params: operation.queryParams,
				query_id: queryId,
			});
			return outcome(attempt === 1 ? "completed" : "completed-late");
		} catch (error) {
			if (!isUnknownDeleteOutcome(error)) throw error;
			logger.warn(
				"ClickHouse DELETE outcome unknown; reconciling before any resubmission (table={table} operation_id={operationId} query_id={queryId} error={error})",
				{
					table: operation.table,
					operationId: operation.operationId,
					queryId,
					error: error instanceof Error ? error.message.slice(0, 512) : "",
				},
			);
		}
		if (options.signal?.aborted) return outcome("unresolved");
		const reconcileUntil =
			now() + (options.reconcileBudgetMs ?? RECONCILE_BUDGET_MS);
		let decision: DeleteReconciliation;
		let pending: boolean | null = null;
		for (;;) {
			const rowsRemain = await readRowsRemain(executor, operation);
			if (rowsRemain === null) return outcome("unresolved");
			pending = rowsRemain
				? await readMutationsPending(executor, operation)
				: null;
			decision = decideDeleteReconciliation({
				rowsRemain,
				mutationsPending: pending,
				resubmitted,
				canWait: now() + pollMs < reconcileUntil,
			});
			if (decision !== "wait") break;
			await sleep(pollMs);
		}
		if (decision === "completed") return outcome("completed-late");
		if (decision === "stop")
			return outcome(pending === true ? "running" : "unresolved");
		resubmitted = true;
	}
}

async function readRowsRemain(
	executor: ClickHouseExecutor,
	operation: DeleteOperation,
): Promise<boolean | null> {
	try {
		const rows = await executor.query<{ found: number }>({
			abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
			clickhouse_settings: CHECK_SETTINGS,
			query: `SELECT 1 AS found FROM ${operation.table} WHERE ${operation.predicate} LIMIT 1`,
			query_params: operation.queryParams,
		});
		return rows.length > 0;
	} catch (error) {
		logger.warn(
			"Could not read whether a DELETE's rows remain (table={table} operation_id={operationId} error={error})",
			{
				table: operation.table,
				operationId: operation.operationId,
				error: error instanceof Error ? error.message.slice(0, 512) : "",
			},
		);
		return null;
	}
}

// system.mutations of a SharedMergeTree table is the same on every replica.
export async function readMutationsPending(
	executor: ClickHouseExecutor,
	operation: Pick<DeleteOperation, "table" | "mutationMarker" | "operationId">,
): Promise<boolean | null> {
	const dot = operation.table.indexOf(".");
	try {
		const rows = await executor.query<{ pending: number | string }>({
			abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
			clickhouse_settings: CHECK_SETTINGS,
			query: `SELECT count() AS pending FROM system.mutations
				WHERE database = {database:String} AND table = {table:String}
					AND NOT is_done AND position(command, {marker:String}) > 0`,
			query_params: {
				database: operation.table.slice(0, dot),
				table: operation.table.slice(dot + 1),
				marker: operation.mutationMarker,
			},
		});
		return Number(rows[0]?.pending ?? 0) > 0;
	} catch (error) {
		logger.warn(
			"Could not read pending mutations (table={table} operation_id={operationId} error={error})",
			{
				table: operation.table,
				operationId: operation.operationId,
				error: error instanceof Error ? error.message.slice(0, 512) : "",
			},
		);
		return null;
	}
}

export function submittedStatements(
	outcomes: readonly DeleteOutcome[],
): number {
	return outcomes.reduce((sum, outcome) => sum + outcome.queryIds.length, 0);
}

export function isDeleteSettled(outcome: DeleteOutcome): boolean {
	return (
		outcome.status === "completed" ||
		outcome.status === "completed-late" ||
		outcome.status === "empty"
	);
}

export function hasKeyedDeleteTime(
	deadline: MaintenanceDeadline | undefined,
): boolean {
	return (
		deadline === undefined ||
		deadline.now() + KEYED_DELETE_MAX_EXECUTION_SECONDS * 1000 + 5_000 <=
			deadline.deadlineAt
	);
}

export function reconcileBudget(
	deadline: MaintenanceDeadline | undefined,
): number {
	if (deadline === undefined) return RECONCILE_BUDGET_MS;
	return Math.max(
		0,
		Math.min(RECONCILE_BUDGET_MS, deadline.deadlineAt - deadline.now()),
	);
}

function toParamValue(
	value: string | number,
	type: KeyedDeleteColumnType,
): string | number | bigint {
	if (type === "String") return String(value);
	if (type === "UInt64") return BigInt(value);
	return Number(value);
}
