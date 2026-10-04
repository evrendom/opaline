/**
 * Deterministic transcript record index.
 *
 * Everything emitted here is observed data: tool calls, exit codes, file paths,
 * and the text that was actually written in the transcript. Nothing is
 * summarised or generated.
 */

/** Bump when splitter output changes for the same input so backfill re-extracts. */
export const TRANSCRIPT_RECORDS_PARSER_VERSION = 5;

/** record_idx of the per-revision receipt row. Real lines never reach this. */
export const TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX = 4_294_967_295;

/** Characters kept in `head` (first) and `tail` (last) of every record. */
export const TRANSCRIPT_RECORD_EXCERPT_CHARS = 1_024;

/** Default cap on the full decoded `text` stored per record (code points). */
export const TRANSCRIPT_RECORD_TEXT_MAX_CHARS = 65_536;

/**
 * Cap on the stored `text` of injected context (instructions, reminders,
 * memory files, AGENTS.md). Longer bodies stay readable through the record
 * read's raw fallback.
 */
export const TRANSCRIPT_RECORD_INJECTED_TEXT_MAX_CHARS = 16_384;

/** Cap on the stored `text` of bookkeeping records that carry content (hooks, API errors, attachments). */
export const TRANSCRIPT_RECORD_META_TEXT_MAX_CHARS = 4_096;

/**
 * Default total of head + tail + text characters stored for one session across
 * every stream.
 *
 * The budget is paced over the session's raw bytes, main transcript first and
 * then each subagent transcript: by the end of any line, the characters spent
 * may not exceed the budget's share of the bytes read so far (unspent share
 * carries forward). A large early stretch therefore cannot starve later turns
 * or subagent transcripts; each keeps at least its proportional share. A record
 * that does not fit its allowance keeps its head and tail excerpts and a shorter
 * text, or, with nothing left, a short head, plus a short tail for tool results
 * and errors so failure causes survive. Record reads fall back to the raw line
 * for anything not stored.
 */
export const TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS = 32 * 1024 * 1024;

/** Lines larger than this are indexed by byte range and excerpts, never parsed. */
export const TRANSCRIPT_RECORD_MAX_PARSE_LINE_BYTES = 16 * 1024 * 1024;

export type TranscriptSource = "claude_code" | "codex";

export type TranscriptRecordKind =
	/** A human prompt or a parent's task (subtype `delegation`) in a subagent. */
	| "user_prompt"
	| "assistant_text"
	| "reasoning"
	| "tool_call"
	| "tool_result"
	/** One file mutation derived from a tool call (native edit, patch, or shell). */
	| "file_change"
	/** User-role text injected by tooling (system instructions, reminders, skill bodies). */
	| "injected_context"
	| "compaction"
	/** Bookkeeping records (attachments, token counts, lifecycle events). */
	| "meta"
	/** A line too large to parse; indexed by byte range and excerpts only. */
	| "oversized"
	/** Written last per revision; proves the revision was fully extracted. */
	| "receipt";

export type CommandClass =
	| ""
	| "test"
	| "build"
	| "lint"
	| "typecheck"
	| "git"
	| "migrate"
	| "install"
	| "other";

export type FileOperation =
	| ""
	| "read"
	| "write"
	| "edit"
	| "delete"
	/**
	 * A shell command that may not have changed the working tree: it sat in a
	 * conditional branch or only touched the Git index. Kept for drill-downs,
	 * never counted as a file change.
	 */
	| "inferred_write"
	| "inferred_edit"
	| "inferred_delete";

/** File operations that count as a change to the working tree. */
export const FILE_MUTATION_OPERATIONS = ["write", "edit", "delete"] as const;

export interface TranscriptRecordDraft {
	/** '' for the main transcript, otherwise the subagent id. */
	readonly agentId: string;
	/** 1-based JSONL line number inside the stream. */
	readonly recordIdx: number;
	/** 0 for the record itself; >0 for blocks or file changes derived from the same line. */
	readonly blockIdx: number;
	/** Count of genuine human prompts seen so far in the stream (0 before the first). */
	readonly turnIdx: number;
	/** ISO-8601 timestamp, carried forward from earlier records when absent. */
	readonly ts: string;
	readonly kind: TranscriptRecordKind;
	readonly subtype: string;
	readonly toolName: string;
	readonly commandClass: CommandClass;
	readonly isError: boolean;
	readonly exitCode: number | null;
	readonly callId: string;
	readonly filePath: string;
	readonly fileOp: FileOperation;
	readonly spawnedAgentId: string;
	/** Exact UTF-8 byte offset of the raw line inside the stream's content. */
	readonly byteStart: number;
	/** Exact UTF-8 byte length of the raw line, excluding the newline. */
	readonly byteLen: number;
	/** Code points in the full decoded text before capping. */
	readonly textChars: number;
	readonly head: string;
	readonly tail: string;
	readonly text: string;
}

export interface TranscriptTextBudget {
	remaining: number;
	/**
	 * Pacing over a whole session's raw bytes (see
	 * `TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS`); absent, a record may use
	 * whatever remains.
	 */
	readonly pace?: TranscriptTextPace;
}

export interface TranscriptTextPace {
	readonly totalChars: number;
	readonly totalBytes: number;
	/** Raw bytes of the streams already split. */
	bytesBefore: number;
}

export interface SplitTranscriptOptions {
	/** '' for the main transcript, otherwise the subagent id. */
	readonly agentId?: string;
	readonly content: string;
	/** Timestamp used until a record supplies its own. */
	readonly fallbackTs: string;
	readonly maxParseLineBytes?: number;
	readonly source: TranscriptSource;
	readonly textBudget?: TranscriptTextBudget;
	readonly textMaxChars?: number;
	/**
	 * Store the whole decoded text of every record that has one, with no cap or
	 * budget (the record read's raw fallback re-derives one line this way).
	 */
	readonly fullText?: boolean;
}

export interface TranscriptSplitSummary {
	/** True when any record lost text because of the per-record cap or session budget. */
	readonly textTruncated: boolean;
	readonly lineCount: number;
	readonly oversizedLineCount: number;
	readonly rowCount: number;
	readonly streamCount: number;
	readonly unparseableLineCount: number;
}
