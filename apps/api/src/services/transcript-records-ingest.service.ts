import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import {
	decodeTranscriptRecordsReceipt,
	encodeTranscriptRecordsReceipt,
	type ReceivedSetupText,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
	type TranscriptRecordDraft,
	type TranscriptRecordFacts,
	type TranscriptRecordsReceipt,
	type TranscriptSource,
	type TranscriptSplitSummary,
} from "@rudel/api-routes/transcript-records";
import {
	ingestRudelSetupTexts,
	ingestRudelTranscriptRecords,
	type RudelSetupTextsRow,
	type RudelTranscriptRecordsRow,
} from "@rudel/ch-schema/generated";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { createTranscriptRecordsDeadline } from "./transcript-records-deadline.js";

export const TRANSCRIPT_RECORDS_TABLE = "rudel.transcript_records";

/** Rows and approximate JSON bytes per insert. */
const INSERT_BATCH_MAX_ROWS = 2_000;
/** Received setup texts per insert; each can be up to a mebibyte. */
const SETUP_TEXT_BATCH_MAX_ROWS = 256;
const INSERT_BATCH_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_SCAN_SETTINGS = {
	max_bytes_to_read: String(256 * 1024 * 1024),
	max_execution_time: 30,
	max_rows_to_read: "5000000",
} as const;

/**
 * How long a superseded committed generation stays readable, measured from the
 * publication that superseded it. It must exceed the readers' enforced
 * whole-read deadline (`TRANSCRIPT_READ_DEADLINE_MS`), so a read that pinned a
 * generation can never have its rows deleted before it finishes or times out.
 */
export const TRANSCRIPT_RECORDS_RETIRE_GRACE_MS = 10 * 60_000;
export const MAX_RETIRED_GENERATIONS_PER_PASS = 100;

const logger = getLogger(["rudel", "api", "transcript-records-ingest"]);

export interface TranscriptRecordsIdentity {
	readonly organizationId: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly userId: string;
}

/**
 * One extraction generation of a session: the raw revision the rows came from
 * and the splitter version that produced them. Generations are the unit of
 * publication. The generation is part of the row identity, so rows of different
 * generations never collapse into each other, and a generation that never
 * received its receipt cannot disturb the committed one.
 */
export interface TranscriptRecordsGeneration {
	readonly parserVersion: number;
	/** Raw-session revision as an unsigned decimal string. */
	readonly revision: string;
}

export interface TranscriptRecordsWriteInput extends TranscriptRecordsIdentity {
	readonly deadlineAt?: number;
	readonly signal?: AbortSignal;
	/**
	 * Deletion fence, awaited immediately before every insert. It throws
	 * `ClickHouseWriteFencedError` when the user or organization is being
	 * deleted; the rows already written for this generation are then deleted and
	 * the error is rethrown. Any other error is a transient lookup failure: the
	 * rows stay (they are invisible without a receipt) and the error propagates.
	 */
	readonly assertWritable: () => Promise<void>;
	/**
	 * Names this write attempt inside the insert deduplication tokens. Every
	 * attempt defaults to a fresh one, so rows deleted by an earlier attempt are
	 * never suppressed as duplicates when the generation is rebuilt. Retries of
	 * one insert inside an attempt share its token.
	 */
	readonly attemptId?: string;
	/** Hash of the raw transcript content the drafts were derived from. */
	readonly contentSha256: string;
	/** Clock for receipt timestamps and retirement; tests inject one. */
	readonly now?: () => Date;
	/** Pulled one draft at a time, so a producer can apply backpressure. */
	readonly drafts:
		| AsyncIterable<TranscriptRecordDraft>
		| Iterable<TranscriptRecordDraft>;
	/** Raw-session revision as an unsigned decimal string. */
	readonly revision: string;
	readonly sessionDate: string;
	/** Read once, after every draft was consumed. */
	readonly summary: () => TranscriptSplitSummary;
}

export interface TranscriptRecordsWriteResult {
	readonly batchCount: number;
	readonly rowCount: number;
}

export interface TranscriptRecordsReceiptState
	extends TranscriptRecordsGeneration {
	readonly receipt: TranscriptRecordsReceipt;
}

interface ReceiptRow {
	head: string;
	parser_version: number;
	revision_text: string;
}

