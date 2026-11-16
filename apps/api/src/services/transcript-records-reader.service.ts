import {
	countCodePoints,
	decodeTranscriptLine,
	decodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES,
	type TranscriptRecordsReceipt,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import {
	type CommittedGeneration,
	readCommittedGenerations,
	type SessionGeneration,
	type TranscriptReadScope,
} from "./transcript-generations/generations.js";
import { readRawTranscriptLine } from "./transcript-raw-line.service.js";
import {
	buildMapCommandsStatement,
	buildMapFilesStatement,
	buildMapPromptsStatement,
	buildMapTurnsStatement,
	buildRecordBlocksStatement,
	buildRecordSliceStatement,
	buildSessionCommandsStatement,
	buildSessionFilesStatement,
	buildSessionTotalsStatement,
	buildTurnActionsStatement,
	buildTurnDiffStatement,
	buildTurnFailuresStatement,
	buildTurnFileChangesStatement,
	buildTurnParentCommandsStatement,
	buildTurnPromptStatement,
	buildTurnRawStatement,
} from "./transcript-records-queries.js";

export type { TranscriptReadScope } from "./transcript-generations/generations.js";

/**
 * Tenant-scoped readers over `rudel.transcript_records`.
 *
 * They return plain typed objects; formatting for an agent is a separate
 * concern. Nothing here calls a model: every number is a count or a value the
 * transcript recorded.
 */

export const TRANSCRIPT_READ_MAX_SESSION_IDS = 200;
export const TRANSCRIPT_READ_MAX_CHARS = 200_000;
export const TRANSCRIPT_READ_MIN_CHARS = 200;
export const TRANSCRIPT_READ_MAX_RECORD_SLICE_CHARS = 200_000;
/**
 * Whole-operation deadline of every reader. A read pins one generation and
 * writers retire a superseded generation only after a grace period longer than
 * this (`TRANSCRIPT_RECORDS_RETIRE_GRACE_MS`), so a pinned generation's rows
 * outlive every read that can still return: one that runs past the deadline
 * fails instead of returning a partial or mixed answer.
 */
export const TRANSCRIPT_READ_DEADLINE_MS = 60_000;

const DEFAULT_AGENT_ID = "";
const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_FILES_PER_TURN = 20;
const DEFAULT_PROMPT_EXCERPT_CHARS = 160;
const COMPACT_ACTION_LIMIT = 300;
const COMPACT_TARGET_CHARS = 160;
const COMPACT_FAILURE_LIMIT = 20;
const COMPACT_FAILURE_EXCERPT_CHARS = 800;
const COMPACT_PROMPT_MAX_CHARS = 2_000;
const ERRORS_VIEW_LIMIT = 100;
const DIFF_VIEW_LIMIT = 200;
const RAW_VIEW_LIMIT = 2_000;
const FILE_CHANGE_LIST_LIMIT = 200;

export type CommandClassName =
	| "test"
	| "build"
	| "lint"
	| "typecheck"
	| "git"
	| "migrate"
	| "install"
	| "other";

export interface CommandStats {
	readonly count: number;
	readonly failed: number;
}

export type CommandStatsByClass = Partial<
	Record<CommandClassName, CommandStats>
>;

export interface FileList {
	readonly count: number;
	/** Sorted distinct paths, capped; `count` is the uncapped total. */
	readonly paths: readonly string[];
}

export interface SessionFacts {
	/** Per class: tool calls and failed results. */
	readonly commands: CommandStatsByClass;
	readonly endedAt: string | null;
	readonly filesChanged: FileList;
	/** False when the session has no committed generation; other fields are empty. */
	readonly indexed: boolean;
	/** Splitter version of the generation this read used. */
	readonly parserVersion: number | null;
	readonly receipt: TranscriptRecordsReceipt | null;
	readonly records: number;
	readonly revision: string | null;
	readonly sessionId: string;
	readonly source: TranscriptSource | null;
	readonly startedAt: string | null;
	readonly subagents: {
		readonly agentIds: readonly string[];
		readonly spawned: number;
	};
	readonly tests: { readonly failed: number; readonly run: number };
	readonly toolCalls: number;
	readonly toolErrors: number;
	/** Genuine human prompts in the main transcript. */
	readonly turns: number;
}

export interface SessionMapTurn {
	/** Exclusive end of the turn's byte range in the stream's raw content. */
	readonly byteEnd: number;
	readonly byteStart: number;
	readonly commands: CommandStatsByClass;
	readonly endedAt: string;
	readonly filesChanged: FileList;
	readonly firstRecordIdx: number;
	readonly lastRecordIdx: number;
	readonly promptChars: number;
	/** First prompt of the turn as one truncated line. Empty for turn 0. */
	readonly promptExcerpt: string;
	readonly startedAt: string;
	readonly subagentSpawns: number;
	readonly toolCalls: number;
	readonly toolErrors: number;
	/** 1-based; 0 holds records before the first human prompt. */
	readonly turnIdx: number;
}

export interface SessionMap {
	readonly agentId: string;
	readonly indexed: boolean;
	readonly parserVersion: number | null;
	readonly revision: string | null;
	readonly sessionId: string;
	readonly source: TranscriptSource | null;
	readonly turns: readonly SessionMapTurn[];
}

export type TurnView = "compact" | "errors" | "diff" | "raw";

export interface TurnPrompt {
	readonly chars: number;
	readonly recordIdx: number;
	readonly text: string;
	readonly truncated: boolean;
}

export interface TurnAction {
	readonly at: string;
	readonly blockIdx: number;
	readonly callId: string;
	readonly commandClass: string;
	readonly exitCode: number | null;
	readonly fileOp: string;
	readonly filePath: string;
	readonly recordIdx: number;
	/**
	 * `no_result` when the transcript never recorded an output for the call;
	 * `running` when its latest output says the process was still running.
	 */
	readonly status: "error" | "no_result" | "ok" | "running";
	/** File path for file tools, otherwise the first line of the command or input. */
	readonly target: string;
	readonly tool: string;
}

export interface TurnFailure {
	readonly blockIdx: number;
	readonly callId: string;
	readonly commandClass: string;
	readonly exitCode: number | null;
	/** Tail of the failed output (or its head when the output is short). */
	readonly excerpt: string;
	readonly kind: string;
	readonly recordIdx: number;
	readonly textChars: number;
	readonly tool: string;
}

export interface TurnChangedFile {
	readonly blockIdx: number;
	readonly callId: string;
	readonly operation: string;
	readonly origin: string;
	readonly path: string;
	readonly recordIdx: number;
	readonly tool: string;
}

export interface TurnFileChange extends TurnChangedFile {
	/** Command that made a shell-inferred change, when the change has no input. */
	readonly command: string | null;
	/** Tool input: patch hunk, edit strings, or written content. */
	readonly input: string;
	readonly inputChars: number;
	readonly inputTruncated: boolean;
}

export interface TurnRawRecord {
	readonly blockIdx: number;
	readonly byteLen: number;
	readonly byteStart: number;
	readonly callId: string;
	readonly commandClass: string;
	readonly exitCode: number | null;
	readonly filePath: string;
	readonly isError: boolean;
	readonly kind: string;
	readonly recordIdx: number;
	readonly subtype: string;
	readonly text: string;
	readonly textChars: number;
	readonly textTruncated: boolean;
	readonly tool: string;
}

export interface TurnDetail {
	readonly actions: readonly TurnAction[];
	readonly agentId: string;
	readonly changedFiles: readonly TurnChangedFile[];
	readonly changes: readonly TurnFileChange[];
	readonly failures: readonly TurnFailure[];
	readonly found: boolean;
	readonly parserVersion: number | null;
	readonly prompt: TurnPrompt | null;
	readonly records: readonly TurnRawRecord[];
	readonly revision: string | null;
	readonly sessionId: string;
	/** True when the `maxChars` budget or a row limit cut any emitted content off. */
	readonly truncated: boolean;
	readonly turnIdx: number;
	readonly view: TurnView;
}

export interface RecordBlock {
	readonly blockIdx: number;
	readonly kind: string;
	readonly textChars: number;
}

export interface RecordSlice {
	readonly agentId: string;
	readonly blockIdx: number | null;
	readonly blocks: readonly RecordBlock[];
	readonly byteLen: number;
	readonly byteStart: number;
	readonly exitCode: number | null;
	readonly filePath: string;
	readonly found: boolean;
	/** Requested range, in Unicode characters of the decoded text. */
	readonly from: number;
	readonly isError: boolean;
	readonly kind: string | null;
	readonly recordIdx: number;
	readonly sessionId: string;
	readonly subtype: string;
	readonly text: string;
	/** Characters in the full decoded text before the storage cap. */
	readonly textChars: number;
	/**
	 * True when the slice came from the raw transcript line because storage
	 * kept fewer characters than the range asked for.
	 */
	readonly textFromRaw: boolean;
	/** True when the slice still lacks characters the record has (storage capped, raw unavailable). */
	readonly textTruncatedInStorage: boolean;
	readonly to: number;
	readonly tool: string;
	readonly turnIdx: number;
}

interface ReaderOptions {
	readonly executor?: ClickHouseExecutor;
	readonly generation?: SessionGeneration;
}

/**
 * Resolve each session's committed generation with one query. Every read
 * operation calls this exactly once and binds the result into all of its
 * later queries, so its response comes from a single generation even when a
 * newer one is published while it runs. Sessions without a receipt are absent.
 */
async function resolveGenerations(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): Promise<Map<string, CommittedGeneration>> {
	const rows = await readCommittedGenerations(executor, scope, sessionIds);
	return new Map(rows.map((row) => [row.sessionId, row]));
}

export function readSessionFacts(
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
	options: ReaderOptions & { readonly maxFiles?: number } = {},
): Promise<readonly SessionFacts[]> {
	return withReadDeadline("readSessionFacts", () =>
		runSessionFactsRead(scope, sessionIds, options),
	);
}

export function readSessionMap(
	scope: TranscriptReadScope,
	sessionId: string,
	options: ReaderOptions & {
		readonly agentId?: string;
		readonly maxFilesPerTurn?: number;
		readonly promptExcerptChars?: number;
	} = {},
): Promise<SessionMap> {
	return withReadDeadline("readSessionMap", () =>
		runSessionMapRead(scope, sessionId, options),
	);
}

export function readTurn(
	scope: TranscriptReadScope,
	sessionId: string,
	turnIdx: number,
	view: TurnView,
	maxChars: number,
	options: ReaderOptions & { readonly agentId?: string } = {},
): Promise<TurnDetail> {
	return withReadDeadline("readTurn", () =>
		runTurnRead(scope, sessionId, turnIdx, view, maxChars, options),
	);
}

export function readRecord(
	scope: TranscriptReadScope,
	sessionId: string,
	recordIdx: number,
	fromChar: number,
	toChar: number,
	options: ReaderOptions & {
		readonly agentId?: string;
		readonly blockIdx?: number;
	} = {},
): Promise<RecordSlice> {
	return withReadDeadline("readRecord", () =>
		runRecordRead(scope, sessionId, recordIdx, fromChar, toChar, options),
	);
}

export async function withReadDeadline<T>(
	name: string,
	operation: () => Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`${name} exceeded its ${TRANSCRIPT_READ_DEADLINE_MS} ms deadline`,
					),
				),
			TRANSCRIPT_READ_DEADLINE_MS,
		);
	});
	try {
		return await Promise.race([operation(), deadline]);
	} finally {
		clearTimeout(timer);
	}
}

