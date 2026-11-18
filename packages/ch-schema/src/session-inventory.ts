import type { RunIndexColumn } from "./run-index.js";

export const SESSION_INVENTORY_TABLE = "rudel.session_inventory";
export const SESSION_INVENTORY_MIGRATION =
	"20261107120000_session_inventory.sql";
export const SESSION_INVENTORY_KEY = [
	"organization_id",
	"user_id",
	"row_kind",
	"source",
	"session_id",
];
export const SESSION_INVENTORY_VERSION = "reported_at";
export const SESSION_INVENTORY_RETENTION_DAYS = 90;
export const SESSION_INVENTORY_TTL = `toDateTime(reported_at) + toIntervalDay(${SESSION_INVENTORY_RETENTION_DAYS})`;
export const SESSION_INVENTORY_COMMENT =
	"Sessions each member's CLI reports on their machine under their upload settings (ids, line counts, sizes, times; no content): a report row per member and a session row per session, replaced by newer reports. Kept 90 days after the last report.";

export const SESSION_INVENTORY_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Workspace the member's CLI reported the sessions to.",
	},
	{
		name: "user_id",
		type: "String",
		comment: "Member whose machine holds the sessions.",
	},
	{
		name: "row_kind",
		type: "LowCardinality(String)",
		comment:
			"report: the member's latest inventory (time, CLI version, totals); session: one session it listed.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Agent of the session (claude_code, codex); empty on the report.",
	},
	{
		name: "session_id",
		type: "String",
		comment: "Session id; empty on the report.",
	},
	{
		name: "reported_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"UTC time the API received the inventory; the replacing version, so each row keeps its latest report.",
	},
	{
		name: "main_lines",
		type: "UInt32",
		comment:
			"Non-empty lines of the session's main transcript on the machine; 0 on the report.",
	},
	{
		name: "subagent_lines",
		type: "UInt32",
		comment:
			"Non-empty lines of the subagent transcripts an upload of the session would include; 0 on the report.",
	},
	{
		name: "subagent_files",
		type: "UInt32",
		comment:
			"Subagent transcripts an upload of the session would include; 0 on the report.",
	},
	{
		name: "main_bytes",
		type: "UInt64",
		comment: "Bytes of the main transcript on the machine; 0 on the report.",
	},
	{
		name: "subagent_bytes",
		type: "UInt64",
		comment:
			"Bytes of the subagent transcripts an upload would include; 0 on the report.",
	},
	{
		name: "modified_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"Newest modification time of the session's files on the machine; the report time on the report.",
	},
	{
		name: "started_at",
		type: "Nullable(DateTime64(3, 'UTC'))",
		comment:
			"First timestamp the CLI read at the start of the transcript; NULL when it found none, and on the report.",
	},
	{
		name: "cli_version",
		type: "String",
		comment: "Report: version of the CLI that sent it; empty on sessions.",
	},
	{
		name: "session_count",
		type: "UInt32",
		comment: "Report: sessions the inventory listed; 0 on sessions.",
	},
	{
		name: "omitted_count",
		type: "UInt32",
		comment:
			"Report: sessions the CLI found but left out of the inventory at its size cap; 0 on sessions.",
	},
];