/**
 * Write every record of one generation, then its receipt row. The hourly
 * session retirement deletes the generations it superseded.
 *
 * The write is idempotent: rows are keyed by generation, stream, and line, so
 * a retry after a crash converges on the same rows when the table merges. Each
 * attempt has its own deduplication namespace: ClickHouse remembers insert
 * tokens even after the rows are deleted, so a rebuilt generation must never
 * reuse them. The receipt is written only after every batch succeeds, so
 * readers never see a half-written generation, and a half-written generation
 * never merges into the committed one.
 */
export async function writeTranscriptRecords(
	executor: ClickHouseExecutor,
	input: TranscriptRecordsWriteInput,
): Promise<TranscriptRecordsWriteResult> {
	const now = input.now ?? (() => new Date());
	const deadline = createTranscriptRecordsDeadline({
		deadlineAt: input.deadlineAt,
		now: () => now().getTime(),
		signal: input.signal,
	});
	try {
		return await writeGeneration(executor, input, deadline);
	} finally {
		deadline.dispose();
	}
}

async function writeGeneration(
	executor: ClickHouseExecutor,
	input: TranscriptRecordsWriteInput,
	deadline: ReturnType<typeof createTranscriptRecordsDeadline>,
): Promise<TranscriptRecordsWriteResult> {
	deadline.assertActive();
	assertRevision(input.revision);
	const generation: TranscriptRecordsGeneration = {
		parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		revision: input.revision,
	};
	const tokenPrefix = buildDeduplicationTokenPrefix(
		input,
		input.attemptId ?? randomUUID(),
	);
	const now = input.now ?? (() => new Date());
	let batch: RudelTranscriptRecordsRow[] = [];
	let batchBytes = 0;
	let batchCount = 0;
	let rowCount = 0;
	const fence = async () => {
		try {
			await deadline.wait(input.assertWritable);
		} catch (error) {
			// Delete only on a confirmed fence. A transient lookup failure keeps
			// the rows: they are invisible without a receipt and the retry
			// converges on them.
			if (error instanceof ClickHouseWriteFencedError && batchCount > 0) {
				await deleteTranscriptRecordsGeneration(executor, input, generation);
			}
			throw error;
		}
	};
	const publish = async (
		rows:
			| readonly RudelTranscriptRecordsRow[]
			| ((publishedAt: Date) => readonly RudelTranscriptRecordsRow[]),
		deduplicationToken: string,
	) => {
		await fence();
		const publishedAt = now();
		await deadline.wait(() =>
			insertBatch(
				executor,
				typeof rows === "function" ? rows(publishedAt) : rows,
				deduplicationToken,
				deadline.signal,
			),
		);
		return publishedAt;
	};
	const flush = async () => {
		if (batch.length === 0) return;
		await publish(batch, `${tokenPrefix}:${batchCount}`);
		batchCount++;
		batch = [];
		batchBytes = 0;
	};
	// Received setup texts, each distinct one once per generation: the account
	// and workspace purges delete them, readers find them by hash.
	const setupSeen = new Set<string>();
	let setupBatch: RudelSetupTextsRow[] = [];
	let setupBytes = 0;
	let setupBatchCount = 0;
	const flushSetup = async () => {
		if (setupBatch.length === 0) return;
		const rows = setupBatch;
		setupBatch = [];
		setupBytes = 0;
		await fence();
		await deadline.wait(() =>
			insertSetupTexts(
				executor,
				rows,
				`${tokenPrefix}:setup:${setupBatchCount}`,
				deadline.signal,
			),
		);
		setupBatchCount++;
	};
	for await (const draft of input.drafts) {
		deadline.assertActive();
		const row = buildTranscriptRecordRow(input, draft);
		batch.push(row);
		batchBytes += estimateRowBytes(row);
		rowCount++;
		for (const setup of draft.setupTexts ?? []) {
			if (setupSeen.has(setup.sha256)) continue;
			setupSeen.add(setup.sha256);
			setupBatch.push(buildSetupTextRow(input, setup, now()));
			setupBytes += Buffer.byteLength(setup.text, "utf8") + 200;
		}
		if (
			batch.length >= INSERT_BATCH_MAX_ROWS ||
			batchBytes >= INSERT_BATCH_MAX_BYTES
		) {
			await flush();
		}
		if (
			setupBatch.length >= SETUP_TEXT_BATCH_MAX_ROWS ||
			setupBytes >= INSERT_BATCH_MAX_BYTES
		) {
			await flushSetup();
		}
	}
	await flush();
	await flushSetup();

	const summary = input.summary();
	await publish(
		(publishedAt) => [
			buildTranscriptRecordsReceiptRow(input, {
				contentSha256: input.contentSha256,
				lineCount: summary.lineCount,
				oversizedLineCount: summary.oversizedLineCount,
				parserVersion: generation.parserVersion,
				publishedAt: publishedAt.toISOString(),
				rowCount,
				streamCount: summary.streamCount,
				textTruncated: summary.textTruncated,
				unparseableLineCount: summary.unparseableLineCount,
			}),
		],
		`${tokenPrefix}:receipt`,
	);
	logger.info(
		"Transcript records written (organization_id={organizationId} session_id={sessionId} rows={rows} batches={batches})",
		{
			batches: batchCount,
			organizationId: input.organizationId,
			rows: rowCount,
			sessionId: input.sessionId,
		},
	);
	return { batchCount, rowCount };
}