async function runSessionFactsRead(
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
	options: ReaderOptions & { readonly maxFiles?: number } = {},
): Promise<readonly SessionFacts[]> {
	assertScope(scope);
	const ids = [...new Set(sessionIds)];
	if (ids.length > TRANSCRIPT_READ_MAX_SESSION_IDS) {
		throw new RangeError(
			`readSessionFacts accepts at most ${TRANSCRIPT_READ_MAX_SESSION_IDS} sessions`,
		);
	}
	if (ids.length === 0) return [];
	const executor = options.executor ?? getClickhouse();
	const maxFiles = clampInteger(options.maxFiles, DEFAULT_MAX_FILES, 0, 1_000);
	const latestBySession = await resolveGenerations(executor, scope, ids);
	const generations = [...latestBySession.values()];
	const [totals, commands, files] =
		generations.length === 0
			? [[], [], []]
			: await Promise.all([
					executor.query<unknown>(
						buildSessionTotalsStatement(scope, generations),
					),
					executor.query<unknown>(
						buildSessionCommandsStatement(scope, generations),
					),
					executor.query<unknown>(
						buildSessionFilesStatement(scope, generations, maxFiles),
					),
				]);
	const totalsBySession = new Map(
		parseRows(totalsRow, totals).map((row) => [row.session_id, row]),
	);
	const filesBySession = new Map(
		parseRows(sessionFilesRow, files).map((row) => [row.session_id, row]),
	);
	const commandsBySession = new Map<string, CommandStatsByClass>();
	for (const row of parseRows(sessionCommandsRow, commands)) {
		const byClass = commandsBySession.get(row.session_id) ?? {};
		commandsBySession.set(row.session_id, {
			...byClass,
			[row.command_class]: { count: row.calls, failed: row.failed },
		});
	}

	return ids.map((sessionId): SessionFacts => {
		const latestRow = latestBySession.get(sessionId);
		const total = totalsBySession.get(sessionId);
		if (latestRow === undefined || total === undefined) {
			return emptyFacts(sessionId);
		}
		const byClass = commandsBySession.get(sessionId) ?? {};
		const fileRow = filesBySession.get(sessionId);
		const agentIds = [
			...new Set([...total.stream_agent_ids, ...total.spawned_agent_ids]),
		].sort();
		return {
			commands: byClass,
			endedAt: toIso(total.ended_ms),
			filesChanged: {
				count: fileRow?.file_count ?? 0,
				paths: fileRow?.files ?? [],
			},
			indexed: true,
			parserVersion: latestRow.parserVersion,
			receipt: decodeTranscriptRecordsReceipt(latestRow.receipt) ?? null,
			records: total.records,
			revision: latestRow.revision,
			sessionId,
			source: toSource(latestRow.source),
			startedAt: toIso(total.started_ms),
			subagents: { agentIds, spawned: total.subagent_spawns },
			tests: {
				failed: byClass.test?.failed ?? 0,
				run: byClass.test?.count ?? 0,
			},
			toolCalls: total.tool_calls,
			toolErrors: total.tool_errors,
			turns: total.turns,
		};
	});
}

