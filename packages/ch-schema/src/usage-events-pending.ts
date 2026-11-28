import type { RunIndexColumn } from "./run-index.js";

export const USAGE_EVENTS_PENDING_TABLE = "rudel.usage_events_pending";

export const USAGE_EVENTS_PENDING_KEY = [
	"organization_id",
	"user_id",
	"source",
	"session_id",
	"event_id",
];
export const USAGE_EVENTS_PENDING_VERSION = "observed_at";
export const USAGE_EVENTS_PENDING_TTL =
	"toDateTime(observed_at) + toIntervalDay(3)";
export const USAGE_EVENTS_PENDING_COMMENT =
	"Requests a live session made since its last import, read from the transcript's appended lines by the Mac app between imports. Cost reads add the ones whose event_id is not in the session's stored usage_events yet; the next import stores them and they stop counting. Kept three days.";

export const USAGE_EVENTS_PENDING_COLUMNS: readonly RunIndexColumn[] = [
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
		name: "event_id",
		type: "FixedString(64)",
		comment: "The request's usage_events event_id, from the same extractor.",
	},
	{
		name: "agent_id",
		type: "String",
		comment: "'main' or the subagent ID, as in usage_events.",
	},
	{
		name: "occurred_at",
		type: "DateTime64(3, 'UTC')",
		comment: "When the request happened.",
	},
	{ name: "usage_date", type: "Date", comment: "UTC day of occurred_at." },
	{ name: "raw_model", type: "String", comment: "Model as written." },
	{
		name: "resolved_model",
		type: "LowCardinality(String)",
		comment: "Canonical model, as in usage_events.",
	},
	{
		name: "model_status",
		type: "LowCardinality(String)",
		comment: "As in usage_events.",
	},
	{
		name: "service_tier",
		type: "LowCardinality(String)",
		comment: "As in usage_events.",
	},
	{
		name: "model_provider",
		type: "LowCardinality(String)",
		comment: "As in usage_events.",
	},
	{
		name: "inference_speed",
		type: "LowCardinality(String)",
		comment: "As in usage_events.",
	},
	{
		name: "inference_geo",
		type: "LowCardinality(String)",
		comment: "As in usage_events.",
	},
	{
		name: "context_input_tokens",
		type: "UInt64",
		comment: "Input context size, for the long-context price band.",
	},
	{ name: "uncached_input_tokens", type: "UInt64", comment: "Tokens." },
	{ name: "cache_read_input_tokens", type: "UInt64", comment: "Tokens." },
	{ name: "cache_write_5m_input_tokens", type: "UInt64", comment: "Tokens." },
	{ name: "cache_write_1h_input_tokens", type: "UInt64", comment: "Tokens." },
	{ name: "output_tokens", type: "UInt64", comment: "Tokens." },
	{
		name: "quality_flags",
		type: "Array(String)",
		comment: "As in usage_events.",
	},
	{
		name: "pricing_model",
		type: "LowCardinality(String)",
		comment: "Rate-card model the request was priced as.",
	},
	{
		name: "context_band",
		type: "LowCardinality(String)",
		comment: "'base' or 'long' price band.",
	},
	{
		name: "has_geo_gap",
		type: "UInt8",
		comment: "Priced at the default region because the region was unknown.",
	},
	{
		name: "estimated_cost",
		type: "Nullable(Float64)",
		comment:
			"USD from the rate card when read; NULL when the model has no published price.",
	},
	{
		name: "observed_at",
		type: "DateTime64(3, 'UTC')",
		comment: "When the Mac app read it; the replacing version.",
	},
];
