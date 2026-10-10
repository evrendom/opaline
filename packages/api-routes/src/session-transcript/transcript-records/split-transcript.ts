import { Buffer } from "node:buffer";
import { readClaudeLine } from "./claude-records.js";
import { codexOutcomes } from "./codex-outcomes.js";
import { readCodexAgentId, readCodexLine } from "./codex-records.js";
import {
	createStreamState,
	isRecord,
	type LineFacts,
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
	NO_TRANSCRIPT_RECORD_FACTS,
	type SplitTranscriptOptions,
	TRANSCRIPT_RECORD_EXCERPT_CHARS,
	TRANSCRIPT_RECORD_FACT_SHORT_CHARS,
	TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES,
	TRANSCRIPT_RECORD_META_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS,
	TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	type TranscriptRecordDraft,
	type TranscriptRecordFacts,
	type TranscriptRecordKind,
	type TranscriptSource,
	type TranscriptSplitSummary,
	type TranscriptTextBudget,
} from "./types.js";

/** Kinds whose full decoded text is stored up to the record cap. */
const BODY_KINDS: ReadonlySet<TranscriptRecordKind> = new Set([
	"user_prompt",
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_result",
	"file_change",
	"compaction",
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
	readonly codexForkParentCalls?: Readonly<Record<string, readonly string[]>>;
	readonly content: string;
	readonly maxParseLineBytes?: number;
	/** ISO timestamp of the session start; used until a record supplies its own. */
	readonly sessionDate: string;
	readonly source: TranscriptSource;
	readonly subagents?: Readonly<Record<string, string>>;
	readonly textBudgetChars?: number;
	readonly textMaxChars?: number;
	readonly factBudgetChars?: number;
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
	const totalChars =
		input.textBudgetChars ?? TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS;
	let totalBytes = Buffer.byteLength(input.content, "utf8");
	for (const content of Object.values(input.subagents ?? {}))
		totalBytes += Buffer.byteLength(content, "utf8");
	const textBudget: TranscriptTextBudget = {
		remaining: totalChars,
		pace: { bytesBefore: 0, totalBytes, totalChars },
	};
	const shared = {
		codexForkParentCalls: input.codexForkParentCalls,
		factBudget: {
			remaining:
				input.factBudgetChars ?? TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS,
		},
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
	const outcomes =
		options.source === "codex" ? codexOutcomes(content) : undefined;
	const streamFor = (agentId: string): StreamState => {
		let state = streams.get(agentId);
		if (state === undefined) {
			state = createStreamState(options.fallbackTs, agentId !== "");
			const streamOutcomes = outcomes?.get(
				agentId === mainAgentId ? "" : agentId,
			);
			if (streamOutcomes !== undefined)
				for (const [callId, outcome] of streamOutcomes)
					state.codexEndEvents.set(callId, outcome);
			// A Codex sub-agent inside the file runs in the same CLI as the file's
			// own agent, whose session_meta came first.
			const main = streams.get(mainAgentId);
			if (main !== undefined) {
				state.agentVersion = main.agentVersion;
				state.entrypoint = main.entrypoint;
			}
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
			yield buildOversizedDraft(line, mainAgentId, state, location);
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
			const cap = options.fullText
				? Number.MAX_SAFE_INTEGER
				: storedTextCap(item.kind, textMaxChars);
			const budget = options.fullText ? undefined : options.textBudget;
			const fields =
				cap === undefined
					? headOnlyFields(item.text ?? "")
					: buildTranscriptTextFields(item.text ?? "", {
							allowance: pacedAllowance(budget, byteOffset),
							budget,
							keepTail: item.kind === "tool_result" || item.isError === true,
							textMaxChars: cap,
						});
			if (fields.truncated) stats.textTruncated = true;
			stats.rowCount++;
			yield buildDraft({
				agentId,
				blockIdx,
				fields,
				item: options.fullText
					? item
					: { ...item, facts: budgetFacts(item.facts, options.factBudget) },
				location,
				state,
				ts,
			});
			blockIdx++;
		}
		if (isLast) break;
	}
	stats.streamCount += streams.size;
	const pace = options.textBudget?.pace;
	if (pace !== undefined)
		pace.bytesBefore += Buffer.byteLength(content, "utf8");
}

/**
 * Characters a record may still spend: the budget's share of the session's
 * raw bytes up to the end of its line, minus what was already spent.
 */
function pacedAllowance(
	budget: TranscriptTextBudget | undefined,
	lineEndOffset: number,
): number | undefined {
	const pace = budget?.pace;
	if (budget === undefined || pace === undefined || pace.totalBytes === 0)
		return undefined;
	const share = Math.min(
		1,
		(pace.bytesBefore + lineEndOffset) / pace.totalBytes,
	);
	const spent = pace.totalChars - budget.remaining;
	return Math.floor(pace.totalChars * share) - spent;
}

/**
 * Full decoded records of one raw JSONL line, exactly as the splitter derives
 * them but with no cap or budget: the record read re-derives a line whose
 * stored text was capped from its exact raw byte range. Records whose meaning
 * depends on earlier lines (mirrors, delegation) may differ from the stored
 * ones; callers match a block by kind and character count before using it.
 */
export function decodeTranscriptLine(input: {
	readonly agentId: string;
	readonly line: string;
	readonly source: TranscriptSource;
}): TranscriptRecordDraft[] {
	return [
		...splitTranscript({
			agentId: input.agentId,
			content: input.line,
			fallbackTs: new Date(0).toISOString(),
			fullText: true,
			maxParseLineBytes: Number.MAX_SAFE_INTEGER,
			source: input.source,
		}),
	];
}

/** Stored text cap of a kind; undefined keeps an excerpt only. */
function storedTextCap(
	kind: TranscriptRecordKind,
	textMaxChars: number,
): number | undefined {
	if (BODY_KINDS.has(kind)) return textMaxChars;
	if (kind === "injected_context")
		return Math.min(textMaxChars, TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS);
	if (kind === "meta")
		return Math.min(textMaxChars, TRANSCRIPT_RECORD_META_TEXT_MAX_CHARS);
	return undefined;
}

/**
 * Spend the session fact budget on a record's long `facts` values (over
 * `TRANSCRIPT_RECORD_FACT_SHORT_CHARS`); past it, drop them and mark the
 * record `facts_truncated`. Short values are always kept and cost nothing:
 * each is bounded, like the typed fact columns.
 */
export function budgetFacts(
	facts: LineFacts | undefined,
	budget: { remaining: number } | undefined,
): LineFacts | undefined {
	if (facts?.extra === undefined || budget === undefined) return facts;
	const values = Object.entries(facts.extra);
	let chars = 0;
	for (const [, value] of values)
		if (
			value !== undefined &&
			value.length > TRANSCRIPT_RECORD_FACT_SHORT_CHARS
		)
			chars += value.length;
	if (chars <= budget.remaining) {
		budget.remaining -= chars;
		return facts;
	}
	const kept: Record<string, string> = {};
	for (const [key, value] of values)
		if (
			value !== undefined &&
			value.length <= TRANSCRIPT_RECORD_FACT_SHORT_CHARS
		)
			kept[key] = value;
	return { ...facts, extra: { ...kept, facts_truncated: "true" } };
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
		facts: { ...streamFacts(input.state), ...item.facts },
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

/** Facts every record of a stream carries: the agent version and entrypoint. */
function streamFacts(state: StreamState): TranscriptRecordFacts {
	return {
		...NO_TRANSCRIPT_RECORD_FACTS,
		agentVersion: state.agentVersion,
		entrypoint: state.entrypoint,
	};
}

function buildOversizedDraft(
	line: string,
	agentId: string,
	state: StreamState,
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
		facts: streamFacts(state),
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
		ts: state.lastTs,
		turnIdx: state.turnIdx,
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