async function runSessionMapRead(
	scope: TranscriptReadScope,
	sessionId: string,
	options: ReaderOptions & {
		readonly agentId?: string;
		readonly maxFilesPerTurn?: number;
		readonly promptExcerptChars?: number;
	} = {},
): Promise<SessionMap> {
	assertScope(scope);
	const agentId = options.agentId ?? DEFAULT_AGENT_ID;
	const executor = options.executor ?? getClickhouse();
	const maxFilesPerTurn = clampInteger(
		options.maxFilesPerTurn,
		DEFAULT_MAX_FILES_PER_TURN,
		0,
		200,
	);
	const excerptChars = clampInteger(
		options.promptExcerptChars,
		DEFAULT_PROMPT_EXCERPT_CHARS,
		20,
		1_000,
	);
	const generation = (
		await resolveGenerations(executor, scope, [sessionId])
	).get(sessionId);
	if (generation === undefined) {
		return {
			agentId,
			indexed: false,
			parserVersion: null,
			revision: null,
			sessionId,
			source: null,
			turns: [],
		};
	}
	const [turns, prompts, files, commands] = await Promise.all([
		executor.query<unknown>(buildMapTurnsStatement(scope, generation, agentId)),
		executor.query<unknown>(
			buildMapPromptsStatement(scope, generation, agentId),
		),
		executor.query<unknown>(
			buildMapFilesStatement(scope, generation, agentId, maxFilesPerTurn),
		),
		executor.query<unknown>(
			buildMapCommandsStatement(scope, generation, agentId),
		),
	]);
	const promptByTurn = new Map(
		parseRows(mapPromptRow, prompts).map((row) => [
			row.turn_idx,
			row.prompt_head,
		]),
	);
	const filesByTurn = new Map(
		parseRows(mapFilesRow, files).map((row) => [row.turn_idx, row]),
	);
	const commandsByTurn = new Map<number, CommandStatsByClass>();
	for (const row of parseRows(mapCommandsRow, commands)) {
		commandsByTurn.set(row.turn_idx, {
			...(commandsByTurn.get(row.turn_idx) ?? {}),
			[row.command_class]: { count: row.calls, failed: row.failed },
		});
	}
	return {
		agentId,
		indexed: true,
		parserVersion: generation.parserVersion,
		revision: generation.revision,
		sessionId,
		source: toSource(generation.source),
		turns: parseRows(mapTurnRow, turns).map((row): SessionMapTurn => {
			const fileRow = filesByTurn.get(row.turn_idx);
			return {
				byteEnd: row.byte_end,
				byteStart: row.first_byte_start,
				commands: commandsByTurn.get(row.turn_idx) ?? {},
				endedAt: toIso(row.ended_ms) ?? "",
				filesChanged: {
					count: fileRow?.file_count ?? 0,
					paths: fileRow?.files ?? [],
				},
				firstRecordIdx: row.first_record_idx,
				lastRecordIdx: row.last_record_idx,
				promptChars: row.prompt_chars,
				promptExcerpt: toSingleLine(
					promptByTurn.get(row.turn_idx) ?? "",
					excerptChars,
				),
				startedAt: toIso(row.started_ms) ?? "",
				subagentSpawns: row.subagent_spawns,
				toolCalls: row.tool_calls,
				toolErrors: row.tool_errors,
				turnIdx: row.turn_idx,
			};
		}),
	};
}

