import type { ReceivedSetupText } from "./received-setup.js";
import { V9_FACT_KEYS } from "./v9-fact-sources.js";

/**
 * Deterministic transcript record index.
 *
 * Everything emitted here is observed data: tool calls, exit codes, file paths,
 * and the text that was actually written in the transcript. Nothing is
 * summarised or generated.
 */

/**
 * Bump when splitter output changes for the same input so backfill re-extracts.
 * 10: received setup (`received_setup` and the setup texts) and the
 * system prompt kept whole in `instruction_text_components` (OPL-391).
 * 11: background tasks (hand-offs and their task notifications, linked to
 * the call by `call_id`), hook blocks as a denial kind, and harness texts
 * the agent saw as injected context of their own subtype.
 */
export const TRANSCRIPT_RECORDS_PARSER_VERSION = 11;

/** First parser version that fills the typed fact columns and `facts` (docs/l1-literal-schema.md, step 7). */
export const TRANSCRIPT_RECORD_FACTS_SINCE_PARSER_VERSION = 6;

/** Cap on one value in `facts` (UTF-16 code units, without splitting surrogate pairs). */
export const TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS = 4_096;

/** Cap on a `facts` value that holds a JSON list (UTF-16 code units). */
export const TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS = 65_536;

/**
 * Larger caps for the parts of a system prompt (`instruction_text_components`):
 * one part and the whole list. The default caps cut long Claude Code prompt
 * snapshots (16 of 645 on production); their whole text is also received
 * setup, stored once per version.
 */
export const TRANSCRIPT_RECORD_INSTRUCTION_PART_MAX_CHARS = 262_144;
export const TRANSCRIPT_RECORD_INSTRUCTION_LIST_MAX_CHARS = 524_288;

/**
 * UTF-16 code units of long `facts` values (over `TRANSCRIPT_RECORD_FACT_SHORT_CHARS`)
 * one session may store across its streams. Short values and the typed fact
 * columns are bounded per record and always kept; once the budget is spent, a
 * record drops its long values and says `facts_truncated`, so a cut value
 * never reads as not recorded.
 */
export const TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS = 16 * 1024 * 1024;
export const TRANSCRIPT_RECORD_FACT_SHORT_CHARS = 32;

/**
 * Keys of `facts`, named after the L1 spec columns, with the parser version
 * that first fills each. A key is written only when the record carries the
 * value, so a missing key means not recorded, and only for rows of at least
 * its version.
 */