/**
 * The parser v6 fact columns of a record that records none: empty, NULL or an
 * empty map, which mean not recorded.
 */
export function noRecordFacts(): Pick<
	RudelTranscriptRecordsRow,
	| "agent_version"
	| "entrypoint"
	| "denial_kind"
	| "duration_ms"
	| "timed_out_after_ms"
	| "interrupted"
	| "git_operation"
	| "mcp_server"
	| "mcp_tool"
	| "attribution_skill"
	| "facts"
> {
	return {
		agent_version: "",
		entrypoint: "",
		denial_kind: "",
		duration_ms: null,
		timed_out_after_ms: null,
		interrupted: null,
		git_operation: [],
		mcp_server: "",
		mcp_tool: "",
		attribution_skill: "",
		facts: {},
	};
}

/** The parser v6 fact columns of a draft. */
export function recordFactColumns(
	facts: TranscriptRecordFacts,
): ReturnType<typeof noRecordFacts> {
	return {
		agent_version: facts.agentVersion,
		entrypoint: facts.entrypoint,
		denial_kind: facts.denialKind,
		duration_ms: facts.durationMs,
		timed_out_after_ms: facts.timedOutAfterMs,
		interrupted: facts.interrupted,
		git_operation: [...facts.gitOperation],
		mcp_server: facts.mcpServer,
		mcp_tool: facts.mcpTool,
		attribution_skill: facts.attributionSkill,
		facts: { ...facts.extra },
	};
}

export function buildTranscriptRecordRow(
	identity: TranscriptRecordsIdentity & {
		readonly revision: string;
		readonly sessionDate: string;
	},
	draft: TranscriptRecordDraft,
): RudelTranscriptRecordsRow {
	return {
		...recordFactColumns(draft.facts),
		agent_id: draft.agentId,
		block_idx: draft.blockIdx,
		byte_len: draft.byteLen,
		byte_start: String(draft.byteStart),
		call_id: draft.callId,
		command_class: draft.commandClass,
		exit_code: draft.exitCode,
		file_op: draft.fileOp,
		file_path: draft.filePath,
		head: draft.head,
		is_error: draft.isError,
		kind: draft.kind,
		organization_id: identity.organizationId,
		parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
		record_idx: draft.recordIdx,
		record_uuid: draft.recordUuid,
		revision: identity.revision,
		session_date: toClickHouseTimestamp(identity.sessionDate),
		session_id: identity.sessionId,
		source: identity.source,
		spawned_agent_id: draft.spawnedAgentId,
		subtype: draft.subtype,
		tail: draft.tail,
		text: draft.text,
		text_chars: draft.textChars,
		tool_name: draft.toolName,
		ts: toClickHouseTimestamp(draft.ts),
		turn_idx: draft.turnIdx,
		user_id: identity.userId,
	};
}

/** A received setup text as `rudel.setup_texts` stores it: once per member and hash. */
export function buildSetupTextRow(
	identity: TranscriptRecordsIdentity,
	setup: ReceivedSetupText,
	writtenAt: Date,
): RudelSetupTextsRow {
	return {
		organization_id: identity.organizationId,
		user_id: identity.userId,
		version: setup.sha256,
		chars: setup.chars,
		text: setup.text,
		text_cut: setup.cut,
		written_at: toClickHouseTimestamp(writtenAt.toISOString()),
	};
}