async function runTurnRead(
	scope: TranscriptReadScope,
	sessionId: string,
	turnIdx: number,
	view: TurnView,
	maxChars: number,
	options: ReaderOptions & { readonly agentId?: string } = {},
): Promise<TurnDetail> {
	assertScope(scope);
	assertNonNegativeInteger(turnIdx, "turnIdx");
	const agentId = options.agentId ?? DEFAULT_AGENT_ID;
	const executor = options.executor ?? getClickhouse();
	const budget = createBudget(
		clampInteger(
			maxChars,
			4_000,
			TRANSCRIPT_READ_MIN_CHARS,
			TRANSCRIPT_READ_MAX_CHARS,
		),
	);
	const base = {
		actions: [],
		agentId,
		changedFiles: [],
		changes: [],
		failures: [],
		found: false,
		parserVersion: null,
		prompt: null,
		records: [],
		revision: null,
		sessionId,
		truncated: false,
		turnIdx,
		view,
	} satisfies TurnDetail;
	const generation =
		options.generation ??
		(await resolveGenerations(executor, scope, [sessionId])).get(sessionId);
	if (generation === undefined) return base;
	const pinned: TurnDetail = {
		...base,
		parserVersion: generation.parserVersion,
		revision: generation.revision,
	};

	switch (view) {
		case "compact":
			return readCompactTurn(executor, scope, generation, pinned, budget);
		case "errors":
			return readErrorsTurn(executor, scope, generation, pinned, budget);
		case "diff":
			return readDiffTurn(executor, scope, generation, pinned, budget);
		case "raw":
			return readRawTurn(executor, scope, generation, pinned, budget);
	}
}

async function runRecordRead(
	scope: TranscriptReadScope,
	sessionId: string,
	recordIdx: number,
	fromChar: number,
	toChar: number,
	options: ReaderOptions & {
		readonly agentId?: string;
		readonly blockIdx?: number;
	} = {},
): Promise<RecordSlice> {
	assertScope(scope);
	assertNonNegativeInteger(recordIdx, "recordIdx");
	assertNonNegativeInteger(fromChar, "fromChar");
	if (!Number.isSafeInteger(toChar) || toChar <= fromChar) {
		throw new RangeError("toChar must be greater than fromChar");
	}
	const charCount = Math.min(
		toChar - fromChar,
		TRANSCRIPT_READ_MAX_RECORD_SLICE_CHARS,
	);
	const agentId = options.agentId ?? DEFAULT_AGENT_ID;
	const executor = options.executor ?? getClickhouse();
	const empty: RecordSlice = {
		agentId,
		blockIdx: null,
		blocks: [],
		byteLen: 0,
		byteStart: 0,
		exitCode: null,
		filePath: "",
		found: false,
		from: fromChar,
		isError: false,
		kind: null,
		recordIdx,
		sessionId,
		subtype: "",
		text: "",
		textChars: 0,
		textFromRaw: false,
		textTruncatedInStorage: false,
		to: fromChar + charCount,
		tool: "",
		turnIdx: 0,
	};
	const generation =
		options.generation ??
		(await resolveGenerations(executor, scope, [sessionId])).get(sessionId);
	if (generation === undefined) return empty;
	const blocks = parseRows(
		recordBlockRow,
		await executor.query<unknown>(
			buildRecordBlocksStatement(scope, generation, agentId, recordIdx),
		),
	);
	const requested =
		options.blockIdx === undefined
			? (blocks.find((block) => block.text_chars > 0) ?? blocks[0])
			: blocks.find((block) => block.block_idx === options.blockIdx);
	const described = { ...empty, blocks: blocks.map(toRecordBlock) };
	if (requested === undefined) return described;
	const [slice] = parseRows(
		recordSliceRow,
		await executor.query<unknown>(
			buildRecordSliceStatement(
				scope,
				generation,
				agentId,
				recordIdx,
				requested.block_idx,
				fromChar,
				charCount,
			),
		),
	);
	const storedChars = slice?.stored_chars ?? 0;
	// Storage kept less than the range asks for: read the record's exact raw
	// line from the generation's own raw revision and decode it again.
	const needsRaw =
		storedChars < requested.text_chars && fromChar + charCount > storedChars;
	const raw = needsRaw
		? await readRecordTextFromRaw(executor, scope, sessionId, generation, {
				agentId,
				block: requested,
			})
		: undefined;
	return {
		...described,
		blockIdx: requested.block_idx,
		byteLen: requested.byte_len,
		byteStart: requested.byte_start,
		exitCode: requested.exit_code,
		filePath: requested.file_path,
		found: true,
		isError: requested.is_error,
		kind: requested.kind,
		subtype: requested.subtype,
		text:
			raw === undefined
				? (slice?.slice ?? "")
				: sliceCodePoints(raw, fromChar, charCount),
		textChars: requested.text_chars,
		textFromRaw: raw !== undefined,
		textTruncatedInStorage:
			raw === undefined && storedChars < requested.text_chars,
		tool: requested.tool_name,
		turnIdx: requested.turn_idx,
	};
}

