import {
	decodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { Generation } from "./transcript-generations/generations.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	selectRetiredGenerations,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
	TRANSCRIPT_RECORDS_TABLE,
} from "./transcript-records-ingest.service.js";
import { buildTranscriptRecordsRetirementCensusStatement } from "./transcript-records-retirement.service.js";

/**
 * The operator drain behind `retire:transcript-records`: retires every
 * superseded transcript-records generation of one organization (or all) that
 * the daily pass would retire, instead of ten sessions a day, so a backfill
 * does not leave storage doubled.
 *
 * - Same rules as publication and the daily pass: the census is the daily
 *   pass's (sessions whose newest receipt is past the grace), and each
 *   session's generations go through `selectRetiredGenerations` with the
 *   same grace (`TRANSCRIPT_RECORDS_RETIRE_GRACE_MS`), measured from the
 *   publication that superseded each one, at the time of its page. The
 *   committed generation and anything newer (a build in flight) are never
 *   touched, so a pinned reader keeps its rows until its deadline.
 * - Bounded: one census statement per run (at most `maxSessions`), then pages
 *   of `pageSize` sessions of one organization, each one generation read by
 *   key and one lightweight DELETE of at most 100 generations, waited for
 *   (`lightweight_deletes_sync = 1`) and spaced by `pauseMs`, so mutations
 *   never pile up.
 * - Resumable: a retired session drops out of the census, so running again
 *   continues where an interrupted or capped run stopped.
 * - Preview by default: without `execute` it only reads and reports what it
 *   would retire.
 */

export const RETIREMENT_DRAIN_MAX_PAGE_SIZE = 100;
/**
 * A lightweight DELETE waits for its mutation, which rewrites the row mask of
 * every part it touches: minutes on a large table, whatever the page size.
 */
export const RETIREMENT_DELETE_MAX_EXECUTION_SECONDS = 600;
/** The client wait the drain's executor needs for its DELETEs. */
export const RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS =
	(RETIREMENT_DELETE_MAX_EXECUTION_SECONDS + 60) * 1000;
