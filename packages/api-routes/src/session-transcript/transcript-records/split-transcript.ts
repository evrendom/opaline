import { Buffer } from "node:buffer";
import { readClaudeLine } from "./claude-records.js";
import { readCodexAgentId, readCodexLine } from "./codex-records.js";
import {
	createStreamState,
	isRecord,
	type LineItem,
	type StreamState,
} from "./line-items.js";
import {
	buildTranscriptTextFields,
	countCodePoints,
	sliceEnd,
	sliceStart,
	type TranscriptTextFields,
} from "./text-fields.js";
import {
	type SplitTranscriptOptions,
	TRANSCRIPT_RECORD_EXCERPT_CHARS,
	TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	type TranscriptRecordDraft,
	type TranscriptRecordKind,
	type TranscriptSource,
	type TranscriptSplitSummary,
	type TranscriptTextBudget,
} from "./types.js";

/** Kinds whose full decoded text is stored (capped). Others keep a head only. */
const BODY_KINDS: ReadonlySet<TranscriptRecordKind> = new Set([
	"user_prompt",
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
]);

/** Kinds that mean the agent has responded since the latest prompt. */
const RESPONSE_KINDS: ReadonlySet<TranscriptRecordKind> = new Set([
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
]);

export interface MutableSplitStats {
	lineCount: number;
	oversizedLineCount: number;
	rowCount: number;
	streamCount: number;
	textTruncated: boolean;
	unparseableLineCount: number;
}

export function createSplitStats(): MutableSplitStats {
	return {
		lineCount: 0,
		oversizedLineCount: 0,
		rowCount: 0,
		streamCount: 0,
		textTruncated: false,
		unparseableLineCount: 0,
	};
}

export interface SessionTranscriptInput {
	readonly content: string;
	readonly maxParseLineBytes?: number;
	/** ISO timestamp of the session start; used until a record supplies its own. */
	readonly sessionDate: string;
	readonly source: TranscriptSource;
	readonly subagents?: Readonly<Record<string, string>>;
	readonly textBudgetChars?: number;
	readonly textMaxChars?: number;
}

/**
 * Split a whole session (main transcript first, then subagent transcripts by
 * id) into record drafts. The generator holds one line at a time; callers
 * decide how many drafts to buffer before flushing.
 */
export function* splitSessionTranscript(
	input: SessionTranscriptInput,
	stats: MutableSplitStats = createSplitStats(),
): Generator<TranscriptRecordDraft> {
	const textBudget: TranscriptTextBudget = {
		remaining:
			input.textBudgetChars ?? TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	};
	const shared = {
		fallbackTs: input.sessionDate,
		maxParseLineBytes: input.maxParseLineBytes,
		source: input.source,
		textBudget,
		textMaxChars: input.textMaxChars,
	};
	yield* splitTranscript(
		{ ...shared, agentId: "", content: input.content },
		stats,
	);
	const agentIds = Object.keys(input.subagents ?? {}).sort();
	for (const agentId of agentIds) {
		yield* splitTranscript(
			{ ...shared, agentId, content: input.subagents?.[agentId] ?? "" },
			stats,
		);
	}
}

/** Split one JSONL stream. `agentId` is '' for a main transcript. */
export function* splitTranscript(
	options: SplitTranscriptOptions,
	stats: MutableSplitStats = createSplitStats(),
): Generator<TranscriptRecordDraft> {
	const { content } = options;
	const mainAgentId = options.agentId ?? "";
	const maxParseLineBytes =
		options.maxParseLineBytes ?? TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES;
	const textMaxChars = options.textMaxChars ?? TRANSCRIPT_RECORD_TEXT_MAX_CHARS;
	const streams = new Map<string, StreamState>();
	const streamFor = (agentId: string): StreamState => {
		let state = streams.get(agentId);
		if (state === undefined) {
			state = createStreamState(options.fallbackTs, agentId !== "");
			streams.set(agentId, state);
		}
		return state;
	};

	let position = 0;
	let byteOffset = 0;
	let lineNumber = 0;
	while (position <= content.length) {
		const newline = content.indexOf("\n", position);
		const isLast = newline === -1;
		const end = isLast ? content.length : newline;
		const line = content.slice(position, end);
		const byteStart = byteOffset;
		const byteLen = Buffer.byteLength(line, "utf8");
		lineNumber++;
		position = end + 1;
		byteOffset += byteLen + 1;
		if (line.trim() === "") {
			if (isLast) break;
			continue;
		}
		stats.lineCount++;

		const location = { byteLen, byteStart, lineNumber };
		if (byteLen > maxParseLineBytes) {
			stats.oversizedLineCount++;
			stats.rowCount++;
			const state = streamFor(mainAgentId);
			yield buildOversizedDraft(
				line,
				mainAgentId,
				state.lastTs,
				state.turnIdx,
				location,
			);
			if (isLast) break;
			continue;
		}

		const parsed = parseLine(line, lineNumber === 1);
		if (parsed === undefined) {
			stats.unparseableLineCount++;
			stats.rowCount++;
			const state = streamFor(mainAgentId);
			yield buildDraft({
				agentId: mainAgentId,
				blockIdx: 0,
				fields: headOnlyFields(line),
				item: { kind: "meta", subtype: "unparseable" },
				location,
				state,
				ts: state.lastTs,
			});
			if (isLast) break;
			continue;
		}

		const agentId =
			options.source === "codex"
				? (readCodexAgentId(parsed) ?? mainAgentId)
				: mainAgentId;
		const state = streamFor(agentId);
		const result =
			options.source === "codex"
				? readCodexLine(parsed, state)
				: readClaudeLine(parsed, state);
		const ts = normalizeTimestamp(result.timestamp) ?? state.lastTs;
		state.lastTs = ts;

		let blockIdx = 0;
		for (const item of result.items) {
			applyTurnState(state, item);
			const fields = BODY_KINDS.has(item.kind)
				? buildTranscriptTextFields(item.text ?? "", {
						budget: options.textBudget,
						textMaxChars,
					})
				: headOnlyFields(item.text ?? "");
			if (fields.truncated) stats.textTruncated = true;
			stats.rowCount++;
			yield buildDraft({
				agentId,
				blockIdx,
				fields,
				item,
				location,
				state,
				ts,
			});
			blockIdx++;
		}
		if (isLast) break;
	}
	stats.streamCount += streams.size;
}