export function buildTranscriptRecordsReceiptRow(
	identity: TranscriptRecordsIdentity & {
		readonly revision: string;
		readonly sessionDate: string;
	},
	receipt: TranscriptRecordsReceipt,
): RudelTranscriptRecordsRow {
	return {
		...noRecordFacts(),
		agent_id: "",
		block_idx: 0,
		byte_len: 0,
		byte_start: "0",
		call_id: "",
		command_class: "",
		exit_code: null,
		file_op: "",
		file_path: "",
		head: encodeTranscriptRecordsReceipt(receipt),
		is_error: false,
		kind: "receipt",
		organization_id: identity.organizationId,
		parser_version: receipt.parserVersion,
		record_idx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		record_uuid: "",
		revision: identity.revision,
		session_date: toClickHouseTimestamp(identity.sessionDate),
		session_id: identity.sessionId,
		source: identity.source,
		spawned_agent_id: "",
		subtype: "",
		tail: "",
		text: "",
		text_chars: 0,
		tool_name: "",
		ts: toClickHouseTimestamp(identity.sessionDate),
		turn_idx: 0,
		user_id: identity.userId,
	};
}

/**
 * The committed generation of one session: its newest receipt by raw revision,
 * then parser version. Null when no generation has been published.
 */
export async function readTranscriptRecordsReceipt(
	executor: ClickHouseExecutor,
	identity: Pick<
		TranscriptRecordsIdentity,
		"organizationId" | "sessionId" | "userId"
	>,
): Promise<TranscriptRecordsReceiptState | null> {
	const [row] = await executor.query<ReceiptRow>({
		clickhouse_settings: RECEIPT_SCAN_SETTINGS,
		query: `
			SELECT toString(revision) AS revision_text, parser_version, head
			FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
				AND agent_id = ''
				AND record_idx = {receiptRecordIdx:UInt32}
				AND block_idx = 0
			ORDER BY revision DESC, parser_version DESC
			LIMIT 1
		`,
		query_params: {
			organizationId: identity.organizationId,
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			sessionId: identity.sessionId,
			userId: identity.userId,
		},
	});
	if (!row) return null;
	const receipt = decodeTranscriptRecordsReceipt(row.head);
	return receipt
		? {
				parserVersion: Number(row.parser_version),
				receipt,
				revision: row.revision_text,
			}
		: null;
}

/** True when the newest receipt matches this content and parser version. */
export function hasMatchingTranscriptRecordsReceipt(
	state: TranscriptRecordsReceiptState | null,
	expected: { readonly contentSha256: string; readonly revision?: string },
): boolean {
	return (
		state !== null &&
		state.receipt.parserVersion === TRANSCRIPT_RECORDS_PARSER_VERSION &&
		state.receipt.contentSha256 === expected.contentSha256 &&
		(expected.revision === undefined || state.revision === expected.revision)
	);
}

export function hashTranscriptContent(
	content: string,
	subagents: Readonly<Record<string, string>> = {},
): string {
	const hash = createHash("sha256");
	hash.update(content, "utf8");
	for (const agentId of Object.keys(subagents).sort()) {
		hash.update(`\u0000${agentId}\u0000`, "utf8");
		hash.update(subagents[agentId] ?? "", "utf8");
	}
	return hash.digest("hex");
}

/**
 * Delete every row of one generation only while deletion is under way for the
 * whole target. Ordinary failures must retain shared generations, including a
 * receipt that another writer may have published concurrently.
 */
export async function deleteTranscriptRecordsGeneration(
	executor: ClickHouseExecutor,
	identity: Pick<
		TranscriptRecordsIdentity,
		"organizationId" | "sessionId" | "userId"
	>,
	generation: TranscriptRecordsGeneration,
): Promise<void> {
	await executor.execute({
		clickhouse_settings: { lightweight_deletes_sync: "1" },
		query: `
			DELETE FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
				AND revision = {revision:UInt64}
				AND parser_version = {parserVersion:UInt16}
		`,
		query_params: {
			organizationId: identity.organizationId,
			parserVersion: generation.parserVersion,
			revision: generation.revision,
			sessionId: identity.sessionId,
			userId: identity.userId,
		},
	});
}