const CENSUS_SETTINGS = {
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;
const PAGE_SETTINGS = {
	max_bytes_to_read: String(4 * 1024 * 1024 * 1024),
	max_execution_time: 60,
	max_rows_to_read: "50000000",
	result_overflow_mode: "throw",
} as const;

export interface TranscriptRecordsRetirementDrainOptions {
	readonly execute: boolean;
	/** Sessions the census may return; more is reported as `hasMore`. */
	readonly maxSessions: number;
	readonly organizationId?: string;
	/** Sessions per page: one generation read and one DELETE (at most 100). */
	readonly pageSize: number;
	/** Wait between executed pages. */
	readonly pauseMs: number;
	readonly now?: () => number;
	readonly onProgress?: (progress: {
		readonly processedSessions: number;
		readonly totalSessions: number;
		readonly generations: number;
	}) => void;
	readonly signal?: AbortSignal;
	readonly sleep?: (ms: number) => Promise<void>;
}

export interface TranscriptRecordsRetirementDrainResult {
	status: "preview" | "completed";
	organizationId: string | null;
	/** The census read sessions whose newest receipt was published before this. */
	retireBefore: string;
	/** Sessions the census found with a superseded generation past the grace. */
	sessionCount: number;
	/** The census found more than `maxSessions`; run again after this one. */
	hasMore: boolean;
	/** Sessions with at least one generation retired (or, in a preview, to retire). */
	sessionsRetired: number;
	/** Sessions found by the census where nothing could be retired yet. */
	sessionsHeld: number;
	generations: number;
	committedGenerations: number;
	/** Generations without a receipt (crashed attempts), retired at once. */
	uncommittedGenerations: number;
	/** Records of the committed generations, from their receipts. */
	rows: number;
	deleteStatements: number;
}

interface CensusRow {
	organization_id: string;
	user_id: string;
	session_id: string;
}

export interface RetirementGenerationRow {
	user_id: string;
	session_id: string;
	revision_text: string;
	parser_version: number;
	receipt_head: string;
}

export interface Retirement {
	readonly userId: string;
	readonly sessionId: string;
	readonly generation: Generation;
	readonly rows: number | null;
}

export function validateRetirementDrainOptions(
	options: Pick<
		TranscriptRecordsRetirementDrainOptions,
		"maxSessions" | "pageSize" | "pauseMs" | "organizationId"
	>,
): void {
	if (!Number.isSafeInteger(options.maxSessions) || options.maxSessions < 1)
		throw new Error("maxSessions must be a positive integer");
	if (
		!Number.isSafeInteger(options.pageSize) ||
		options.pageSize < 1 ||
		options.pageSize > RETIREMENT_DRAIN_MAX_PAGE_SIZE
	)
		throw new Error(
			`pageSize must be between 1 and ${RETIREMENT_DRAIN_MAX_PAGE_SIZE}`,
		);
	if (!Number.isSafeInteger(options.pauseMs) || options.pauseMs < 0)
		throw new Error("pauseMs must be a non-negative integer");
	if (options.organizationId !== undefined && options.organizationId === "")
		throw new Error("organizationId must not be empty");
}

export async function drainTranscriptRecordsRetirement(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsRetirementDrainOptions,
): Promise<TranscriptRecordsRetirementDrainResult> {
	validateRetirementDrainOptions(options);
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const retireBefore = now() - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS;
	const census = await executor.query<CensusRow>({
		...buildTranscriptRecordsRetirementCensusStatement({
			limit: options.maxSessions + 1,
			organizationId: options.organizationId,
			retireBefore,
			settings: {
				...CENSUS_SETTINGS,
				max_result_rows: String(options.maxSessions + 1),
			},
		}),
		abortSignal: options.signal,
	});
	const sessions = census.slice(0, options.maxSessions);
	const result: TranscriptRecordsRetirementDrainResult = {
		status: options.execute ? "completed" : "preview",
		organizationId: options.organizationId ?? null,
		retireBefore: new Date(retireBefore).toISOString(),
		sessionCount: sessions.length,
		hasMore: census.length > options.maxSessions,
		sessionsRetired: 0,
		sessionsHeld: 0,
		generations: 0,
		committedGenerations: 0,
		uncommittedGenerations: 0,
		rows: 0,
		deleteStatements: 0,
	};
	let processed = 0;
	for (const page of pages(sessions, options.pageSize)) {
		options.signal?.throwIfAborted();
		const organizationId = page[0]?.organization_id ?? "";
		const retirements = await selectPageRetirements(
			executor,
			organizationId,
			page,
			now(),
			options.signal,
		);
		const retiredSessions = new Set(
			retirements.map((retirement) =>
				sessionKey(retirement.userId, retirement.sessionId),
			),
		);
		result.sessionsRetired += retiredSessions.size;
		result.sessionsHeld += page.length - retiredSessions.size;
		for (const retirement of retirements) {
			result.generations++;
			if (retirement.rows === null) result.uncommittedGenerations++;
			else {
				result.committedGenerations++;
				result.rows += retirement.rows;
			}
		}
		if (options.execute && retirements.length > 0) {
			for (const chunk of chunks(
				retirements,
				MAX_RETIRED_GENERATIONS_PER_PASS,
			)) {
				await executor.execute(
					buildRetirementDelete(organizationId, chunk, options.signal),
				);
				result.deleteStatements++;
			}
			if (options.pauseMs > 0) await sleep(options.pauseMs);
		}
		processed += page.length;
		options.onProgress?.({
			processedSessions: processed,
			totalSessions: sessions.length,
			generations: result.generations,
		});
	}
	return result;
}

/**
 * Per session of the page, its generations newest first (read by key), the
 * committed one (newest with a receipt), and what `selectRetiredGenerations`
 * retires below it at `nowMs`. Generations newer than the committed one are
 * builds in flight and are never considered.
 */
export async function selectPageRetirements(
	executor: ClickHouseExecutor,
	organizationId: string,
	page: readonly CensusRow[],
	nowMs: number,
	signal: AbortSignal | undefined,
): Promise<Retirement[]> {
	const rows = await executor.query<RetirementGenerationRow>({
		abortSignal: signal,
		clickhouse_settings: {
			...PAGE_SETTINGS,
			max_result_rows: String(
				page.length * (MAX_RETIRED_GENERATIONS_PER_PASS + 2),
			),
		},
		query: `
			SELECT user_id, session_id, toString(revision) AS revision_text, parser_version,
				anyIf(head, kind = 'receipt' AND agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0) AS receipt_head
			FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND user_id IN {userIds:Array(String)}
				AND session_id IN {sessionIds:Array(String)}
			GROUP BY user_id, session_id, revision, parser_version
			ORDER BY user_id, session_id, revision DESC, parser_version DESC
			LIMIT {generationLimit:UInt32} BY user_id, session_id
		`,
		query_params: {
			generationLimit: MAX_RETIRED_GENERATIONS_PER_PASS + 2,
			organizationId,
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			sessionIds: [...new Set(page.map((row) => row.session_id))],
			userIds: [...new Set(page.map((row) => row.user_id))],
		},
	});
	const wanted = new Set(
		page.map((row) => sessionKey(row.user_id, row.session_id)),
	);
	const bySession = new Map<string, RetirementGenerationRow[]>();
	for (const row of rows) {
		const key = sessionKey(row.user_id, row.session_id);
		if (!wanted.has(key)) continue;
		const list = bySession.get(key) ?? [];
		list.push(row);
		bySession.set(key, list);
	}
	const retirements: Retirement[] = [];
	for (const generations of bySession.values()) {
		retirements.push(...selectSessionRetirements(generations, nowMs));
	}
	return retirements;
}

/** One session's generations (any order) → what retires at `nowMs`. */
export function selectSessionRetirements(
	generations: readonly RetirementGenerationRow[],
	nowMs: number,
): Retirement[] {
	const newestFirst = [...generations].sort(
		(left, right) =>
			compareUInt64(right.revision_text, left.revision_text) ||
			right.parser_version - left.parser_version,
	);
	const decoded = newestFirst.map((row) => ({
		row,
		receipt: row.receipt_head
			? decodeTranscriptRecordsReceipt(row.receipt_head)
			: undefined,
	}));
	const committedIndex = decoded.findIndex(
		(entry) => entry.receipt !== undefined,
	);
	const committed = decoded[committedIndex];
	if (committed?.receipt === undefined) return [];
	const publishedAtMs = Date.parse(committed.receipt.publishedAt);
	if (!Number.isFinite(publishedAtMs)) return [];
	const older = decoded.slice(committedIndex + 1);
	const selected = selectRetiredGenerations(
		older.map((entry) => ({
			generation: entry,
			publishedAtMs:
				entry.receipt === undefined
					? null
					: Date.parse(entry.receipt.publishedAt),
		})),
		{
			graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
			now: new Date(nowMs),
			publishedAtMs,
		},
	);
	return selected.map(({ row, receipt }) => ({
		userId: row.user_id,
		sessionId: row.session_id,
		generation: {
			revision: row.revision_text,
			parserVersion: Number(row.parser_version),
		},
		rows: receipt === undefined ? null : receipt.rowCount,
	}));
}

/** One lightweight DELETE for the given generations of one organization. */
export function buildRetirementDelete(
	organizationId: string,
	retirements: readonly Retirement[],
	abortSignal?: AbortSignal,
) {
	const params: Record<string, unknown> = {
		organizationId,
		sessionIds: [...new Set(retirements.map((entry) => entry.sessionId))],
	};
	const clauses = retirements.map((entry, index) => {
		params[`userId${index}`] = entry.userId;
		params[`sessionId${index}`] = entry.sessionId;
		params[`revision${index}`] = entry.generation.revision;
		params[`parserVersion${index}`] = entry.generation.parserVersion;
		return `(user_id = {userId${index}:String} AND session_id = {sessionId${index}:String} AND revision = {revision${index}:UInt64} AND parser_version = {parserVersion${index}:UInt16})`;
	});
	return {
		abortSignal,
		clickhouse_settings: {
			lightweight_deletes_sync: "1",
			max_execution_time: RETIREMENT_DELETE_MAX_EXECUTION_SECONDS,
		},
		query: `
			DELETE FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND session_id IN {sessionIds:Array(String)}
				AND (${clauses.join(" OR ")})
		`,
		query_params: params,
	};
}

/** Pages of at most `size` consecutive sessions of one organization. */
function* pages(
	sessions: readonly CensusRow[],
	size: number,
): Generator<CensusRow[]> {
	let page: CensusRow[] = [];
	for (const session of sessions) {
		if (
			page.length >= size ||
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

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
	for (let index = 0; index < items.length; index += size)
		yield items.slice(index, index + size);
}

function sessionKey(userId: string, sessionId: string): string {
	return `${userId}\u0000${sessionId}`;
}

function compareUInt64(left: string, right: string): number {
	const a = BigInt(left);
	const b = BigInt(right);
	return a === b ? 0 : a < b ? -1 : 1;
}