/**
 * The full decoded text of one block, re-derived from its raw line. Used only
 * when the line is within the parse limit and the re-derived block has the
 * stored block's kind and exact character count; otherwise undefined and the
 * stored (capped) text stands.
 */
async function readRecordTextFromRaw(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionId: string,
	generation: SessionGeneration,
	input: { readonly agentId: string; readonly block: RecordBlockRow },
): Promise<string | undefined> {
	const { block } = input;
	if (
		block.byte_len <= 0 ||
		block.byte_len > TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES
	)
		return undefined;
	const line = await readRawTranscriptLine(executor, {
		...scope,
		sessionId,
		source: block.source,
		revision: generation.revision,
		agentId: input.agentId,
		byteStart: block.byte_start,
		byteLen: block.byte_len,
	});
	if (line === undefined) return undefined;
	const decoded = decodeTranscriptLine({
		agentId: input.agentId,
		line,
		source: block.source,
	}).find((draft) => draft.blockIdx === block.block_idx);
	return decoded !== undefined &&
		decoded.kind === block.kind &&
		decoded.textChars === block.text_chars
		? decoded.text
		: undefined;
}

/** `count` code points of `text` starting at code point `from` (ClickHouse `substringUTF8`). */
function sliceCodePoints(text: string, from: number, count: number): string {
	let result = "";
	let index = 0;
	for (const character of text) {
		if (index >= from + count) break;
		if (index >= from) result += character;
		index++;
	}
	return result;
}

async function readCompactTurn(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	base: TurnDetail,
	budget: Budget,
): Promise<TurnDetail> {
	const { agentId, turnIdx } = base;
	const promptChars = Math.min(
		COMPACT_PROMPT_MAX_CHARS,
		Math.max(TRANSCRIPT_READ_MIN_CHARS / 2, Math.floor(budget.remaining / 3)),
	);
	// No entry costs less than the overhead, so the budget caps how many rows
	// are worth fetching; the extra row is the sentinel that proves more exist.
	const affordable = Math.max(
		1,
		Math.floor(budget.total / ENTRY_OVERHEAD_CHARS),
	);
	const actionLimit = Math.min(COMPACT_ACTION_LIMIT, affordable);
	const changeLimit = Math.min(FILE_CHANGE_LIST_LIMIT, affordable);
	const failureLimit = Math.min(COMPACT_FAILURE_LIMIT, affordable);
	const targetChars = Math.min(
		COMPACT_TARGET_CHARS,
		Math.max(16, Math.floor(budget.total / 10)),
	);
	const [prompts, actions, changes, failures] = await Promise.all([
		executor.query<unknown>(
			buildTurnPromptStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				promptChars,
			),
		),
		executor.query<unknown>(
			buildTurnActionsStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				actionLimit + 1,
				targetChars,
			),
		),
		executor.query<unknown>(
			buildTurnFileChangesStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				changeLimit + 1,
			),
		),
		executor.query<unknown>(
			buildTurnFailuresStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				failureLimit + 1,
			),
		),
	]);
	const promptRows = parseRows(turnPromptRow, prompts);
	const actionRows = parseRows(turnActionRow, actions);
	const changeRows = parseRows(turnChangeRow, changes);
	const failureRows = parseRows(turnFailureRow, failures);
	const found =
		promptRows.length > 0 ||
		actionRows.length > 0 ||
		changeRows.length > 0 ||
		failureRows.length > 0;
	if (!found) return base;

	let truncated =
		actionRows.length > actionLimit ||
		changeRows.length > changeLimit ||
		failureRows.length > failureLimit;
	const promptRow = promptRows[0];
	let prompt: TurnPrompt | null = null;
	if (promptRow !== undefined) {
		const taken = budget.take(promptRow.text_slice);
		prompt = {
			chars: promptRow.text_chars,
			recordIdx: promptRow.record_idx,
			text: taken.text,
			truncated:
				taken.truncated || promptRow.text_chars > promptRow.text_slice.length,
		};
		truncated ||= prompt.truncated;
	}
	// Most decision-relevant first, so a small budget keeps failures and changed
	// files and sheds the long action list.
	const failureList: TurnFailure[] = [];
	for (const row of failureRows.slice(0, failureLimit)) {
		const excerpt = row.excerpt.slice(-COMPACT_FAILURE_EXCERPT_CHARS);
		if (
			!budget.charge(row.tool_name, row.command_class, row.call_id, row.kind)
		) {
			truncated = true;
			break;
		}
		const taken = budget.take(excerpt);
		truncated ||= taken.truncated;
		failureList.push(toFailure(row, taken.text));
	}
	const changedFiles: TurnChangedFile[] = [];
	for (const row of changeRows.slice(0, changeLimit)) {
		const file = toChangedFile(row);
		if (
			!budget.charge(
				file.path,
				file.tool,
				file.operation,
				file.origin,
				file.callId,
			)
		) {
			truncated = true;
			break;
		}
		changedFiles.push(file);
	}
	const actionList: TurnAction[] = [];
	for (const row of actionRows.slice(0, actionLimit)) {
		const action = toAction(row);
		if (
			!budget.charge(
				action.tool,
				action.commandClass,
				action.target,
				action.filePath,
				action.fileOp,
				action.callId,
			)
		) {
			truncated = true;
			break;
		}
		actionList.push(action);
	}
	return {
		...base,
		actions: actionList,
		changedFiles,
		failures: failureList,
		found: true,
		prompt,
		truncated,
	};
}

