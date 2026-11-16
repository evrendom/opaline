import { Buffer } from "node:buffer";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "../analysis/run-index-sql.js";
import { newestGenerations } from "../transcript-generations/generations.js";
import { sessionScopeId } from "./l1-edge-ids.js";
import { enqueueL1EdgeSessionScopes } from "./l1-edge-queue.service.js";
import { RUN_INDEX_TABLE } from "./l1-edge-tables.js";

/**
 * The run index backfill behind `backfill:run-index` (docs/l1-literal-schema.md,
 * "Scale"): queues a `run_index` build, at backfill priority, for every
 * session with a committed transcript-records generation whose committed run
 * index snapshot is missing or was built from another transcript generation,
 * index version or pricing version. It reads the transcripts, not the edges:
 * a session without git evidence never gets a session edge build, so it
 * would never get a run index from the edges' requests. The daily census
 * covers only recently ingested sessions and usage changes.
 *
 * - Preview by default: it reads ClickHouse and the queue and reports what
 *   it would queue; `execute` queues.
 * - Bounded: one ClickHouse statement returns at most `maxSessions`
 *   sessions in key order; `next` names where the following run continues
 *   (`after`), since queued sessions stay missing until the worker builds
 *   them. The worker does the work: claims take live scopes first.
 * - Skips scopes already waiting for a build (pending, failing or parked)
 *   and scopes frozen at this generation (over the record bound), which
 *   would only freeze again.
 */

const SOURCES = new Set(["claude_code", "codex"]);
/** Scope ids read from the queue per statement. */
const SCOPE_READ_BATCH = 1_000;
const SELECTION_SETTINGS = {
	join_use_nulls: 0,
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

export type RunIndexBackfillReason =
	| "missing"
	| "generation"
	| "index_version"
	| "pricing_version";

export interface RunIndexBackfillCursor {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
}

export interface RunIndexBackfillOptions {
	readonly organizationId?: string;
	readonly maxSessions: number;
	readonly after?: RunIndexBackfillCursor;
	readonly signal?: AbortSignal;
}

export interface RunIndexBackfillResult {
	status: "preview" | "queued";
	organizationId: string | null;
	indexVersion: number;
	pricingVersion: string;
	/** Sessions whose committed run index is missing or stale. */
	candidates: number;
	byReason: Record<RunIndexBackfillReason, number>;
	/** Already waiting for a build (pending, failing or parked): left alone. */
	alreadyQueued: number;
	/** Frozen at this generation (over the record bound): left alone. */
	frozen: number;
	/** Queued (or, in a preview, to queue). */
	queued: number;
	/** The statement returned `maxSessions`: continue with `--after next`. */
	hasMore: boolean;
	next: string | null;
}

export const RunIndexBackfillRowSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	session_id: z.string(),
	source: z.string(),
	revision_text: z.string(),
	parser_version: z.coerce.number(),
	reason: z.enum(["missing", "generation", "index_version", "pricing_version"]),
});
export type RunIndexBackfillRow = z.infer<typeof RunIndexBackfillRowSchema>;

const ScopeRowSchema = z.object({
	scope_id: z.string(),
	pending: z.boolean(),
	frozen_reason: z.string().nullable(),
	input: z.unknown(),
});

/**
 * Sessions with a committed transcript generation (the newest receipt)
 * whose committed run index receipt (newest generation and build, as
 * readers pick it) is missing or of another generation, index or pricing
 * version, in key order after `after`, at most `limit`.
 */
