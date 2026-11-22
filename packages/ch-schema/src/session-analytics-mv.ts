export { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "./mv-sql/claude-session-analytics.js";
export { CODEX_SESSION_ANALYTICS_MV_SQL } from "./mv-sql/codex-session-analytics.js";
export { GEMINI_SESSION_ANALYTICS_MV_SQL } from "./mv-sql/gemini-session-analytics.js";

// ClickHouse matches INSERT ... SELECT columns by position, not by name.
// Keep recovery/backfill writes explicit and in the target table's schema order.
export const SESSION_ANALYTICS_INSERT_COLUMNS = [
	"session_date",
	"last_interaction_date",
	"session_id",
	"organization_id",
	"project_path",
	"git_remote",
	"package_name",
	"package_type",
	"filter_version",
	"revision",
	"ingested_at",
	"user_id",
	"git_branch",
	"git_sha",
	"tag",
	"source",
	"skills",
	"slash_commands",
	"subagent_types",
	"subagent_count",
	"native_subagents",
	"input_tokens",
	"output_tokens",
	"cache_read_input_tokens",
	"cache_creation_input_tokens",
	"total_tokens",
	"total_interactions",
	"actual_duration_min",
	"error_count",
	"model_used",
] as const;

/**
 * Interpretations the views no longer write (docs/l1-literal-schema.md,
 * retirement step 3). A view that names one again is stale, also after the
 * column is dropped.
 */
export const RETIRED_SESSION_ANALYTICS_COLUMNS = [
	"avg_period_sec",
	"median_period_sec",
	"quick_responses",
	"normal_responses",
	"long_pauses",
	"error_pattern",
	"has_commit",
	"session_archetype",
	"success_score",
	"used_plan_mode",
	"inference_duration_sec",
	"human_duration_sec",
] as const;

/** Retired columns that `20261109150000_session_analytics_drop_retired.sql` drops. */
export const DROPPED_SESSION_ANALYTICS_COLUMNS = [
	"error_pattern",
	"session_archetype",
] as const satisfies readonly (typeof RETIRED_SESSION_ANALYTICS_COLUMNS)[number][];
