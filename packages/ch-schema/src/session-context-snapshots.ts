import type { RunIndexColumn } from "./run-index.js";

export const SESSION_CONTEXT_SNAPSHOTS_TABLE =
	"rudel.session_context_snapshots";

export const SESSION_CONTEXT_SNAPSHOTS_KEY = [
	"organization_id",
	"user_id",
	"session_id",
];
export const SESSION_CONTEXT_SNAPSHOTS_VERSION = "built_at";
export const SESSION_CONTEXT_SNAPSHOTS_COMMENT =
	"Context snapshots of a session: the parts that filled its fullest moment, as its session page draws them; one row per session, the latest build's.";

export const SESSION_CONTEXT_SNAPSHOT_COLUMNS: readonly RunIndexColumn[] = [
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
		type: "String",
		comment: "Transcript revision the snapshot was built from.",
	},
	{
		name: "index_version",
		type: "UInt16",
		comment: "Run index version of the build that wrote it.",
	},
	{
		name: "model",
		type: "LowCardinality(String)",
		comment: "Model of the fullest call; empty when unknown.",
	},
	{
		name: "used_tokens",
		type: "UInt64",
		comment: "Tokens the fullest call sent.",
	},
	{
		name: "window_tokens",
		type: "UInt64",
		comment: "Context window of that call's model, in tokens.",
	},
	{
		name: "part_keys",
		type: "Array(String)",
		comment: "Key of each part of the default view, largest first.",
	},
	{
		name: "part_kinds",
		type: "Array(LowCardinality(String))",
		comment: "Kind of each part, in part_keys order.",
	},
	{
		name: "part_labels",
		type: "Array(String)",
		comment: "Label of each part, in part_keys order.",
	},
	{
		name: "part_tokens",
		type: "Array(UInt64)",
		comment: "Tokens of each part, in part_keys order.",
	},
	{
		name: "snapshot",
		type: "String",
		comment:
			"The whole snapshot as JSON (SessionContextSnapshot): each view's context map, compaction runs and costs.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker built it; the replacing version.",
	},
];
