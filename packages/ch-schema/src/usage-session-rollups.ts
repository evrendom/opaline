import type { RunIndexColumn } from "./run-index.js";

export const USAGE_SESSION_ROLLUPS_TABLE = "rudel.usage_session_rollups";

export const USAGE_SESSION_ROLLUPS_KEY = [
	"organization_id",
	"user_id",
	"source",
	"session_id",
];
export const USAGE_SESSION_ROLLUPS_VERSION = "receipt_generation";
export const USAGE_SESSION_ROLLUPS_COMMENT =
	"Request usage of a session summed per pricing group (date, model identity, provider, tier, speed, geography, context band), one row per session from its latest usage-event generation; priced against the rate card at read time.";

export const USAGE_SESSION_ROLLUP_COLUMNS: readonly RunIndexColumn[] = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{ name: "user_id", type: "String", comment: "Session owner." },
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Agent source, as in usage_events.",
	},
	{
		name: "session_id",
		type: "String",
		comment: "Native session ID within organization, user and source.",
	},
	{
		name: "receipt_generation",
		type: "UInt64",
		comment:
			"Usage-event generation of the latest receipt the row was built from; 0 without one. The replacing version.",
	},
	{
		name: "is_consistent",
		type: "UInt8",
		comment:
			"1 when that receipt is complete, not deleted and its generation holds exactly its event count; only these sessions are priced.",
	},
	{
		name: "latest_main_model",
		type: "LowCardinality(String)",
		comment:
			"Model of the main thread's latest request in that generation; empty when unknown.",
	},
	{
		name: "latest_event_model",
		type: "LowCardinality(String)",
		comment:
			"Model of the latest request of any thread in that generation; empty when unknown.",
	},
	{
		name: "record_kinds",
		type: "Array(LowCardinality(String))",
		comment: "Per pricing group: event or receipt.",
	},
	{
		name: "usage_dates",
		type: "Array(Date)",
		comment: "Per pricing group: UTC usage date.",
	},
	{
		name: "pricing_identities",
		type: "Array(LowCardinality(String))",
		comment:
			"Per pricing group: the raw model when unresolved, else the resolved model.",
	},
	{
		name: "model_providers",
		type: "Array(LowCardinality(String))",
		comment: "Per pricing group: recorded model provider.",
	},
	{
		name: "service_tiers",
		type: "Array(LowCardinality(String))",
		comment: "Per pricing group: recorded service tier.",
	},
	{
		name: "inference_speeds",
		type: "Array(LowCardinality(String))",
		comment: "Per pricing group: recorded inference speed.",
	},
	{
		name: "inference_geos",
		type: "Array(LowCardinality(String))",
		comment: "Per pricing group: recorded inference geography.",
	},
	{
		name: "context_bands",
		type: "Array(LowCardinality(String))",
		comment:
			"Per pricing group: long when the request context exceeded its model's long-context threshold, else base.",
	},
	{
		name: "priceable",
		type: "Array(UInt8)",
		comment:
			"Per pricing group: 1 when its requests pass the pricing quality checks.",
	},
	{
		name: "geo_gaps",
		type: "Array(UInt8)",
		comment:
			"Per pricing group: 1 when the provider reported no billing geography.",
	},
	{
		name: "uncached_input_tokens",
		type: "Array(UInt64)",
		comment: "Per pricing group: uncached input tokens.",
	},
	{
		name: "cache_read_input_tokens",
		type: "Array(UInt64)",
		comment: "Per pricing group: cache read input tokens.",
	},
	{
		name: "cache_write_5m_input_tokens",
		type: "Array(UInt64)",
		comment: "Per pricing group: 5-minute cache write input tokens.",
	},
	{
		name: "cache_write_1h_input_tokens",
		type: "Array(UInt64)",
		comment: "Per pricing group: 1-hour cache write input tokens.",
	},
	{
		name: "output_tokens",
		type: "Array(UInt64)",
		comment: "Per pricing group: output tokens.",
	},
	{
		name: "build_version",
		type: "UInt32",
		comment:
			"Fingerprint of the grouping rules that built the row; rows of another fingerprint are rebuilt.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the row was built.",
	},
	{
		name: "retry_after",
		type: "DateTime64(3, 'UTC')",
		comment:
			"After a failed rebuild, the backfill leaves the session alone until this UTC time; the epoch otherwise.",
	},
];