async function readErrorsTurn(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	base: TurnDetail,
	budget: Budget,
): Promise<TurnDetail> {
	const { agentId, turnIdx } = base;
	const rows = parseRows(
		turnFailureRow,
		await executor.query<unknown>(
			buildTurnFailuresStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				ERRORS_VIEW_LIMIT + 1,
			),
		),
	);
	let truncated = rows.length > ERRORS_VIEW_LIMIT;
	const list: TurnFailure[] = [];
	for (const row of rows.slice(0, ERRORS_VIEW_LIMIT)) {
		if (
			!budget.charge(row.tool_name, row.command_class, row.call_id, row.kind)
		) {
			truncated = true;
			break;
		}
		const taken = budget.take(row.excerpt);
		truncated ||= taken.truncated;
		list.push(toFailure(row, taken.text));
	}
	return { ...base, failures: list, found: rows.length > 0, truncated };
}

async function readDiffTurn(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	base: TurnDetail,
	budget: Budget,
): Promise<TurnDetail> {
	const { agentId, turnIdx } = base;
	const itemChars = Math.max(
		TRANSCRIPT_READ_MIN_CHARS,
		Math.min(budget.remaining, TRANSCRIPT_READ_MAX_CHARS),
	);
	const changes = parseRows(
		turnDiffRow,
		await executor.query<unknown>(
			buildTurnDiffStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				DIFF_VIEW_LIMIT + 1,
				itemChars,
			),
		),
	);
	const shellCallIds = [
		...new Set(
			changes
				.filter((row) => row.text_chars === 0 && row.call_id !== "")
				.map((row) => row.call_id),
		),
	];
	const parents =
		shellCallIds.length === 0
			? []
			: parseRows(
					turnParentRow,
					await executor.query<unknown>(
						buildTurnParentCommandsStatement(
							scope,
							generation,
							agentId,
							turnIdx,
							shellCallIds,
							Math.min(itemChars, 2_000),
						),
					),
				);
	const commandByCall = new Map(parents.map((row) => [row.call_id, row.input]));
	let truncated = changes.length > DIFF_VIEW_LIMIT;
	const list: TurnFileChange[] = [];
	for (const row of changes.slice(0, DIFF_VIEW_LIMIT)) {
		const file = toChangedFile(row);
		if (
			!budget.charge(
				file.path,
				file.tool,
				file.operation,
				file.origin,
				file.callId,
			)
		) {
			truncated = true;
			break;
		}
		const parentCommand =
			row.text_chars === 0 ? commandByCall.get(row.call_id) : undefined;
		const command =
			parentCommand === undefined ? null : budget.take(parentCommand);
		const input = budget.take(row.input);
		const inputTruncated = input.truncated || row.text_chars > row.input.length;
		truncated ||= inputTruncated || command?.truncated === true;
		list.push({
			...file,
			command: command?.text ?? null,
			input: input.text,
			inputChars: row.text_chars,
			inputTruncated,
		});
	}
	return { ...base, changes: list, found: changes.length > 0, truncated };
}

async function readRawTurn(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	base: TurnDetail,
	budget: Budget,
): Promise<TurnDetail> {
	const { agentId, turnIdx } = base;
	const rows = parseRows(
		turnRawRow,
		await executor.query<unknown>(
			buildTurnRawStatement(
				scope,
				generation,
				agentId,
				turnIdx,
				RAW_VIEW_LIMIT + 1,
				budget.remaining,
			),
		),
	);
	const candidates: TurnRawRow[] = [];
	let reserved = 0;
	for (const row of rows.slice(0, RAW_VIEW_LIMIT)) {
		const minimum =
			ENTRY_OVERHEAD_CHARS + row.kind.length + rawTextMinimum(row);
		if (reserved + minimum > budget.total) break;
		reserved += minimum;
		candidates.push(row);
	}
	let truncated = candidates.length < rows.length;
	const allFit =
		candidates.reduce(
			(total, row) =>
				total +
				ENTRY_OVERHEAD_CHARS +
				row.kind.length +
				row.subtype.length +
				row.tool_name.length +
				row.command_class.length +
				row.file_path.length +
				row.call_id.length +
				row.text_slice.length +
				(row.text_chars > countCodePoints(row.text_slice)
					? cutMarker(row.text_chars, row.text_chars).length
					: 0),
			0,
		) <= budget.total;
	const records: TurnRawRecord[] = [];
	for (const [index, row] of candidates.entries()) {
		const minimumText = rawTextMinimum(row);
		const minimum = ENTRY_OVERHEAD_CHARS + row.kind.length + minimumText;
		const entryBudget = createBudget(
			allFit
				? budget.remaining
				: minimum +
						Math.floor(
							(budget.remaining - reserved) / (candidates.length - index),
						),
		);
		entryBudget.charge(row.kind);
		const metadata = [
			row.subtype,
			row.tool_name,
			row.command_class,
			row.file_path,
			row.call_id,
		];
		const metadataChars = metadata.reduce(
			(total, field) => total + field.length,
			0,
		);
		const taken = cutRawText(
			row.text_slice,
			Math.max(minimumText, entryBudget.remaining - metadataChars),
			row.text_chars,
		);
		entryBudget.take(taken.text);
		const metadataFits = metadataChars <= entryBudget.remaining;
		let remainingFields = metadata.filter((field) => field !== "").length;
		const fields = metadata.map((field) => {
			if (field === "") return "";
			const limit = metadataFits
				? field.length
				: Math.floor(entryBudget.remaining / remainingFields);
			remainingFields--;
			const cut = cutRawText(field, limit);
			truncated ||= cut.truncated;
			return entryBudget.take(cut.text).text;
		});
		const [
			subtype = "",
			tool = "",
			commandClass = "",
			filePath = "",
			callId = "",
		] = fields;
		budget.remaining -= entryBudget.total - entryBudget.remaining;
		reserved -= minimum;
		const textTruncated = taken.truncated;
		truncated ||= textTruncated;
		records.push({
			blockIdx: row.block_idx,
			byteLen: row.byte_len,
			byteStart: row.byte_start,
			callId,
			commandClass,
			exitCode: row.exit_code,
			filePath,
			isError: row.is_error,
			kind: row.kind,
			recordIdx: row.record_idx,
			subtype,
			text: taken.text,
			textChars: row.text_chars,
			textTruncated,
			tool,
		});
	}
	return { ...base, found: rows.length > 0, records, truncated };
}

