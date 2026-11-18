import { schema, table } from "@chkit/core";

const rudel_session_language_signals = table({
	database: "rudel",
	name: "session_language_signals",
	engine: "SharedReplacingMergeTree(signal_version)",
	columns: [
		{ name: "organization_id", type: "String" },
		{ name: "session_date", type: "DateTime64(3, 'UTC')" },
		{ name: "session_id", type: "String" },
		{ name: "user_id", type: "String" },
		{ name: "source", type: "LowCardinality(String)" },
		{
			name: "raw_revision",
			type: "UInt64",
			default:
				"fn:bitShiftLeft(toUInt64(toUnixTimestamp64Milli(raw_ingested_at)), 16)",
		},
		{ name: "raw_ingested_at", type: "DateTime64(3, 'UTC')" },
		{ name: "scan_version", type: "UInt16" },
		{
			name: "agent_runs",
			type: "Array(Tuple(String, DateTime64(3, 'UTC'), Float64, String, UInt8, String))",
			default: "fn:[]",
		},
		{ name: "member_negative", type: "UInt32", default: "fn:0" },
		{ name: "member_swears", type: "UInt32" },
		{ name: "member_apologies", type: "UInt32" },
		{ name: "member_positive", type: "UInt32" },
		{ name: "model_swears", type: "UInt32" },
		{ name: "model_apologies", type: "UInt32" },
		{ name: "model_positive", type: "UInt32" },
		{ name: "member_swear_matches", type: "Array(String)", default: "fn:[]" },
		{
			name: "member_apology_matches",
			type: "Array(String)",
			default: "fn:[]",
		},
		{
			name: "member_positive_matches",
			type: "Array(String)",
			default: "fn:[]",
		},
		{ name: "model_swear_matches", type: "Array(String)", default: "fn:[]" },
		{
			name: "model_apology_matches",
			type: "Array(String)",
			default: "fn:[]",
		},
		{
			name: "model_positive_matches",
			type: "Array(String)",
			default: "fn:[]",
		},
		{
			name: "model_apology_counts",
			type: "Map(String, UInt32)",
			default: "fn:map()",
		},
		{
			name: "member_negative_counts",
			type: "Map(String, UInt32)",
			default: "fn:map()",
		},
		{
			name: "member_positive_counts",
			type: "Map(String, UInt32)",
			default: "fn:map()",
		},
		{ name: "scanned_at", type: "DateTime64(3, 'UTC')" },
		{
			name: "signal_version",
			type: "UInt128",
			default:
				"fn:bitShiftLeft(toUInt128(raw_revision), 64) + bitShiftLeft(toUInt128(toUnixTimestamp64Milli(scanned_at)), 16) + toUInt128(scan_version)",
		},
	],
	primaryKey: [],
	orderBy: ["organization_id", "session_date", "session_id", "source"],
	partitionBy: "toYYYYMM(toDate(session_date))",
	ttl: "toDate(session_date) + toIntervalDay(365)",
	settings: {
		index_granularity: "8192",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
});

export default schema(rudel_session_language_signals);
