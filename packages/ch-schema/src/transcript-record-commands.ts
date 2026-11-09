import type { RunIndexColumn } from "./run-index.js";

export const TRANSCRIPT_RECORD_COMMANDS_TABLE =
	"rudel.transcript_record_commands";

export const TRANSCRIPT_RECORD_COMMANDS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"agent_id",
	"record_idx",
	"block_idx",
];

export const TRANSCRIPT_RECORD_COMMANDS_VERSION = "built_at";
export const TRANSCRIPT_RECORD_COMMANDS_COMMENT =
	"Command identity of each transcript record that carries a command (a shell call, a Codex code-mode script, a written script file), computed once per transcript generation with the same expressions find source=calls used per query; a row at the receipt record index marks a generation as complete.";

export const TRANSCRIPT_RECORD_COMMAND_COLUMNS: readonly RunIndexColumn[] = [
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
		comment: "Raw transcript revision of the record's generation.",
	},
	{
		name: "parser_version",
		type: "UInt16",
		comment: "Transcript records parser version of the generation.",
	},
	{
		name: "agent_id",
		type: "String",
		comment: "Transcript stream; empty for the main stream.",
	},
	{
		name: "record_idx",
		type: "UInt32",
		comment:
			"Record index as in transcript_records; the receipt record index marks a complete generation.",
	},
	{ name: "block_idx", type: "UInt16", comment: "Block of that record." },
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		comment: "Session date of the generation.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream, as in transcript_records.",
	},
	{
		name: "ts",
		type: "DateTime64(3, 'UTC')",
		comment: "Timestamp of the record.",
	},
	{
		name: "tool_name",
		type: "LowCardinality(String)",
		comment: "Tool the record names, as recorded.",
	},
	{
		name: "file_path",
		type: "String",
		comment: "File the record names, as in transcript_records.",
	},
	{
		name: "call_id",
		type: "String",
		comment: "The call's id within its stream.",
	},
	{
		name: "head",
		type: "String",
		comment: "The record's stored head, as in transcript_records.",
	},
	{
		name: "command_from",
		type: "LowCardinality(String)",
		comment: "command, script or written; empty only on the receipt row.",
	},
	{
		name: "command_text",
		type: "Nullable(String)",
		comment:
			"The command or script text; NULL when transcript_records stores only part of it.",
	},
	{
		name: "command_argv0",
		type: "Nullable(String)",
		comment: "The program a shell command runs; NULL for scripts.",
	},
	{
		name: "command_prefix",
		type: "Nullable(String)",
		comment: "The program and its subcommand; NULL for scripts.",
	},
	{
		name: "command_normalized",
		type: "Nullable(String)",
		comment:
			"The normalized text the fingerprint and simhash hash; NULL without command_text.",
	},
	{
		name: "command_fingerprint",
		type: "Nullable(UInt64)",
		comment: "cityHash64 of command_normalized.",
	},
	{
		name: "command_simhash",
		type: "Nullable(UInt64)",
		comment: "Word-shingle simhash of command_normalized; NULL under 20 words.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"UTC millisecond time the row was computed; the replacing version.",
	},
];
