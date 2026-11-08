import type { RunIndexColumn } from "./run-index.js";

export const CALL_FACTS_TABLE = "rudel.call_facts";
export const CALL_FACTS_MIGRATION = "20261108120000_call_facts.sql";

export const CALL_FACTS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"index_version",
	"build_revision",
	"agent_id",
	"record_idx",
	"block_idx",
] as const;

export const CALL_FACTS_STARTED_AT_INDEX = {
	name: "started_at_minmax",
	expression: "started_at",
	type: "minmax",
	granularity: 1,
} as const;

export const CALL_FACTS_COMMENT =
	"L1 tool calls of each run index build, every stream, one row per call with its command identity, files and outcome; committed by the build's run index receipt; written only by the reconciliation worker.";

const nullableTime = "Nullable(DateTime64(3, 'UTC'))";

export const CALL_FACTS_COLUMNS: readonly RunIndexColumn[] = [
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
		name: "record_idx",
		type: "UInt32",
		comment: "Raw record index of the call's first tool_call record.",
	},
	{
		name: "block_idx",
		type: "UInt16",
		comment: "Block of that record.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "stream_kind",
		type: "LowCardinality(String)",
		comment:
			"main, subagent (a Claude Code subagent stream) or codex_thread (a Codex thread a parent started: a stream of the session, or a session whose thread_source is subagent).",
	},
	{
		name: "call_id",
		type: "String",
		comment: "The call's id within its stream, as recorded.",
	},
	{
		name: "run_id",
		type: "String",
		comment:
			"Run node id of the call's run (run_index.run_id); empty for a call before its stream's first prompt.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream; 0 before the first prompt.",
	},
	{
		name: "repository",
		type: "String",
		comment: "The session's repository key as uploaded (run_index.repository).",
	},
	{
		name: "model",
		type: "LowCardinality(Nullable(String))",
		comment:
			"Model of the response that made the call (run_requests.usage_model), else of its run (run_index.model); NULL when neither names one.",
	},
	{
		name: "run_started_at",
		type: nullableTime,
		comment: "When the call's run started; NULL without a run.",
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		comment: "Session date of the generation.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker wrote the row.",
	},
	{
		name: "call_level",
		type: "LowCardinality(String)",
		comment:
			"top, script (a Codex code-mode script) or inner (a call a script ran).",
	},
	{
		name: "parent_call_id",
		type: "String",
		comment: "For an inner call, the call_id of the script that ran it.",
	},
	{
		name: "tool_name",
		type: "LowCardinality(String)",
		comment: "Tool the agent called, as recorded.",
	},
	{
		name: "started_at",
		type: "DateTime64(3, 'UTC')",
		comment: "Timestamp of the call record.",
	},
	{
		name: "finished_at",
		type: nullableTime,
		comment:
			"When the call's work finished: its background task's ending notification, else its last result; NULL when unknown.",
	},
	{
		name: "call_minutes",
		type: "Nullable(Float64)",
		comment: "Minutes from the call record to finished_at; NULL when unknown.",
	},
	{
		name: "has_result",
		type: "UInt8",
		comment: "1 when the call has a result in the transcript.",
	},
	{
		name: "failed",
		type: "UInt8",
		comment:
			"1 when a result is an error or exits non-zero, or its background task ended failed or killed.",
	},
	{
		name: "error_from_call_id",
		type: "String",
		comment:
			"On a script whose failure an inner call records, that inner call's call_id.",
	},
	{
		name: "exit_code",
		type: "Nullable(Int32)",
		comment: "Exit code a result or its background task recorded.",
	},
	{
		name: "denial_kind",
		type: "LowCardinality(String)",
		comment: "Why the call was refused before it ran; empty when it was not.",
	},
	{
		name: "denial_reason",
		type: "String",
		comment: "What the refusal said; empty when none was recorded.",
	},
	{
		name: "interrupted",
		type: "Nullable(UInt8)",
		comment:
			"1 when a result records an interruption; NULL when the stream cannot record it.",
	},
	{
		name: "timed_out",
		type: "Nullable(UInt8)",
		comment:
			"1 when the call's own timeout stopped it; NULL when the stream cannot record it.",
	},
	{
		name: "timed_out_after_ms",
		type: "Nullable(UInt32)",
		comment: "The timeout limit in milliseconds; NULL when timed_out is not 1.",
	},
	{
		name: "backgrounded",
		type: "UInt8",
		comment: "1 when the call's work went on in the background.",
	},
	{
		name: "task_id",
		type: "Nullable(String)",
		comment: "The background task's id; NULL when not backgrounded.",
	},
	{
		name: "background_status",
		type: "Nullable(String)",
		comment:
			"completed, failed, killed or stopped, from the latest task notification; NULL when none reported an end.",
	},
	{
		name: "background_exit_code",
		type: "Nullable(Int32)",
		comment: "Exit code the background task's latest notification reported.",
	},
	{
		name: "file_path",
		type: "String",
		comment:
			"File the call names, else the first file it changes; absolute where the working directory is known (parser 15).",
	},
	{
		name: "file_op",
		type: "LowCardinality(String)",
		comment: "read, write, edit or delete for file_path; empty otherwise.",
	},
	{
		name: "command_class",
		type: "LowCardinality(String)",
		comment: "The shell command's class, the first by precedence.",
	},
	{
		name: "command_classes",
		type: "Array(String)",
		comment: "The class of each program the shell command runs.",
	},
	{
		name: "command_from",
		type: "String",
		comment:
			"command or script; empty when the call carries no command (the calls view's meaning).",
	},
	{
		name: "command",
		type: "Nullable(String)",
		comment:
			"The command or script text as stored (its stored start when only that is); NULL when the call carries none.",
	},
	{
		name: "command_chars",
		type: "Nullable(UInt64)",
		comment:
			"Characters of the command; NULL when only part is stored or there is none.",
	},
	{
		name: "command_argv0",
		type: "Nullable(String)",
		comment: "The program the shell command runs, computed at build time.",
	},
	{
		name: "command_prefix",
		type: "Nullable(String)",
		comment: "The program and its subcommand, computed at build time.",
	},
	{
		name: "command_programs",
		type: "Array(String)",
		comment: "Each program of the command's chains and pipelines.",
	},
	{
		name: "command_prefixes",
		type: "Array(String)",
		comment:
			"Each program with its subcommand, as command_programs lists them.",
	},
	{
		name: "command_fingerprint",
		type: "Nullable(UInt64)",
		comment: "cityHash64 of the normalized command.",
	},
	{
		name: "command_simhash",
		type: "Nullable(UInt64)",
		comment:
			"Word-shingle simhash of the normalized command; NULL under 20 words.",
	},
	{
		name: "command_head",
		type: "Nullable(String)",
		comment: "The first 300 bytes of a shell command's stored text.",
	},
	{
		name: "changed_files",
		type: "Array(String)",
		comment: "Every file the call asks to change, in order.",
	},
	{
		name: "changed_file_ops",
		type: "Array(String)",
		comment: "write, edit or delete for each of changed_files.",
	},
	{
		name: "changed_files_basis",
		type: "Array(String)",
		comment: "tool, shell or script for each of changed_files.",
	},
	{
		name: "files_read",
		type: "Array(String)",
		comment: "Every file the call reads, in order.",
	},
	{
		name: "setup_files_read",
		type: "Array(String)",
		comment:
			"The setup files (received setup naming) of the instruction and skill files among files_read: CLAUDE.md, CLAUDE.local.md, AGENTS.md, AGENTS.override.md, SKILL.md and .claude/rules files.",
	},
	{
		name: "setup_paths_read",
		type: "Array(String)",
		comment: "The path read for each of setup_files_read.",
	},
	{
		name: "edit_route",
		type: "LowCardinality(String)",
		comment: "How the call changed files; empty when it changed none.",
	},
	{
		name: "error",
		type: "Nullable(String)",
		comment:
			"The line of a failed or refused call's result that names the error, up to 300 bytes; NULL otherwise.",
	},
	{
		name: "output_chars",
		type: "UInt64",
		comment: "Characters of the call's results before any cap.",
	},
	{
		name: "output_cut",
		type: "UInt8",
		comment:
			"1 when part of the output was not stored; the output text stays in transcript_records.",
	},
];