export function buildRunIndexBackfillStatement(input: {
	readonly organizationId?: string;
	readonly after?: RunIndexBackfillCursor;
	readonly limit: number;
}): ClickHouseStatement {
	const organizationFilter =
		input.organizationId === undefined
			? ""
			: "AND organization_id = {organizationId:String}";
	const afterFilter =
		input.after === undefined
			? ""
			: "AND (records.organization_id, records.user_id, records.session_id) > ({afterOrganizationId:String}, {afterUserId:String}, {afterSessionId:String})";
	const joined = (alias: string) =>
		`records.organization_id = ${alias}.organization_id AND records.user_id = ${alias}.user_id AND records.session_id = ${alias}.session_id`;
	return {
		clickhouse_settings: {
			...SELECTION_SETTINGS,
			max_result_rows: String(input.limit),
		},
		query: `WITH records AS (
				${newestGenerations({ columns: "any(source) AS session_source", and: organizationFilter })}
			),
			indexed AS (
				SELECT organization_id, user_id, session_id, toUInt8(1) AS present,
					argMax(tuple(revision, parser_version, index_version, pricing_version),
						tuple(revision, parser_version, index_version, build_revision)) AS committed
				FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
				WHERE row_kind = 'receipt' ${organizationFilter}
				GROUP BY organization_id, user_id, session_id
			)
			SELECT records.organization_id AS organization_id, records.user_id AS user_id,
				records.session_id AS session_id, records.session_source AS source,
				toString(records.generation.1) AS revision_text, records.generation.2 AS parser_version,
				multiIf(indexed.present = 0, 'missing',
					tuple(indexed.committed.1, indexed.committed.2) != records.generation, 'generation',
					indexed.committed.3 != {indexVersion:UInt16}, 'index_version',
					'pricing_version') AS reason
			FROM records
			LEFT JOIN indexed ON ${joined("indexed")}
			WHERE (indexed.present = 0
				OR tuple(indexed.committed.1, indexed.committed.2) != records.generation
				OR indexed.committed.3 != {indexVersion:UInt16}
				OR indexed.committed.4 != {pricingVersion:String})
				${afterFilter}
			ORDER BY organization_id, user_id, session_id
			LIMIT {limit:UInt32}`,
		query_params: {
			afterOrganizationId: input.after?.organizationId ?? "",
			afterSessionId: input.after?.sessionId ?? "",
			afterUserId: input.after?.userId ?? "",
			indexVersion: RUN_INDEX_VERSION,
			limit: input.limit,
			organizationId: input.organizationId ?? "",
			pricingVersion: RUN_INDEX_PRICING_VERSION,
		},
	};
}

export function validateRunIndexBackfillOptions(
	options: RunIndexBackfillOptions,
): void {
	if (!Number.isSafeInteger(options.maxSessions) || options.maxSessions < 1)
		throw new Error("maxSessions must be a positive integer");
	if (options.organizationId !== undefined && options.organizationId === "")
		throw new Error("organizationId must not be empty");
	if (
		options.after !== undefined &&
		options.organizationId !== undefined &&
		options.after.organizationId !== options.organizationId
	)
		throw new Error("after must name a session of organizationId");
}

/** Reads what a run would queue; never writes. */
export function previewRunIndexBackfill(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: RunIndexBackfillOptions,
): Promise<RunIndexBackfillResult> {
	return runBackfill(executor, sql, options, false);
}

/** Queues the run index builds the selection finds, at backfill priority. */
export function backfillRunIndex(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: RunIndexBackfillOptions,
): Promise<RunIndexBackfillResult> {
	return runBackfill(executor, sql, options, true);
}

async function runBackfill(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: RunIndexBackfillOptions,
	execute: boolean,
): Promise<RunIndexBackfillResult> {
	validateRunIndexBackfillOptions(options);
	const rows = z.array(RunIndexBackfillRowSchema).parse(
		await executor.query<unknown>({
			...buildRunIndexBackfillStatement({
				organizationId: options.organizationId,
				after: options.after,
				limit: options.maxSessions,
			}),
			abortSignal: options.signal,
		}),
	);
	const result: RunIndexBackfillResult = {
		status: execute ? "queued" : "preview",
		organizationId: options.organizationId ?? null,
		indexVersion: RUN_INDEX_VERSION,
		pricingVersion: RUN_INDEX_PRICING_VERSION,
		candidates: rows.length,
		byReason: {
			missing: 0,
			generation: 0,
			index_version: 0,
			pricing_version: 0,
		},
		alreadyQueued: 0,
		frozen: 0,
		queued: 0,
		hasMore: rows.length >= options.maxSessions,
		next: null,
	};
	const last = rows.at(-1);
	if (result.hasMore && last)
		result.next = encodeRunIndexBackfillCursor({
			organizationId: last.organization_id,
			userId: last.user_id,
			sessionId: last.session_id,
		});
	for (const row of rows) result.byReason[row.reason]++;

	for (const [organizationId, sessions] of groupByOrganization(rows)) {
		options.signal?.throwIfAborted();
		const wanted = await selectQueueable(sql, organizationId, sessions);
		result.alreadyQueued += wanted.alreadyQueued;
		result.frozen += wanted.frozen;
		if (!execute) {
			result.queued += wanted.sessions.length;
			continue;
		}
		result.queued += await enqueueL1EdgeSessionScopes(
			sql,
			"run_index",
			organizationId,
			wanted.sessions.map((row) => ({
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
			})),
			{ priority: 1 },
		);
	}
	return result;
}