const MIN_CUT_MARKER_CHARS = 5;

function rawTextMinimum(row: TurnRawRow): number {
	if (row.text_chars <= countCodePoints(row.text_slice)) {
		return Math.min(row.text_slice.length, MIN_CUT_MARKER_CHARS + 2);
	}
	return Math.min(row.text_slice.length, 2) + MIN_CUT_MARKER_CHARS;
}

function cutMarker(dropped: number, total: number): string {
	return `… [truncated ${dropped} of ${total} chars]`;
}

function cutRawText(
	value: string,
	maxChars: number,
	total = countCodePoints(value),
): { text: string; truncated: boolean } {
	if (total <= countCodePoints(value) && value.length <= maxChars) {
		return { text: value, truncated: false };
	}
	if (maxChars === 0) return { text: "", truncated: true };
	const counted = maxChars >= cutMarker(total, total).length;
	const room = counted
		? maxChars - cutMarker(total, total).length
		: maxChars - 1;
	const head = value
		.slice(0, Math.max(0, room))
		.replace(/[\uD800-\uDBFF]$/u, "");
	const marker = counted
		? cutMarker(total - countCodePoints(head), total)
		: "…";
	return { text: `${head}${marker}`, truncated: true };
}

/**
 * One output budget per read. Every string a view emits is charged against it,
 * including paths, targets, and identifiers, plus a fixed overhead per entry
 * for the structural fields, so `maxChars` bounds the response, not just its
 * prose.
 */
interface Budget {
	/** Charge one entry; false, with the budget exhausted, when it does not fit. */
	charge(...fields: readonly string[]): boolean;
	remaining: number;
	/** Take as much of `text` as fits. */
	take(text: string): { text: string; truncated: boolean };
	readonly total: number;
}

const ENTRY_OVERHEAD_CHARS = 24;

function createBudget(total: number): Budget {
	const budget: Budget = {
		charge(...fields) {
			let cost = ENTRY_OVERHEAD_CHARS;
			for (const field of fields) cost += field.length;
			if (cost > budget.remaining) {
				budget.remaining = 0;
				return false;
			}
			budget.remaining -= cost;
			return true;
		},
		remaining: total,
		take(text) {
			if (text.length <= budget.remaining) {
				budget.remaining -= text.length;
				return { text, truncated: false };
			}
			const kept = text.slice(0, Math.max(0, budget.remaining));
			budget.remaining = 0;
			return { text: kept, truncated: true };
		},
		total,
	};
	return budget;
}

function toAction(row: TurnActionRow): TurnAction {
	const hasResult = row.has_result;
	return {
		at: toIso(row.ts_ms) ?? "",
		blockIdx: row.block_idx,
		callId: row.call_id,
		commandClass: row.command_class,
		exitCode: row.result_exit_code ?? null,
		fileOp: row.file_op,
		filePath: row.file_path,
		recordIdx: row.record_idx,
		status: !hasResult
			? "no_result"
			: row.result_is_error
				? "error"
				: row.result_running
					? "running"
					: "ok",
		target: row.file_path !== "" ? row.file_path : firstLine(row.target),
		tool: row.tool_name,
	};
}

function toFailure(row: TurnFailureRow, excerpt: string): TurnFailure {
	return {
		blockIdx: row.block_idx,
		callId: row.call_id,
		commandClass: row.command_class,
		excerpt,
		exitCode: row.exit_code,
		kind: row.kind,
		recordIdx: row.record_idx,
		textChars: row.text_chars,
		tool: row.tool_name,
	};
}

function toChangedFile(row: TurnChangeRow): TurnChangedFile {
	return {
		blockIdx: row.block_idx,
		callId: row.call_id,
		operation: row.file_op,
		origin: row.subtype,
		path: row.file_path,
		recordIdx: row.record_idx,
		tool: row.tool_name,
	};
}

function toRecordBlock(row: RecordBlockRow): RecordBlock {
	return {
		blockIdx: row.block_idx,
		kind: row.kind,
		textChars: row.text_chars,
	};
}

function emptyFacts(sessionId: string): SessionFacts {
	return {
		commands: {},
		endedAt: null,
		filesChanged: { count: 0, paths: [] },
		indexed: false,
		parserVersion: null,
		receipt: null,
		records: 0,
		revision: null,
		sessionId,
		source: null,
		startedAt: null,
		subagents: { agentIds: [], spawned: 0 },
		tests: { failed: 0, run: 0 },
		toolCalls: 0,
		toolErrors: 0,
		turns: 0,
	};
}

