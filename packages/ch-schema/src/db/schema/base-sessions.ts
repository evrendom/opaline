import type { ColumnDefinition } from "@chkit/core";

export const baseSessionColumns: ColumnDefinition[] = [
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		default: "fn:now64(3)",
	},
	{
		name: "last_interaction_date",
		type: "DateTime64(3, 'UTC')",
		default: "fn:now64(3)",
	},
	{ name: "session_id", type: "String" },
	{ name: "organization_id", type: "String" },
	{ name: "project_path", type: "String" },
	{ name: "git_remote", type: "String", default: "''" },
	{ name: "package_name", type: "String", default: "''" },
	{ name: "package_type", type: "String", default: "''" },
	{ name: "content", type: "String" },
	{ name: "filter_version", type: "UInt8", default: "fn:0" },
	{
		name: "revision",
		type: "UInt64",
		default:
			"fn:bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16)",
	},
	{
		name: "ingested_at",
		type: "DateTime64(3, 'UTC')",
		default: "fn:now64(3)",
	},
	{ name: "user_id", type: "String" },
	{ name: "git_branch", type: "String", nullable: true },
	{ name: "git_sha", type: "String", nullable: true },
	{ name: "tag", type: "String", nullable: true },
];

// Raw session tables intentionally store revision history. session_date is
// content-derived and may change between revisions, so consumers must select
// the max-revision winner grouped by immutable
// (organization_id, user_id, session_id) identity; FINAL is not a logical-
// session boundary for these tables.
export const baseSessionTableConfig = {
	primaryKey: ["organization_id", "session_date", "session_id"],
	orderBy: ["organization_id", "session_date", "session_id"],
	partitionBy: "toYYYYMM(toDate(session_date))",
	ttl: "toDate(session_date) + toIntervalDay(365)",
	settings: {
		index_granularity: "8192" as const,
		non_replicated_deduplication_window: "1000" as const,
		storage_policy: "'s3'" as const,
	},
};