function applyTurnState(state: StreamState, item: LineItem): void {
	if (item.kind === "user_prompt") {
		// Consecutive prompts with no response between them belong to one turn.
		if (state.turnIdx === 0 || state.responseSincePrompt) {
			state.turnIdx++;
			state.responseSincePrompt = false;
		}
		state.lastPromptText = item.text ?? "";
	} else if (RESPONSE_KINDS.has(item.kind)) {
		state.responseSincePrompt = true;
	}
}

function buildDraft(input: {
	agentId: string;
	blockIdx: number;
	fields: TranscriptTextFields;
	item: LineItem;
	location: { byteLen: number; byteStart: number; lineNumber: number };
	state: StreamState;
	ts: string;
}): TranscriptRecordDraft {
	const { item, fields, location } = input;
	const subtype =
		item.kind === "user_prompt" && input.state.isSubagent && !item.subtype
			? "delegation"
			: (item.subtype ?? "");
	return {
		agentId: input.agentId,
		blockIdx: input.blockIdx,
		byteLen: location.byteLen,
		byteStart: location.byteStart,
		callId: item.callId ?? "",
		commandClass: item.commandClass ?? "",
		exitCode: item.exitCode ?? null,
		fileOp: item.fileOp ?? "",
		filePath: item.filePath ?? "",
		head: fields.head,
		isError: item.isError ?? false,
		kind: item.kind,
		recordIdx: location.lineNumber,
		spawnedAgentId: item.spawnedAgentId ?? "",
		subtype,
		tail: fields.tail,
		text: fields.text,
		textChars: fields.textChars,
		toolName: item.toolName ?? "",
		ts: input.ts,
		turnIdx: input.state.turnIdx,
	};
}

function buildOversizedDraft(
	line: string,
	agentId: string,
	ts: string,
	turnIdx: number,
	location: { byteLen: number; byteStart: number; lineNumber: number },
): TranscriptRecordDraft {
	return {
		agentId,
		blockIdx: 0,
		byteLen: location.byteLen,
		byteStart: location.byteStart,
		callId: "",
		commandClass: "",
		exitCode: null,
		fileOp: "",
		filePath: "",
		head: sliceStart(line, TRANSCRIPT_RECORD_EXCERPT_CHARS),
		isError: false,
		kind: "oversized",
		recordIdx: location.lineNumber,
		spawnedAgentId: "",
		subtype: "oversized",
		tail: sliceEnd(
			line,
			Math.max(0, line.length - TRANSCRIPT_RECORD_EXCERPT_CHARS),
		),
		text: "",
		textChars: line.length,
		toolName: "",
		ts,
		turnIdx,
	};
}

/** Fields for records that keep only a short excerpt (no stored body). */
function headOnlyFields(text: string): TranscriptTextFields {
	if (text === "") {
		return { head: "", tail: "", text: "", textChars: 0, truncated: false };
	}
	return {
		head: sliceStart(text, TRANSCRIPT_RECORD_EXCERPT_CHARS),
		tail: "",
		text: "",
		textChars: countCodePoints(text),
		truncated: false,
	};
}

function parseLine(
	line: string,
	isFirstLine: boolean,
): Record<string, unknown> | undefined {
	const source =
		isFirstLine && line.charCodeAt(0) === 0xfe_ff ? line.slice(1) : line;
	try {
		const parsed: unknown = JSON.parse(source);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function normalizeTimestamp(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const milliseconds = Date.parse(value);
	return Number.isNaN(milliseconds)
		? undefined
		: new Date(milliseconds).toISOString();
}

export function summarizeSplit(
	stats: MutableSplitStats,
): TranscriptSplitSummary {
	return { ...stats };
}