export const TRANSCRIPT_RECORD_FACT_KEYS = {
	...V9_FACT_KEYS,
	/**
	 * Background task id: on the hand-off result of a call whose work went on
	 * in the background (Claude Bash `backgroundTaskId` or its hand-off text,
	 * Monitor `taskId`, async Agent `agentId`) and on the task notifications
	 * that report on it, which carry the call's `call_id`.
	 */
	task_id: 11,
	/** How the call's work went to the background: requested, timeout (moved there by its timeout), agent or monitor. */
	background_launch: 11,
	/** A task notification's `<status>` (completed, failed, killed, stopped). */
	background_status: 11,
	/** The exit code a task notification's summary reports. */
	background_exit_code: 11,
	/** "true" on a Monitor event notification, which reports progress, not an end. */
	task_event: 11,
	/** The hook event of a hook error in a tool result (PreToolUse blocks the call; PostToolUse ran after it). */
	hook_event: 11,
	/**
	 * Setup text the record carries, as a JSON array of
	 * `{kind, path, name, cwd, sha256, chars}` (`received-setup.ts`); the texts
	 * themselves are stored once per hash in `rudel.setup_texts`.
	 */
	received_setup: 10,
	permission_profile_kind: 9,
	permission_profile_id: 9,
	search_result_lines: 9,
	parsed_cmd_types_more: 9,
	attribution_mcp_server: 9,
	attribution_mcp_tool: 9,
	files_found: 9,
	search_mode: 9,
	file_change_basis: 9,
	applied_changes: 9,
	applied_changes_more: 9,
	fork_replayed: 9,
	/** Claude tool result `returnCodeInterpretation`. */
	return_code_interpretation: 6,
	/** Claude tool result `noOutputExpected` (true/false). */
	no_output_expected: 6,
	/** Claude tool result `timeoutMs`. */
	timeout_ms: 6,
	/** Claude tool result `isAsync` (true/false). */
	is_async: 6,
	/** Claude tool result `backgroundTaskId`. */
	background_task_id: 6,
	/**
	 * Claude tool result `bashEditDiff.files[]` as a JSON array of
	 * `{filePath, created?, deleted?}`, cut to whole entries that fit the cap.
	 */
	shell_edit_files: 6,
	/** Files of `bashEditDiff` left out of `shell_edit_files`: its `moreFiles` plus entries cut by the cap. */
	shell_edit_files_more: 6,
	/** Claude tool result `bashEditDiff.changedFiles` paths, as a JSON array cut to whole entries. */
	shell_edit_changed_files: 6,
	/** `changedFiles` paths cut by the cap. */
	shell_edit_changed_files_more: 6,
	/** Claude tool result `bashEditDiff.unavailable` and `.shared` (true/false). */
	shell_edit_unavailable: 6,
	shell_edit_shared: 6,
	/** Lines added and removed in a Claude tool result `structuredPatch`. */
	patch_lines_added: 6,
	patch_lines_removed: 6,
	/** Claude tool result `userModified` (true/false). */
	user_modified: 6,
	/** Characters of a Claude tool result `stdout` and `stderr`; the text itself stays in `text`. */
	stdout_chars: 6,
	stderr_chars: 6,
	/** Claude tool result `persistedOutputSize`. */
	persisted_output_bytes: 6,
	/** Claude tool result `staleReadFileStateHint`, the notice naming files changed since they were read. */
	stale_read: 6,
	/** Claude search tool result `numMatches`, never files or context lines. */
	search_matches: 6,
	/** Claude tool result `gitOperation` values. */
	"git.push.branch": 6,
	"git.pr.number": 6,
	"git.pr.action": 6,
	"git.pr.url": 6,
	"git.commit.sha": 6,
	"git.commit.kind": 6,
	"git.branch.ref": 6,
	"git.branch.action": 6,
	/** Claude `pr-link` record. */
	pr_repository: 6,
	pr_number: 6,
	pr_url: 6,
	/** Codex McpToolCall `readOnlyHint` (true/false). */
	mcp_read_only: 6,
	/** Codex McpToolCall `pluginId`. */
	attribution_plugin: 6,
	/** "true" when the session fact budget dropped longer values of this record. */
	facts_truncated: 6,
	// Parser 7: run facts. They sit on the record that carries them (a Codex
	// turn_context, task or abort event; a Claude prompt, assistant line or
	// system record); a run reads them from its records.
	/** Codex turn_context `approval_policy`, `approvals_reviewer`, `sandbox_policy.type`, `permission_profile.type`, `collaboration_mode.mode`. */
	approval_policy: 7,
	approvals_reviewer: 7,
	sandbox_policy: 7,
	/** Codex turn_context `sandbox_policy.network_access` (true/false). */
	sandbox_network_access: 7,
	permission_profile: 7,
	collaboration_mode: 7,
	/** Codex turn_context `model`; Claude assistant `message.model`. */
	model: 7,
	/** Codex turn_context `effort`; Claude assistant `effort`. */
	effort: 7,
	/** Claude assistant `perTurnEffort`. */
	per_turn_effort: 7,
	/** Codex task_started `model_context_window`. */
	context_window: 7,
	/** Codex task_complete `time_to_first_token_ms`. */
	time_to_first_token_ms: 7,
	/**
	 * Codex task_complete `error.message`, and `error.codex_error_info`: its
	 * text, or the variant tag of an object (`turn_error_info` keeps the
	 * object as JSON).
	 */
	turn_error: 7,
	turn_error_kind: 7,
	turn_error_info: 7,
	/** Codex `turn_id` of a turn_context, task_started, task_complete or turn_aborted: these precede the turn's prompt in the file, so readers join a turn's rows by it. */
	turn_id: 7,
	/** "true" on a Codex turn_aborted; a Claude record's `interruptedByShutdown` (true/false). */
	aborted: 7,
	/** Codex turn_aborted `reason`. */
	abort_reason: 7,
	/** Codex thread_goal_updated `goal.objective` (the full text is the row's text), `status`, `tokensUsed`, `timeUsedSeconds`. */
	goal: 7,
	goal_status: 7,
	goal_tokens_used: 7,
	goal_time_used_seconds: 7,
	/** Claude user record `permissionMode`. */
	permission_mode: 7,
	/** Claude assistant `message.stop_reason`. */
	stop_reason: 7,
	/** Claude `auto_mode` attachment flags (true/false; `bashFirstSteer` is text, e.g. relaxed). */
	auto_mode_bash_first: 7,
	auto_mode_bash_first_steer: 7,
	auto_mode_bypass: 7,
	auto_mode_steer_only: 7,
	auto_mode_consent_flow: 7,
	/** Claude compaction `compactMetadata.trigger` and `.preTokens`. */
	compact_trigger: 7,
	compact_pre_tokens: 7,
	/** Claude stop_hook_summary `stopReason`, `preventedContinuation` (true/false), `hookCount`. */
	hook_stop_reason: 7,
	prevented_continuation: 7,
	hook_count: 7,
	/** Claude stop_hook_summary `hookErrors` and `hookInfos[{command, durationMs}]`, as JSON arrays cut to whole entries. */
	hook_errors: 7,
	hook_runs: 7,
	/** Entries cut from `hook_errors`, `hook_runs`, `spawned_thread_ids` by the list cap. */
	hook_errors_more: 7,
	hook_runs_more: 7,
	spawned_thread_ids_more: 7,
	/** Comma-separated keys of this record whose value (or a list entry) was cut at its cap. */
	facts_clipped: 7,
	/** Claude assistant API error `error` and `apiErrorStatus`. */
	api_error: 7,
	api_error_status: 7,
	/** Claude system api_error `retryAttempt`, `maxRetries`, `retryInMs`. */
	retry_attempt: 7,
	max_retries: 7,
	retry_in_ms: 7,
	/** Claude model_refusal records `apiRefusalCategory`, `originalModel`, `fallbackModel`. */
	refusal_category: 7,
	original_model: 7,
	fallback_model: 7,
	/** Codex SubAgentActivity `agent_thread_id` / CollabAgentToolCall `receiver_thread_ids`, as a JSON array. */
	spawned_thread_ids: 7,
	// Parser 8: prompt and session facts.
	/** Claude user record `turnOrigin`, `promptSource` and `origin.kind`, each as recorded. */
	turn_origin: 8,
	prompt_source: 8,
	origin_kind: 8,
	/** Codex inter_agent_communication_metadata `trigger_turn` (true/false). */
	trigger_turn: 8,
	/** Codex session_meta `thread_source` (user, subagent, guardian_review). */
	thread_source: 8,
	/** Claude `instructions` attachment `files[{path, type}]`, as a JSON array cut to whole entries; `_more` counts the files cut. */
	instruction_paths: 8,
	instruction_paths_more: 8,
	/** Claude `cost-state` totals (cumulative; the session's last record has the final values). */
	cost_usd: 8,
	lines_added: 8,
	lines_removed: 8,
	tool_duration_ms: 8,
	api_duration_ms: 8,
	api_duration_without_retries_ms: 8,
	has_unknown_model_cost: 8,
	/** Claude `ai-title` `aiTitle` (the full title is also the row's text). */
	title: 8,
	/** Codex `Rejected("…")` message of a refused call: who or what rejected it and why. */
	denial_reason: 8,
	/** Claude `Skill` tool call `input.skill`: the skill the agent invoked. */
	skill: 8,
	/**
	 * Codex CommandExecution `parsed_cmd`: the types Codex gave the command's
	 * parts (read, search, list_files, unknown) as a JSON array, and the paths
	 * of its `read` parts (a skill read is a read of its SKILL.md).
	 */
	parsed_cmd_types: 8,
	parsed_cmd_read_paths: 8,
	parsed_cmd_read_paths_more: 8,
} as const satisfies Record<string, number>;