/**
 * A generation older than the published one, with when its receipt was
 * published: null when it never committed, NaN when the time is unreadable.
 */
export interface OlderGeneration<Generation> {
	readonly generation: Generation;
	readonly publishedAtMs: number | null;
}

/**
 * Older generations (given newest first) that are garbage or past their
 * grace. Shared by every store whose generations commit with a receipt
 * (transcript records; the run index, whose generation also has an index
 * version).
 */
export function selectRetiredGenerations<Generation>(
	older: readonly OlderGeneration<Generation>[],
	retirement: {
		readonly graceMs: number;
		readonly now: Date;
		readonly publishedAtMs: number;
	},
): Generation[] {
	const retired: Generation[] = [];
	// Publication time of the next newer committed generation: the moment the
	// generation below it stopped being the committed one.
	let supersededAtMs = retirement.publishedAtMs;
	for (const { generation, publishedAtMs } of older) {
		if (publishedAtMs === null) {
			retired.push(generation);
			continue;
		}
		if (supersededAtMs <= retirement.now.getTime() - retirement.graceMs) {
			retired.push(generation);
		}
		// An unreadable timestamp keeps this generation and everything below it
		// for another pass rather than guessing.
		supersededAtMs = Number.isFinite(publishedAtMs)
			? publishedAtMs
			: Number.POSITIVE_INFINITY;
	}
	return retired.slice(0, MAX_RETIRED_GENERATIONS_PER_PASS);
}

async function insertBatch(
	executor: ClickHouseExecutor,
	rows: readonly RudelTranscriptRecordsRow[],
	deduplicationToken: string,
	abortSignal: AbortSignal,
): Promise<void> {
	await ingestRudelTranscriptRecords(
		{
			insert: ({ table, values }) =>
				executor.insert({
					abortSignal,
					asyncInsert: false,
					deduplicationToken,
					table,
					values,
				}),
		},
		[...rows],
		{ validate: false },
	);
}

async function insertSetupTexts(
	executor: ClickHouseExecutor,
	rows: readonly RudelSetupTextsRow[],
	deduplicationToken: string,
	abortSignal: AbortSignal,
): Promise<void> {
	await ingestRudelSetupTexts(
		{
			insert: ({ table, values }) =>
				executor.insert({
					abortSignal,
					asyncInsert: false,
					deduplicationToken,
					table,
					values,
				}),
		},
		[...rows],
		{ validate: false },
	);
}

function buildDeduplicationTokenPrefix(
	input: TranscriptRecordsIdentity & { readonly revision: string },
	attemptId: string,
): string {
	const digest = createHash("sha256")
		.update(
			[
				TRANSCRIPT_RECORDS_TABLE,
				input.organizationId,
				input.userId,
				input.sessionId,
				input.source,
				input.revision,
				TRANSCRIPT_RECORDS_PARSER_VERSION,
				attemptId,
			].join("\u0000"),
		)
		.digest("hex");
	return `transcript-records:${digest}`;
}

function estimateRowBytes(row: RudelTranscriptRecordsRow): number {
	// Typed fact strings and arrays, then the map; JSON adds quotes and separators.
	let factBytes = [
		row.agent_version,
		row.entrypoint,
		row.denial_kind,
		row.mcp_server,
		row.mcp_tool,
		row.attribution_skill,
		...row.git_operation,
	].reduce((total, value) => total + Buffer.byteLength(value, "utf8") + 4, 0);
	for (const [key, value] of Object.entries(row.facts))
		factBytes +=
			Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8") + 6;
	return (
		Buffer.byteLength(row.text, "utf8") +
		Buffer.byteLength(row.head, "utf8") +
		Buffer.byteLength(row.tail, "utf8") +
		Buffer.byteLength(row.file_path, "utf8") +
		factBytes +
		400
	);
}

function assertRevision(revision: string): void {
	if (!/^[1-9]\d*$/u.test(revision)) {
		throw new Error("Transcript records revision must be an unsigned integer");
	}
}

function toClickHouseTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid transcript record timestamp: ${value}`);
	}
	return date.toISOString().replace("T", " ").replace("Z", "");
}
