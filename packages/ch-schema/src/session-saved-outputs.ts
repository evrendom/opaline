import type { RunIndexColumn } from "./run-index.js";

/**
 * Saved outputs of a session (gap A1): the background task outputs and the
 * large tool outputs Claude Code saves next to a session, as the CLI uploads
 * them with the session's evidence captures. Without the schema toolkit, so
 * the API's writer and reader import the columns at runtime
 * (`@rudel/ch-schema/session-saved-outputs`).
 *
 * One row per session and saved file (`root_id`, `path`), whichever capture
 * last saw it: a capture's row replaces an earlier capture's row of the same
 * file (a growing task log is longer later), except that a row with content
 * is never replaced by one without (`version`). The text itself stays in the
 * evidence object store under `blob_object_id`.
 *
 * Kept until a deletion request, like the transcripts the files belong to.
 */

export const SESSION_SAVED_OUTPUTS_TABLE = "rudel.session_saved_outputs";

export const SESSION_SAVED_OUTPUTS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"session_source",
	"root_id",
	"path",
];
export const SESSION_SAVED_OUTPUTS_VERSION = "version";
export const SESSION_SAVED_OUTPUTS_COMMENT =
	"Saved outputs of a session (background task outputs, large tool outputs) as its evidence captures uploaded them: one row per session and file, the latest capture's; the text is the evidence object blob_object_id.";

/** Every column of `rudel.session_saved_outputs`, in table order. */
export const SESSION_SAVED_OUTPUT_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{ name: "user_id", type: "String", comment: "Session owner." },
	{
		name: "session_id",
		type: "String",
		comment: "Native session ID within organization and user.",
	},
	{
		name: "session_source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "root_id",
		type: "LowCardinality(String)",
		comment:
			"Capture root of the file: claude-task-outputs (the session's tasks directory) or claude-tool-results (its tool-results directory).",
	},
	{
		name: "path",
		type: "String",
		comment:
			"Path relative to the root: <task id>.output or rerooted/<task id>.output for a task output, the file name for a tool output.",
	},
	{
		name: "kind",
		type: "LowCardinality(String)",
		comment:
			"task_output (a background Bash, Monitor or agent task) or tool_result (a tool output too large for the transcript).",
	},
	{
		name: "task_id",
		type: "String",
		comment:
			"Claude Code's background task id (L1 facts['task_id']); empty for a tool output.",
	},
	{
		name: "tool_use_id",
		type: "String",
		comment:
			"Tool call that started the task or produced the tool output, as the transcript names it; empty when unknown.",
	},
	{
		name: "agent_id",
		type: "String",
		comment:
			"Transcript stream of the referencing record; empty for the main stream or no reference.",
	},
	{
		name: "record_idx",
		type: "UInt32",
		comment:
			"1-based JSONL line of the referencing record in its stream (the starting call's result when known); 0 without a reference.",
	},
	{
		name: "entry_kind",
		type: "LowCardinality(String)",
		comment:
			"What was on disk: file, symlink (an async agent's output, a link to its subagent transcript; never read) or empty for missing.",
	},
	{
		name: "status",
		type: "LowCardinality(String)",
		comment:
			"captured (whole file), truncated (its tail), reused (content sent with an earlier capture, blob_capture_id), omitted (file seen, content not kept: omitted_reason), symlink, or missing (named by the transcript, not on disk at capture time).",
	},
	{
		name: "omitted_reason",
		type: "LowCardinality(String)",
		comment:
			"Why an omitted file's content was not kept (the CLI's reason, e.g. file-content-cap, binary); empty otherwise.",
	},
	{
		name: "blob_object_id",
		type: "String",
		comment:
			"Evidence object (sha256:<hex>) holding the secret-filtered text; empty without content.",
	},
	{
		name: "blob_capture_id",
		type: "String",
		comment:
			"Capture whose upload carried the blob: this capture, or the earlier one of a reused blob.",
	},
	{
		name: "source_bytes",
		type: "UInt64",
		comment: "Bytes of the file that the stored text was made from.",
	},
	{
		name: "stored_bytes",
		type: "UInt64",
		comment: "Bytes of the stored, secret-filtered text.",
	},
	{
		name: "original_bytes",
		type: "UInt64",
		comment:
			"Size of the whole file when only its tail was kept (truncated); 0 otherwise.",
	},
	{
		name: "truncated",
		type: "Bool",
		comment: "Whether the stored text is only the end of a longer file.",
	},
	{
		name: "file_modified_at",
		type: "Nullable(DateTime64(3, 'UTC'))",
		comment:
			"Modification time of the file at capture time; NULL when missing.",
	},
	{
		name: "capture_id",
		type: "String",
		comment: "Evidence capture (context id) that wrote the row.",
	},
	{
		name: "captured_at",
		type: "DateTime64(3, 'UTC')",
		comment: "When that capture completed on the member's machine.",
	},
	{
		name: "capture_reason",
		type: "LowCardinality(String)",
		comment:
			"Empty for a capture at the session's own time; task-output-sweep for a later one-time capture of the session's saved outputs.",
	},
	{
		name: "version",
		type: "UInt64",
		comment:
			"Replacing version: rank (3 with content or a symlink, 2 omitted, 1 missing) * 2^48 + captured_at in ms, so a later capture replaces an earlier one unless it knows less.",
	},
	{
		name: "written_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"UTC millisecond time the API accepted the capture and staged the row.",
	},
];