/**
 * The sessions of one workspace worth queueing: not already waiting for a
 * build, and not frozen at the generation they would build.
 */
export async function selectQueueable(
	sql: postgres.Sql,
	organizationId: string,
	rows: readonly RunIndexBackfillRow[],
): Promise<{
	sessions: RunIndexBackfillRow[];
	alreadyQueued: number;
	frozen: number;
}> {
	const valid = rows.filter((row) => SOURCES.has(row.source));
	const byScope = new Map(
		valid.map((row) => [
			sessionScopeId({
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
			}),
			row,
		]),
	);
	const ids = [...byScope.keys()];
	const states = new Map<string, z.infer<typeof ScopeRowSchema>>();
	for (let offset = 0; offset < ids.length; offset += SCOPE_READ_BATCH) {
		const found = z.array(ScopeRowSchema).parse(
			await sql.unsafe(
				`SELECT scope_id, request_count > built_request_count AS pending, frozen_reason, input
				 FROM l1_edge_scope
				 WHERE organization_id = $1 AND scope_kind = 'run_index' AND scope_id = ANY($2::text[])`,
				[organizationId, ids.slice(offset, offset + SCOPE_READ_BATCH)],
			),
		);
		for (const state of found) states.set(state.scope_id, state);
	}
	const sessions: RunIndexBackfillRow[] = [];
	let alreadyQueued = 0;
	let frozen = 0;
	for (const [scopeId, row] of byScope) {
		const state = states.get(scopeId);
		if (state?.pending) {
			alreadyQueued++;
			continue;
		}
		if (state?.frozen_reason && frozenAt(state.input, row)) {
			frozen++;
			continue;
		}
		sessions.push(row);
	}
	return { sessions, alreadyQueued, frozen };
}

const FrozenInputSchema = z.object({
	generation: z.object({
		revision: z.string(),
		parserVersion: z.number(),
		indexVersion: z.number(),
	}),
});

/** Whether a frozen build recorded exactly the generation this row would build. */
function frozenAt(input: unknown, row: RunIndexBackfillRow): boolean {
	const parsed = FrozenInputSchema.safeParse(input);
	return (
		parsed.success &&
		parsed.data.generation.revision === row.revision_text &&
		parsed.data.generation.parserVersion === row.parser_version &&
		parsed.data.generation.indexVersion === RUN_INDEX_VERSION
	);
}

function groupByOrganization(
	rows: readonly RunIndexBackfillRow[],
): Map<string, RunIndexBackfillRow[]> {
	const groups = new Map<string, RunIndexBackfillRow[]>();
	for (const row of rows) {
		const group = groups.get(row.organization_id) ?? [];
		group.push(row);
		groups.set(row.organization_id, group);
	}
	return groups;
}

/** An opaque `--after` value: the last session of a run, in key order. */
export function encodeRunIndexBackfillCursor(
	cursor: RunIndexBackfillCursor,
): string {
	return Buffer.from(
		JSON.stringify([cursor.organizationId, cursor.userId, cursor.sessionId]),
	).toString("base64url");
}

export function decodeRunIndexBackfillCursor(
	value: string,
): RunIndexBackfillCursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		parsed = undefined;
	}
	const tuple = z
		.tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
		.safeParse(parsed);
	if (!tuple.success)
		throw new Error("--after must be the `next` value a previous run printed.");
	const [organizationId, userId, sessionId] = tuple.data;
	return { organizationId, userId, sessionId };
}
