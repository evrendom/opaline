import { getLogger } from "@logtape/logtape";
import {
	createSplitStats,
	decodeTranscriptRecordsReceipt,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
	TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	type TranscriptRecordDraft,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { persistGitObservationsBestEffort } from "./git-observation-extraction.service.js";
import { TranscriptRecordsDeadlineExceededError } from "./transcript-records-deadline.js";
import {
	hashTranscriptContent,
	TRANSCRIPT_RECORDS_TABLE,
	writeTranscriptRecords,
} from "./transcript-records-ingest.service.js";

/**
 * Bounded, resumable backfill of `rudel.transcript_records` from the raw
 * session tables.
 *
 * - Bounded: a hard census cap, a per-session byte cap, and batches limited by
 *   rows and raw bytes, so memory and ClickHouse scans stay predictable.
 * - Resumable: a session is skipped when its newest receipt already matches the
 *   newest raw revision and the current parser version, so an interrupted run
 *   is resumed by running it again.
 * - Idempotent: writes are keyed rows plus a receipt written last.
 * - Expansion-bounded: like ingest, one session may expand to at most
 *   `maxRows` records and must finish within `sessionTimeoutMs`; a session that
 *   does not is skipped and reported, never published half-indexed.
 * - Fenced: every insert is preceded by the deletion-fence check
 *   (`assertWritable`), so rows buffered before an account or organization
 *   deletion are never published after it; see the fence comment in
 *   `clickhouse-purge-tombstone.service.ts`.
 */

const logger = getLogger(["rudel", "api", "transcript-records-backfill"]);

const MAX_ISSUES = 100;
const SOURCE_SCAN_SETTINGS = {
	max_bytes_to_read: String(16 * 1024 * 1024 * 1024),
	max_execution_time: 300,
	max_rows_to_read: "5000000",
	result_overflow_mode: "throw",
} as const;
const RECEIPT_SCAN_SETTINGS = {
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_execution_time: 60,
	max_rows_to_read: "10000000",
	result_overflow_mode: "throw",
} as const;

export interface TranscriptRecordsBackfillOptions {
	/** Deletion fence, awaited before every insert; throws while a purge exists. */
	readonly assertWritable: (target: {
		readonly organizationId: string;
		readonly userId: string;
	}) => Promise<void>;
	readonly batchMaxBytes: number;
	readonly batchMaxRows: number;
	/** Only raw revisions ingested at or before this instant are considered. */
	readonly cutoff: Date;
	/** Records one session may expand to; more is a bounded skip. */
	readonly maxRows: number;
	readonly maxSessionBytes: number;
	readonly maxSessions: number;
	readonly onProgress?: (progress: TranscriptRecordsBackfillProgress) => void;
	readonly organizationId?: string;
	readonly now?: () => Date;
	readonly signal?: AbortSignal;
	/** Wall-clock budget for indexing one session; more is a bounded skip. */
	readonly sessionTimeoutMs: number;
	readonly textBudgetChars?: number;
	readonly textMaxChars?: number;
}

export interface TranscriptRecordsBackfillProgress {
	readonly batchCount: number;
	readonly completedBatchCount: number;
	readonly processedCandidateCount: number;
	readonly totalCandidateCount: number;
}

export type TranscriptRecordsBackfillIssueCode =
	| "deletion_fenced"
	| "expansion_limit"
	| "session_deadline"
	| "oversized_snapshot"
	| "snapshot_superseded"
	| "missing_raw_snapshot"
	| "unexpected_error";

export interface TranscriptRecordsBackfillIssue {
	readonly code: TranscriptRecordsBackfillIssueCode;
	readonly detail: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
}

export interface TranscriptRecordsBackfillResult {
	alreadyCompleteCount: number;
	candidateCount: number;
	completedCount: number;
	cutoff: string;
	failedCount: number;
	/** Sessions skipped because their account or organization is being deleted. */
	fencedCount: number;
	issues: TranscriptRecordsBackfillIssue[];
	parserVersion: number;
	rawSessionCount: number;
	rowsWritten: number;
	/** Sessions skipped for exceeding the expansion or time bound. */
	skippedCount: number;
	status: "completed" | "preview";
	supersededCount: number;
	wouldWriteCount: number;
}

interface Candidate {
	readonly contentBytes: number;
	readonly organizationId: string;
	readonly revision: string;
	readonly sessionDate: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly userId: string;
}

interface CandidateRow {
	content_bytes: number;
	max_revision: string;
	latest_session_date: string;
	organization_id: string;
	session_id: string;
	user_id: string;
}

interface RawRow {
	content: string;
	revision_text: string;
	session_id: string;
	subagents: Record<string, string> | null;
	user_id: string;
}

interface ReceiptRow {
	head: string;
	parser_version: number;
	revision_text: string;
	session_id: string;
	user_id: string;
}

interface Batch {
	readonly candidates: readonly Candidate[];
	readonly contentBytes: number;
	readonly monthEnd: string;
	readonly monthStart: string;
}

export function previewTranscriptRecordsBackfill(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsBackfillOptions,
): Promise<TranscriptRecordsBackfillResult> {
	return runBackfill(executor, options, false);
}

export function backfillTranscriptRecords(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsBackfillOptions,
): Promise<TranscriptRecordsBackfillResult> {
	return runBackfill(executor, options, true);
}

async function runBackfill(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsBackfillOptions,
	execute: boolean,
): Promise<TranscriptRecordsBackfillResult> {
	validateOptions(options);
	const census = await listCandidates(executor, options);
	const result: TranscriptRecordsBackfillResult = {
		alreadyCompleteCount: 0,
		candidateCount: census.candidates.length,
		completedCount: 0,
		cutoff: options.cutoff.toISOString(),
		failedCount: 0,
		fencedCount: 0,
		issues: [],
		parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		rawSessionCount: census.rawSessionCount,
		rowsWritten: 0,
		skippedCount: 0,
		status: execute ? "completed" : "preview",
		supersededCount: 0,
		wouldWriteCount: 0,
	};

	const readable: Candidate[] = [];
	for (const candidate of census.candidates) {
		if (candidate.contentBytes > options.maxSessionBytes) {
			recordIssue(result, candidate, "oversized_snapshot", {
				detail: `${candidate.contentBytes} > ${options.maxSessionBytes}`,
			});
			continue;
		}
		readable.push(candidate);
	}

	const batches = createBatches(readable, options);
	let processed = census.candidates.length - readable.length;
	for (const [batchIndex, batch] of batches.entries()) {
		options.signal?.throwIfAborted();
		const receipts = await readReceipts(executor, batch, options.signal);
		const pending = batch.candidates.filter((candidate) => {
			const receipt = receipts.get(identity(candidate));
			if (
				receipt !== undefined &&
				receipt.revision === candidate.revision &&
				receipt.parserVersion === TRANSCRIPT_RECORDS_PARSER_VERSION
			) {
				result.alreadyCompleteCount++;
				return false;
			}
			return true;
		});
		if (!execute) {
			result.wouldWriteCount += pending.length;
		} else if (pending.length > 0) {
			await processBatch(executor, batch, pending, options, result);
		}
		processed += batch.candidates.length;
		options.onProgress?.({
			batchCount: batches.length,
			completedBatchCount: batchIndex + 1,
			processedCandidateCount: processed,
			totalCandidateCount: census.candidates.length,
		});
	}
	return result;
}

async function processBatch(
	executor: ClickHouseExecutor,
	batch: Batch,
	pending: readonly Candidate[],
	options: TranscriptRecordsBackfillOptions,
	result: TranscriptRecordsBackfillResult,
): Promise<void> {
	const rawRows = await readRawSessions(executor, batch, pending, options);
	const rawByIdentity = new Map(
		rawRows.map((row) => [`${row.user_id}\u0000${row.session_id}`, row]),
	);
	for (const candidate of pending) {
		options.signal?.throwIfAborted();
		const raw = rawByIdentity.get(identity(candidate));
		if (raw === undefined) {
			recordIssue(result, candidate, "missing_raw_snapshot", {
				detail: "Raw snapshot was not returned by the batch read",
			});
			continue;
		}
		if (raw.revision_text !== candidate.revision) {
			result.supersededCount++;
			recordIssue(result, candidate, "snapshot_superseded", {
				detail: `${candidate.revision} -> ${raw.revision_text}`,
			});
			continue;
		}
		try {
			const now = options.now ?? (() => new Date());
			const deadlineAt = now().getTime() + options.sessionTimeoutMs;
			const subagents = raw.subagents ?? {};
			const stats = createSplitStats();
			const write = await writeTranscriptRecords(executor, {
				deadlineAt,
				now,
				signal: options.signal,
				assertWritable: () =>
					options.assertWritable({
						organizationId: candidate.organizationId,
						userId: candidate.userId,
					}),
				contentSha256: hashTranscriptContent(raw.content, subagents),
				drafts: boundDrafts(
					splitSessionTranscript(
						{
							content: raw.content,
							sessionDate: toIsoUtc(candidate.sessionDate),
							source: candidate.source,
							subagents,
							textBudgetChars:
								options.textBudgetChars ??
								TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
							textMaxChars:
								options.textMaxChars ?? TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
						},
						stats,
					),
					options,
				),
				organizationId: candidate.organizationId,
				revision: candidate.revision,
				sessionDate: toIsoUtc(candidate.sessionDate),
				sessionId: candidate.sessionId,
				source: candidate.source,
				summary: () => summarizeSplit(stats),
				userId: candidate.userId,
			});
			result.completedCount++;
			result.rowsWritten += write.rowCount;
			await persistGitObservationsBestEffort(executor, {
				...candidate,
				signal: options.signal,
				assertWritable: () => options.assertWritable(candidate),
			});
		} catch (error) {
			options.signal?.throwIfAborted();
			if (
				error instanceof SessionBoundExceededError ||
				error instanceof TranscriptRecordsDeadlineExceededError
			) {
				result.skippedCount++;
				recordIssue(
					result,
					candidate,
					error instanceof SessionBoundExceededError
						? error.code
						: "session_deadline",
					{ detail: error.message },
				);
				continue;
			}
			if (error instanceof ClickHouseWriteFencedError) {
				result.fencedCount++;
				recordIssue(result, candidate, "deletion_fenced", {
					detail: "Account or organization deletion is in progress",
				});
				continue;
			}
			logger.error(
				"Transcript records backfill failed for a session (organization_id={organizationId} session_id={sessionId} error={error})",
				{
					error: error instanceof Error ? error.message : String(error),
					organizationId: candidate.organizationId,
					sessionId: candidate.sessionId,
				},
			);
			recordIssue(result, candidate, "unexpected_error", {
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function listCandidates(
	executor: ClickHouseExecutor,
	options: TranscriptRecordsBackfillOptions,
): Promise<{ candidates: Candidate[]; rawSessionCount: number }> {
	const [claude, codex] = await Promise.all([
		listSourceCandidates(executor, "claude_code", options),
		listSourceCandidates(executor, "codex", options),
	]);
	const candidates = [...claude, ...codex].sort(compareCandidates);
	if (candidates.length > options.maxSessions) {
		throw new Error(
			`Transcript records backfill census exceeds maxSessions=${options.maxSessions} (raw=${candidates.length}); narrow it with --organization-id or raise the cap`,
		);
	}
	return { candidates, rawSessionCount: candidates.length };
}

async function listSourceCandidates(
	executor: ClickHouseExecutor,
	source: TranscriptSource,
	options: TranscriptRecordsBackfillOptions,
): Promise<Candidate[]> {
	const organizationFilter = options.organizationId
		? "AND raw.organization_id = {organizationId:String}"
		: "";
	const subagentBytes =
		source === "claude_code"
			? "arraySum(arrayMap(value -> length(value), mapValues(raw.subagents)))"
			: "0";
	const rows = await executor.query<CandidateRow>({
		abortSignal: options.signal,
		clickhouse_settings: {
			...SOURCE_SCAN_SETTINGS,
			max_result_rows: String(options.maxSessions + 1),
		},
		query: `
			SELECT
				raw.organization_id,
				raw.user_id,
				raw.session_id,
				toString(max(raw.revision)) AS max_revision,
				toString(argMax(raw.session_date, raw.revision)) AS latest_session_date,
				argMax(length(raw.content) + ${subagentBytes}, raw.revision) AS content_bytes
			FROM ${getRawTable(source)} AS raw
			WHERE raw.ingested_at <= {cutoff:DateTime64(3, 'UTC')}
				${organizationFilter}
			GROUP BY raw.organization_id, raw.user_id, raw.session_id
			ORDER BY raw.organization_id, raw.user_id, raw.session_id
			LIMIT {candidateLimit:UInt32}
		`,
		query_params: {
			candidateLimit: options.maxSessions + 1,
			cutoff: toClickHouseTimestamp(options.cutoff),
			organizationId: options.organizationId ?? "",
		},
	});
	return rows.map((row) => ({
		contentBytes: Number(row.content_bytes),
		organizationId: row.organization_id,
		revision: row.max_revision,
		sessionDate: row.latest_session_date,
		sessionId: row.session_id,
		source,
		userId: row.user_id,
	}));
}

/** Newest committed generation per session: newest raw revision, then parser. */
async function readReceipts(
	executor: ClickHouseExecutor,
	batch: Batch,
	abortSignal: AbortSignal | undefined,
): Promise<Map<string, { parserVersion: number; revision: string }>> {
	const first = batch.candidates[0];
	if (first === undefined) return new Map();
	const rows = await executor.query<ReceiptRow>({
		abortSignal,
		clickhouse_settings: RECEIPT_SCAN_SETTINGS,
		query: `
			SELECT
				user_id,
				session_id,
				toString(revision) AS revision_text,
				parser_version,
				head
			FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND user_id IN {userIds:Array(String)}
				AND session_id IN {sessionIds:Array(String)}
				AND agent_id = ''
				AND record_idx = {receiptRecordIdx:UInt32}
				AND block_idx = 0
			ORDER BY user_id, session_id, revision DESC, parser_version DESC
			LIMIT 1 BY user_id, session_id
		`,
		query_params: {
			organizationId: first.organizationId,
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			sessionIds: batch.candidates.map((candidate) => candidate.sessionId),
			userIds: [
				...new Set(batch.candidates.map((candidate) => candidate.userId)),
			],
		},
	});
	const receipts = new Map<
		string,
		{ parserVersion: number; revision: string }
	>();
	for (const row of rows) {
		if (decodeTranscriptRecordsReceipt(row.head) !== undefined) {
			receipts.set(`${row.user_id}\u0000${row.session_id}`, {
				parserVersion: Number(row.parser_version),
				revision: row.revision_text,
			});
		}
	}
	return receipts;
}

async function readRawSessions(
	executor: ClickHouseExecutor,
	batch: Batch,
	pending: readonly Candidate[],
	options: TranscriptRecordsBackfillOptions,
): Promise<readonly RawRow[]> {
	const first = pending[0];
	if (first === undefined) return [];
	const subagentsColumn =
		first.source === "claude_code"
			? "raw.subagents"
			: "CAST(map(), 'Map(String, String)') AS subagents";
	return executor.query<RawRow>({
		abortSignal: options.signal,
		clickhouse_settings: {
			max_bytes_to_read: SOURCE_SCAN_SETTINGS.max_bytes_to_read,
			max_execution_time: 180,
			max_result_bytes: String(
				Math.max(
					16 * 1024 * 1024,
					Math.min(options.maxSessionBytes * 2, batch.contentBytes * 2),
				),
			),
			max_result_rows: String(pending.length),
			max_rows_to_read: SOURCE_SCAN_SETTINGS.max_rows_to_read,
			result_overflow_mode: "throw",
		},
		query: `
			SELECT
				raw.user_id,
				raw.session_id,
				raw.content,
				${subagentsColumn},
				toString(raw.revision) AS revision_text
			FROM ${getRawTable(first.source)} AS raw
			WHERE raw.organization_id = {organizationId:String}
				AND raw.session_date >= {monthStart:DateTime64(3, 'UTC')}
				AND raw.session_date < {monthEnd:DateTime64(3, 'UTC')}
				AND raw.session_id IN {sessionIds:Array(String)}
				AND raw.ingested_at <= {cutoff:DateTime64(3, 'UTC')}
			ORDER BY raw.organization_id, raw.user_id, raw.session_id, raw.revision DESC
			LIMIT 1 BY raw.organization_id, raw.user_id, raw.session_id
			LIMIT {batchLimit:UInt32}
		`,
		query_params: {
			batchLimit: pending.length,
			cutoff: toClickHouseTimestamp(options.cutoff),
			monthEnd: batch.monthEnd,
			monthStart: batch.monthStart,
			organizationId: first.organizationId,
			sessionIds: pending.map((candidate) => candidate.sessionId),
		},
	});
}

function createBatches(
	candidates: readonly Candidate[],
	options: Pick<
		TranscriptRecordsBackfillOptions,
		"batchMaxBytes" | "batchMaxRows"
	>,
): readonly Batch[] {
	const batches: Batch[] = [];
	let current: Candidate[] = [];
	let currentBytes = 0;
	let currentMonth = "";
	const flush = () => {
		if (current.length === 0) return;
		batches.push({
			candidates: current,
			contentBytes: currentBytes,
			...monthBounds(currentMonth),
		});
		current = [];
		currentBytes = 0;
	};
	for (const candidate of candidates) {
		const first = current[0];
		const month = candidate.sessionDate.slice(0, 7);
		const groupChanged =
			first !== undefined &&
			(first.source !== candidate.source ||
				first.organizationId !== candidate.organizationId ||
				currentMonth !== month);
		const full =
			current.length >= options.batchMaxRows ||
			(current.length > 0 &&
				currentBytes + candidate.contentBytes > options.batchMaxBytes);
		if (groupChanged || full) flush();
		if (current.length === 0) currentMonth = month;
		current.push(candidate);
		currentBytes += candidate.contentBytes;
	}
	flush();
	return batches;
}

function recordIssue(
	result: TranscriptRecordsBackfillResult,
	candidate: Candidate,
	code: TranscriptRecordsBackfillIssueCode,
	detail: { readonly detail: string },
): void {
	if (
		code !== "snapshot_superseded" &&
		code !== "deletion_fenced" &&
		code !== "expansion_limit" &&
		code !== "session_deadline"
	) {
		result.failedCount++;
	}
	if (result.issues.length < MAX_ISSUES) {
		result.issues.push({
			code,
			detail: detail.detail,
			sessionId: candidate.sessionId,
			source: candidate.source,
		});
	}
}

function validateOptions(options: TranscriptRecordsBackfillOptions): void {
	for (const [name, value] of [
		["batchMaxBytes", options.batchMaxBytes],
		["batchMaxRows", options.batchMaxRows],
		["maxRows", options.maxRows],
		["maxSessionBytes", options.maxSessionBytes],
		["maxSessions", options.maxSessions],
		["sessionTimeoutMs", options.sessionTimeoutMs],
	] as const) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${name} must be a positive integer`);
		}
	}
	if (Number.isNaN(options.cutoff.getTime())) {
		throw new Error("cutoff must be a valid date");
	}
}

class SessionBoundExceededError extends Error {
	constructor(
		readonly code: "expansion_limit",
		message: string,
	) {
		super(message);
		this.name = "SessionBoundExceededError";
	}
}

/**
 * The same bounds the ingest worker enforces, applied to the lazy splitter:
 * the row cap counts every draft; the writer owns the whole-operation deadline.
 */
function* boundDrafts(
	drafts: Iterable<TranscriptRecordDraft>,
	limits: Pick<TranscriptRecordsBackfillOptions, "maxRows">,
): Generator<TranscriptRecordDraft> {
	let rows = 0;
	for (const draft of drafts) {
		rows++;
		if (rows > limits.maxRows) {
			throw new SessionBoundExceededError(
				"expansion_limit",
				`Transcript expands to more than ${limits.maxRows} records`,
			);
		}
		yield draft;
	}
}

function compareCandidates(left: Candidate, right: Candidate): number {
	return (
		left.source.localeCompare(right.source) ||
		left.organizationId.localeCompare(right.organizationId) ||
		left.sessionDate.localeCompare(right.sessionDate) ||
		left.userId.localeCompare(right.userId) ||
		left.sessionId.localeCompare(right.sessionId)
	);
}

function identity(candidate: Candidate): string {
	return `${candidate.userId}\u0000${candidate.sessionId}`;
}

function getRawTable(source: TranscriptSource): string {
	return getSafeClickHouseTable(
		source === "claude_code" ? "rudel.claude_sessions" : "rudel.codex_sessions",
	);
}

function monthBounds(month: string): { monthEnd: string; monthStart: string } {
	const [year, monthNumber] = month.split("-").map(Number);
	if (!year || !monthNumber) throw new Error(`Invalid session month: ${month}`);
	const start = new Date(Date.UTC(year, monthNumber - 1, 1));
	const end = new Date(Date.UTC(year, monthNumber, 1));
	return {
		monthEnd: toClickHouseTimestamp(end),
		monthStart: toClickHouseTimestamp(start),
	};
}

/** ClickHouse `toString(DateTime64)` output, read as UTC. */
function toIsoUtc(value: string): string {
	return new Date(`${value.replace(" ", "T")}Z`).toISOString();
}

function toClickHouseTimestamp(value: Date): string {
	return value.toISOString().replace("T", " ").replace("Z", "");
}
