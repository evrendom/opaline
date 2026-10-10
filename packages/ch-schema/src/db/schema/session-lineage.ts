import { schema, table } from "@chkit/core";

const rudel_session_lineage = table({
	database: "rudel",
	name: "session_lineage",
	engine: "SharedReplacingMergeTree(replacement_version)",
	columns: [
		{ name: "organization_id", type: "String" },
		{ name: "user_id", type: "String" },
		{ name: "child_source", type: "LowCardinality(String)" },
		{ name: "child_session_id", type: "String" },
		{ name: "child_session_date", type: "DateTime64(3, 'UTC')" },
		{ name: "child_first_ingested_at", type: "DateTime64(3, 'UTC')" },
		{ name: "child_start_ts", type: "DateTime64(3, 'UTC')" },
		{ name: "child_model", type: "String" },
		{
			name: "child_originator",
			type: "LowCardinality(String)",
			default: "''",
		},
		{
			name: "child_entrypoint",
			type: "LowCardinality(String)",
			default: "''",
		},
		{ name: "parent_source", type: "LowCardinality(String)" },
		{ name: "parent_session_id", type: "String" },
		{ name: "parent_session_date", type: "DateTime64(3, 'UTC')" },
		{ name: "anchor_ts", type: "DateTime64(3, 'UTC')" },
		{ name: "anchor_tool_use_id", type: "String" },
		{ name: "anchor_operation_ordinal", type: "UInt16" },
		{ name: "carrier", type: "LowCardinality(String)" },
		{ name: "outcome", type: "LowCardinality(String)" },
		{ name: "confidence", type: "LowCardinality(String)" },
		{ name: "countable", type: "UInt8" },
		{ name: "reason", type: "String" },
		{ name: "workdir", type: "String", default: "''" },
		{ name: "prompt_fingerprint", type: "FixedString(64)" },
		{ name: "derivation_version", type: "UInt16" },
		{ name: "input_sequence", type: "UInt64" },
		{ name: "replacement_version", type: "UInt64" },
		{ name: "derived_at", type: "DateTime64(3, 'UTC')" },
	],
	primaryKey: [
		"organization_id",
		"user_id",
		"child_source",
		"child_session_id",
	],
	orderBy: ["organization_id", "user_id", "child_source", "child_session_id"],
	settings: {
		index_granularity: "8192",
		storage_policy: "'s3'",
	},
});

export default schema(rudel_session_lineage);