export type TranscriptRecordFactKey = keyof typeof TRANSCRIPT_RECORD_FACT_KEYS;

/**
 * Literal facts of one record (parser v6): empty, null or an empty map when
 * the record does not carry them.
 */
export interface TranscriptRecordFacts {
	/** Claude Code `version`, Codex session_meta `cli_version`, carried forward in the stream. */
	readonly agentVersion: string;
	/** Claude Code `entrypoint`, Codex session_meta `originator`, carried forward in the stream. */
	readonly entrypoint: string;
	/** Claude `toolDenialKind` of a tool result. */
	readonly denialKind: string;
	readonly durationMs: number | null;
	readonly timedOutAfterMs: number | null;
	readonly interrupted: boolean | null;
	/** Claude tool result `gitOperation` keys (push, pr, branch, commit). */
	readonly gitOperation: readonly string[];
	readonly mcpServer: string;
	readonly mcpTool: string;
	/** Claude assistant `attributionSkill`. */
	readonly attributionSkill: string;
	readonly extra: Readonly<Partial<Record<TranscriptRecordFactKey, string>>>;
}

export const NO_TRANSCRIPT_RECORD_FACTS: TranscriptRecordFacts = {
	agentVersion: "",
	entrypoint: "",
	denialKind: "",
	durationMs: null,
	timedOutAfterMs: null,
	interrupted: null,
	gitOperation: [],
	mcpServer: "",
	mcpTool: "",
	attributionSkill: "",
	extra: {},
};

/** record_idx of the per-revision receipt row. Real lines never reach this. */
export const TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX = 4_294_967_295;

/** Characters kept in `head` (first) and `tail` (last) of every record. */
export const TRANSCRIPT_RECORD_EXCERPT_CHARS = 1_024;

/** Default cap on the full decoded `text` stored per record (UTF-16 code units, without splitting surrogate pairs). */
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
	/** Literal facts the record carries (parser v6). */
	readonly facts: TranscriptRecordFacts;
	/** Whole texts of the setup it carries (`received_setup`), for the writer to store once. */
	readonly setupTexts?: readonly ReceivedSetupText[];
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
	readonly codexForkParentCalls?: Readonly<Record<string, readonly string[]>>;
	/** '' for the main transcript, otherwise the subagent id. */
	readonly agentId?: string;
	readonly content: string;
	/** Timestamp used until a record supplies its own. */
	readonly fallbackTs: string;
	readonly maxParseLineBytes?: number;
	readonly source: TranscriptSource;
	readonly textBudget?: TranscriptTextBudget;
	readonly textMaxChars?: number;
	/** Session fact budget shared by its streams (see `TRANSCRIPT_RECORDS_SESSION_FACT_BUDGET_CHARS`). */
	readonly factBudget?: { remaining: number };
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