function toSource(value: string): TranscriptSource | null {
	return value === "claude_code" || value === "codex" ? value : null;
}

function toIso(
	milliseconds: number | string | null | undefined,
): string | null {
	if (milliseconds === null || milliseconds === undefined) return null;
	const value = Number(milliseconds);
	return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function firstLine(value: string): string {
	return toSingleLine(value.split("\n", 1)[0] ?? "", COMPACT_TARGET_CHARS);
}

/** Collapse whitespace to a single line and truncate with an ellipsis. */
function toSingleLine(value: string, maxChars: number): string {
	const collapsed = value.replace(/\s+/gu, " ").trim();
	return collapsed.length <= maxChars
		? collapsed
		: `${collapsed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function clampInteger(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function assertScope(scope: TranscriptReadScope): void {
	if (scope.organizationId === "" || scope.userId === "") {
		throw new Error("Transcript reads require an organization and a user");
	}
}

function assertNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative integer`);
	}
}

/**
 * Result rows are validated against the schema of the columns each reader
 * expects, so a statement that stops selecting a column fails loudly instead
 * of surfacing `undefined`. ClickHouse returns 64-bit integers as strings and
 * booleans as numbers or booleans, which the schemas normalize.
 */
function parseRows<T>(schema: z.ZodType<T, unknown>, rows: unknown[]): T[] {
	return rows.map((row) => schema.parse(row));
}

const count = z.coerce.number();
const nullableCount = z.coerce.number().nullable();
const flag = z.union([z.boolean(), z.number()]).transform(Boolean);
const nullableFlag = z
	.union([z.boolean(), z.number(), z.null()])
	.transform((value) => (value === null ? null : Boolean(value)));
const commandClassName = z.enum([
	"test",
	"build",
	"lint",
	"typecheck",
	"git",
	"migrate",
	"install",
	"other",
]);

const totalsRow = z.object({
	ended_ms: count,
	records: count,
	session_id: z.string(),
	spawned_agent_ids: z.array(z.string()),
	started_ms: count,
	stream_agent_ids: z.array(z.string()),
	subagent_spawns: count,
	tool_calls: count,
	tool_errors: count,
	turns: count,
});

const sessionCommandsRow = z.object({
	calls: count,
	command_class: commandClassName,
	failed: count,
	session_id: z.string(),
});

const sessionFilesRow = z.object({
	file_count: count,
	files: z.array(z.string()),
	session_id: z.string(),
});

const mapTurnRow = z.object({
	byte_end: count,
	first_byte_start: count,
	ended_ms: count,
	first_record_idx: count,
	last_record_idx: count,
	prompt_chars: count,
	started_ms: count,
	subagent_spawns: count,
	tool_calls: count,
	tool_errors: count,
	turn_idx: count,
});

const mapPromptRow = z.object({
	prompt_head: z.string(),
	turn_idx: count,
});

const mapFilesRow = z.object({
	file_count: count,
	files: z.array(z.string()),
	turn_idx: count,
});

const mapCommandsRow = z.object({
	calls: count,
	command_class: commandClassName,
	failed: count,
	turn_idx: count,
});

const turnPromptRow = z.object({
	record_idx: count,
	text_chars: count,
	text_slice: z.string(),
});

const turnActionRow = z.object({
	block_idx: count,
	call_id: z.string(),
	command_class: z.string(),
	file_op: z.string(),
	file_path: z.string(),
	has_result: flag,
	record_idx: count,
	result_exit_code: nullableCount.optional(),
	result_is_error: nullableFlag.optional(),
	result_running: nullableFlag.optional(),
	target: z.string(),
	tool_name: z.string(),
	ts_ms: count,
});

const turnChangeRow = z.object({
	block_idx: count,
	call_id: z.string(),
	file_op: z.string(),
	file_path: z.string(),
	record_idx: count,
	subtype: z.string(),
	tool_name: z.string(),
});

const turnFailureRow = z.object({
	block_idx: count,
	call_id: z.string(),
	command_class: z.string(),
	excerpt: z.string(),
	exit_code: nullableCount,
	kind: z.string(),
	record_idx: count,
	text_chars: count,
	tool_name: z.string(),
});

const turnDiffRow = turnChangeRow.extend({
	input: z.string(),
	text_chars: count,
});

const turnParentRow = z.object({
	call_id: z.string(),
	input: z.string(),
	text_chars: count,
});

const turnRawRow = z.object({
	block_idx: count,
	byte_len: count,
	byte_start: count,
	call_id: z.string(),
	command_class: z.string(),
	exit_code: nullableCount,
	file_path: z.string(),
	is_error: flag,
	kind: z.string(),
	record_idx: count,
	subtype: z.string(),
	text_chars: count,
	text_slice: z.string(),
	tool_name: z.string(),
});

const recordBlockRow = z.object({
	block_idx: count,
	byte_len: count,
	byte_start: count,
	exit_code: nullableCount,
	file_path: z.string(),
	is_error: flag,
	kind: z.string(),
	source: z.enum(["claude_code", "codex"]),
	subtype: z.string(),
	text_chars: count,
	tool_name: z.string(),
	turn_idx: count,
});

const recordSliceRow = z.object({
	slice: z.string(),
	stored_chars: count,
});

type TurnActionRow = z.infer<typeof turnActionRow>;
type TurnChangeRow = z.infer<typeof turnChangeRow>;
type TurnFailureRow = z.infer<typeof turnFailureRow>;
type TurnRawRow = z.infer<typeof turnRawRow>;
type RecordBlockRow = z.infer<typeof recordBlockRow>;
