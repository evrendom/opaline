import type { RunIndexColumn } from "./run-index.js";

/**
 * Received setup (CONTEXT.md "Received setup", OPL-391): the setup text an
 * agent received in a run, as its transcript records it. Without the schema
 * toolkit, so the API's writers, builder and SQL views import the columns at
 * runtime (`@rudel/ch-schema/received-setup`).
 *
 * - `rudel.setup_texts` holds each distinct text once per member, keyed by its
 *   SHA-256 (the setup file version). The transcript-records writer stores it
 *   before the generation's receipt. Per member, so deleting an account
 *   deletes its copies and nothing another member received.
 * - `rudel.run_setup` ties each run to the setup file versions it had: one row
 *   per run of a run index build and setup file version, written with the
 *   build's runs and committed by its receipt, like `rudel.run_requests`.
 *
 * Both are kept until a deletion request, like the transcripts they come from.
 */

export const SETUP_TEXTS_TABLE = "rudel.setup_texts";
export const RUN_SETUP_TABLE = "rudel.run_setup";

export const SETUP_TEXTS_KEY = ["organization_id", "user_id", "version"];
export const SETUP_TEXTS_COMMENT =
	"Received setup texts (instruction files, skill bodies, MCP instructions, system prompts), each distinct text once per member under its SHA-256; written by the transcript-records writer.";

/** Every column of `rudel.setup_texts`, in table order. */
export const SETUP_TEXT_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{
		name: "user_id",
		type: "String",
		comment:
			"Member whose session received the text; each member's copy is deleted with their account.",
	},
	{
		name: "version",
		type: "String",
		comment:
			"SHA-256 (hex) of the whole text as UTF-8: the setup file version.",
	},
	{
		name: "chars",
		type: "UInt32",
		comment: "Code points of the whole text.",
	},
	{
		name: "text",
		type: "String",
		comment:
			"The text as the agent received it; its first 1,048,576 UTF-16 code units when longer (text_cut).",
	},
	{
		name: "text_cut",
		type: "Bool",
		comment: "Whether text holds only the start of a longer text.",
	},
	{
		name: "written_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the writer stored this copy.",
	},
];

export const RUN_SETUP_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"index_version",
	"build_revision",
	"agent_id",
	"run_start_record",
	"setup_file",
	"version",
];
export const RUN_SETUP_COMMENT =
	"Received setup of each run of a run index build: one row per run and setup file version it had, committed by the build's run index receipt; written only by the reconciliation worker.";

/** Every column of `rudel.run_setup`, in table order. */
export const RUN_SETUP_COLUMNS: readonly RunIndexColumn[] = [
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
		name: "revision",
		type: "UInt64",
		comment: "Raw transcript revision of the run index build's generation.",
	},
	{
		name: "parser_version",
		type: "UInt16",
		comment: "Transcript records parser version of the generation.",
	},
	{
		name: "index_version",
		type: "UInt16",
		comment: "Run index rules version of the build.",
	},
	{
		name: "build_revision",
		type: "UInt64",
		comment:
			"Run index build that wrote the row; the session's newest run index receipt names the build readers read.",
	},
	{
		name: "agent_id",
		type: "String",
		comment: "Transcript stream; empty for the main stream.",
	},
	{
		name: "run_start_record",
		type: "UInt32",
		comment: "start_record of the run (run_index.start_record).",
	},
	{
		name: "setup_file",
		type: "String",
		comment:
			"The setup file, named by where it lives rather than by a machine path: repository:<repository>:<path>, plugin:<plugin>:<path>, member:<member>:<path>, harness:<agent>:<part> or mcp:<server>.",
	},
	{
		name: "version",
		type: "String",
		comment:
			"SHA-256 (hex) of the text received: the setup file version; setup_texts holds the text.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "run_id",
		type: "String",
		comment: "Run node id of the run (run_index.run_id).",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker wrote the row.",
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		comment: "Session date of the generation.",
	},
	{
		name: "run_started_at",
		type: "DateTime64(3, 'UTC')",
		comment: "When the run started (run_index.started_at).",
	},
	{
		name: "kind",
		type: "LowCardinality(String)",
		comment:
			"What was received: system_prompt, instructions (CLAUDE.md files loaded at the start), nested_memory (a CLAUDE.md loaded on entering its directory), skill_body, mcp_instructions, agents_md, developer (a block of a Codex developer message).",
	},
	{
		name: "scope",
		type: "LowCardinality(String)",
		comment:
			"Where the setup file lives: repository, plugin, member (the member's home or another machine path), harness (the agent's own text) or mcp (an MCP server).",
	},
	{
		name: "owner",
		type: "String",
		comment:
			"The repository (host/owner/name), plugin (name@marketplace), member (user id), agent (claude_code, codex) or MCP server the setup file belongs to.",
	},
	{
		name: "path",
		type: "String",
		comment:
			"Path of the setup file within its owner: relative to the repository or plugin root, ~/… in a member's home; the harness part or empty for harness and MCP text.",
	},
	{
		name: "recorded_path",
		type: "String",
		comment:
			"The machine path the transcript names; empty for harness and MCP text.",
	},
	{
		name: "cwd",
		type: "String",
		comment:
			"Working directory the transcript recorded when the text was received; empty when not recorded.",
	},
	{
		name: "chars",
		type: "UInt32",
		comment: "Code points of the text received.",
	},
	{
		name: "version_name",
		type: "String",
		comment:
			"The version as shown: its first 12 hex digits, followed by 'uncommitted by <member>' when the text was uncommitted in that member's checkout.",
	},
	{
		name: "uncommitted",
		type: "Nullable(Bool)",
		comment:
			"For a repository file: true when the git status the session recorded at its start lists the file as changed, or the session changed the file before receiving it; false when that status was recorded whole without it; NULL when unknown (no git status recorded, a cut status, not a repository file).",
	},
	{
		name: "carried",
		type: "Bool",
		comment:
			"True when the text was received before the run started (earlier in its stream) and was still the latest version of its setup file; false when received during the run.",
	},
	{
		name: "compacted_since",
		type: "Bool",
		comment:
			"True when the stream recorded a compaction between receiving the text and the run's end: the text may have left the context.",
	},
	{
		name: "received_record",
		type: "UInt32",
		comment: "Raw record index of the line that carried the text.",
	},
	{
		name: "received_block",
		type: "UInt16",
		comment: "Block of that line's record.",
	},
	{
		name: "received_at",
		type: "DateTime64(3, 'UTC')",
		comment: "Time of the line that carried the text.",
	},
];
