/**
 * Weekly totals (docs/l1-literal-schema.md, "Weekly totals"): per workspace,
 * member, agent and ISO week (Monday, UTC), the sums of the additive facts of
 * the committed run index builds. Without the schema toolkit, so the API's
 * reader imports it at runtime (`@rudel/ch-schema/weekly-totals`).
 *
 * A refreshable materialized view appends a full snapshot every night
 * (`20261011150000_weekly_totals.sql`); readers read only the newest complete
 * one. Plain sums of literal facts, nothing interpreted: a fact the parser
 * version or agent cannot record is left out of its sum, and its
 * `<fact>_known_runs` column counts the runs that can record it, so a sum is
 * NULL (unknown) when no run of the row can, never zero.
 */

export const WEEKLY_TOTALS_TABLE = "rudel.weekly_totals";
export const WEEKLY_TOTALS_VIEW = "rudel.weekly_totals_mv";
/** Snapshots older than this are dropped by TTL; the newest always covers all history. */
export const WEEKLY_TOTALS_SNAPSHOT_DAYS = 14;

export interface WeeklyTotalsMeasure {
	/** Column of `rudel.weekly_totals`. */
	readonly name: string;
	readonly type:
		| "UInt64"
		| "Float64"
		| "Nullable(UInt64)"
		| "Nullable(Float64)";
	readonly comment: string;
	/**
	 * The `<fact>_known_runs` column counting the runs whose parser version
	 * and agent record this fact; the measure sums only those runs.
	 */
	readonly known?: string;
}

const RUNS_OF_ROW = "the runs of the row";
const knownComment = (fact: string, recorded: string) =>
	`Runs of the row that can record ${fact} (${recorded}); the matching sums cover only these runs.`;
const gatedSum = (what: string) =>
	`${what}, summed over the known runs; NULL when no run of the row can record it.`;

/** Every measure, in column order after the key. */
export const WEEKLY_TOTALS_MEASURES: readonly WeeklyTotalsMeasure[] = [
	{
		name: "runs",
		type: "UInt64",
		comment:
			"Runs (one human prompt and everything until the next) that started in the week, subagent streams included.",
	},
	{
		name: "sessions",
		type: "UInt64",
		comment:
			"Sessions with a run that started in the week. A session that spans weeks counts in each, so it does not add up across weeks.",
	},
	{
		name: "sessions_started",
		type: "UInt64",
		comment:
			"Sessions whose first run started in the week; adds up across weeks.",
	},
	{
		name: "genuine_prompts",
		type: "UInt64",
		comment: `Human prompts of ${RUNS_OF_ROW} (queued prompts included, delegated tasks not).`,
	},
	{
		name: "minutes",
		type: "Float64",
		comment: `Wall-clock minutes of ${RUNS_OF_ROW}, each from its first record to its last non-meta record.`,
	},
	{
		name: "active_minutes",
		type: "Float64",
		comment: `Active minutes of ${RUNS_OF_ROW}: gaps between non-meta records, each capped at five minutes.`,
	},
	{
		name: "tool_calls",
		type: "UInt64",
		comment: `Tool call records of ${RUNS_OF_ROW}.`,
	},
	{
		name: "failed_calls",
		type: "UInt64",
		comment: `Calls of ${RUNS_OF_ROW} whose result is an error or has a non-zero exit code.`,
	},
	{
		name: "edits",
		type: "UInt64",
		comment: `Sum of each run's distinct files written, edited or deleted by calls that did not fail.`,
	},
	{
		name: "reads",
		type: "UInt64",
		comment: `Tool calls in the read group of ${RUNS_OF_ROW}.`,
	},
	{
		name: "searches",
		type: "UInt64",
		comment: `Tool calls in the search group of ${RUNS_OF_ROW}.`,
	},
	{
		name: "not_found",
		type: "UInt64",
		comment: `Failed reads and searches of ${RUNS_OF_ROW} whose text says not found, no such file, ENOENT or No files found.`,
	},
	{
		name: "compactions",
		type: "UInt64",
		comment: `Compaction records of ${RUNS_OF_ROW}.`,
	},
	{
		name: "interrupt_markers",
		type: "UInt64",
		comment: `Interrupt marker records of ${RUNS_OF_ROW} (Claude [Request interrupted by user], Codex turn_aborted wrappers).`,
	},
	{
		name: "edit_outcomes_known_runs",
		type: "UInt64",
		comment: knownComment("failed and refused edits", "parser 9 or newer"),
	},
	{
		name: "failed_edits",
		type: "Nullable(UInt64)",
		comment: gatedSum("Failed edit requests, excluding refusals"),
		known: "edit_outcomes_known_runs",
	},
	{
		name: "refused_edits",
		type: "Nullable(UInt64)",
		comment: gatedSum(
			"Refused native edit requests, including user declines but excluding interruptions",
		),
		known: "edit_outcomes_known_runs",
	},
	{
		name: "denied_calls_known_runs",
		type: "UInt64",
		comment: knownComment("denials", "parser 9 or newer"),
	},
	{
		name: "denied_calls",
		type: "Nullable(UInt64)",
		comment: gatedSum("Calls whose result records a denial_kind"),
		known: "denied_calls_known_runs",
	},
	{
		name: "interrupted_calls_known_runs",
		type: "UInt64",
		comment: knownComment(
			"interrupted calls",
			"Claude Code parser 6, Codex parser 8 or newer",
		),
	},
	{
		name: "interrupted_calls",
		type: "Nullable(UInt64)",
		comment: gatedSum("Calls whose result records interrupted = true"),
		known: "interrupted_calls_known_runs",
	},
	{
		name: "timed_out_calls_known_runs",
		type: "UInt64",
		comment: knownComment("timed-out calls", "Claude Code parser 6 or newer"),
	},
	{
		name: "timed_out_calls",
		type: "Nullable(UInt64)",
		comment: gatedSum("Calls whose result records timedOutAfterMs"),
		known: "timed_out_calls_known_runs",
	},
	{
		name: "mcp_calls_known_runs",
		type: "UInt64",
		comment: knownComment(
			"MCP calls",
			"Claude Code parser 9, Codex parser 6 or newer",
		),
	},
	{
		name: "mcp_calls",
		type: "Nullable(UInt64)",
		comment: gatedSum("Calls with a recorded MCP server"),
		known: "mcp_calls_known_runs",
	},
	{
		name: "api_errors_known_runs",
		type: "UInt64",
		comment: knownComment(
			"API errors",
			"Claude Code parser 7, Codex parser 9 or newer",
		),
	},
	{
		name: "api_errors",
		type: "Nullable(UInt64)",
		comment: gatedSum(
			"API error records (Claude API errors, Codex terminal provider or transport errors)",
		),
		known: "api_errors_known_runs",
	},
	{
		name: "retry_attempts_known_runs",
		type: "UInt64",
		comment: knownComment("API retries", "Claude Code parser 7 or newer"),
	},
	{
		name: "retry_attempts",
		type: "Nullable(UInt64)",
		comment: gatedSum("Claude API retry records"),
		known: "retry_attempts_known_runs",
	},
	{
		name: "refusals_known_runs",
		type: "UInt64",
		comment: knownComment("model refusals", "Claude Code parser 7 or newer"),
	},
	{
		name: "refusals",
		type: "Nullable(UInt64)",
		comment: gatedSum("Claude model refusal records"),
		known: "refusals_known_runs",
	},
	{
		name: "aborted_known_runs",
		type: "UInt64",
		comment: knownComment("an abort", "parser 7 or newer"),
	},
	{
		name: "aborted_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum(
			"Runs a record says aborted (Codex turn_aborted, Claude interruptedByShutdown)",
		),
		known: "aborted_known_runs",
	},
	{
		name: "turn_error_known_runs",
		type: "UInt64",
		comment: knownComment("a turn error", "Codex parser 7 or newer"),
	},
	{
		name: "turn_error_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs whose Codex task_complete records an error"),
		known: "turn_error_known_runs",
	},
	{
		name: "git_operations_known_runs",
		type: "UInt64",
		comment: knownComment(
			"Claude gitOperation",
			"Claude Code parser 6 or newer; Codex git activity is in find source=git",
		),
	},
	{
		name: "push_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs with a Claude gitOperation push"),
		known: "git_operations_known_runs",
	},
	{
		name: "commit_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs with a Claude gitOperation commit"),
		known: "git_operations_known_runs",
	},
	{
		name: "pr_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs with a Claude gitOperation pr"),
		known: "git_operations_known_runs",
	},
	{
		name: "commit_shas",
		type: "Nullable(UInt64)",
		comment: gatedSum(
			"Distinct Claude gitOperation commit SHAs of each run, added up",
		),
		known: "git_operations_known_runs",
	},
	{
		name: "pr_urls_known_runs",
		type: "UInt64",
		comment: knownComment(
			"pull request URLs",
			"Claude Code parser 6 or newer, every Codex parser",
		),
	},
	{
		name: "pr_urls",
		type: "Nullable(UInt64)",
		comment: gatedSum(
			"Distinct pull request URLs of each run (named, not necessarily created), added up",
		),
		known: "pr_urls_known_runs",
	},
	{
		name: "skills_known_runs",
		type: "UInt64",
		comment: knownComment(
			"skills",
			"Claude Code parser 6, Codex parser 9 or newer",
		),
	},
	{
		name: "skill_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs that used at least one skill"),
		known: "skills_known_runs",
	},
	{
		name: "skills",
		type: "Nullable(UInt64)",
		comment: gatedSum("Distinct skills of each run, added up"),
		known: "skills_known_runs",
	},
	{
		name: "slash_commands_known_runs",
		type: "UInt64",
		comment: knownComment("slash commands", "Claude Code"),
	},
	{
		name: "slash_commands",
		type: "Nullable(UInt64)",
		comment: gatedSum("Distinct slash commands of each run, added up"),
		known: "slash_commands_known_runs",
	},
	{
		name: "subagent_types_known_runs",
		type: "UInt64",
		comment: knownComment(
			"subagent types",
			"Claude Code, Codex parser 9 or newer",
		),
	},
	{
		name: "subagent_type_runs",
		type: "Nullable(UInt64)",
		comment: gatedSum("Runs that started a subagent with a recorded type"),
		known: "subagent_types_known_runs",
	},
	{
		name: "usage_known_runs",
		type: "UInt64",
		comment:
			"Runs whose session's usage extraction was complete, so their usage and cost are known; the others count no usage.",
	},
	{
		name: "usage_observations",
		type: "UInt64",
		comment:
			"Usage events of the runs, plus the usage no run claims, which counts in the week of its session date.",
	},
	{
		name: "usage_unpriced",
		type: "UInt64",
		comment: "Of usage_observations, events without a price.",
	},
	{
		name: "cost_usd",
		type: "Nullable(Float64)",
		comment:
			"Priced cost in USD of usage_observations (the runs' and the usage no run claims), at the pricing of each build; NULL when nothing is priced.",
	},
	{
		name: "unattributed_cost_usd",
		type: "Nullable(Float64)",
		comment:
			"Of cost_usd, the priced usage no run claims, counted in the week of its session date; NULL when none.",
	},
	{
		name: "uncached_input_tokens",
		type: "Nullable(UInt64)",
		comment: "Uncached input tokens of usage_observations; NULL without usage.",
	},
	{
		name: "cache_read_input_tokens",
		type: "Nullable(UInt64)",
		comment:
			"Cache read input tokens of usage_observations; NULL without usage.",
	},
	{
		name: "cache_write_5m_input_tokens",
		type: "Nullable(UInt64)",
		comment:
			"Five-minute cache write input tokens of usage_observations; NULL without usage.",
	},
	{
		name: "cache_write_1h_input_tokens",
		type: "Nullable(UInt64)",
		comment:
			"One-hour cache write input tokens of usage_observations; NULL without usage.",
	},
	{
		name: "output_tokens",
		type: "Nullable(UInt64)",
		comment: "Output tokens of usage_observations; NULL without usage.",
	},
	{
		name: "reasoning_output_tokens",
		type: "Nullable(UInt64)",
		comment:
			"Reasoning output tokens of usage_observations; NULL without usage.",
	},
];

/** Snapshot and key columns, before the measures. */
export const WEEKLY_TOTALS_KEY_COLUMNS = [
	{
		name: "refreshed_at",
		type: "DateTime64(6, 'UTC')",
		comment:
			"UTC time the refresh that wrote the snapshot started; snapshots expire after 14 days.",
	},
	{
		name: "refresh_id",
		type: "String",
		comment:
			"Snapshot id (replica host and refreshed_at). Each refresh appends a full snapshot, and readers read only the newest complete one.",
	},
	{
		name: "snapshot_rows",
		type: "UInt64",
		comment:
			"Rows of the snapshot; a snapshot with fewer rows stored is incomplete and never read.",
	},
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{ name: "user_id", type: "String", comment: "Member: the sessions' owner." },
	{
		name: "agent",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "week",
		type: "Date",
		comment:
			"Monday (UTC) of the ISO week the runs started in; the usage no run claims counts in the week of its session date.",
	},
] as const;

/**
 * The snapshot readers read: the newest whose stored rows number the
 * `snapshot_rows` its refresh wrote, so a refresh still appending (or one
 * that failed part way) is never read. With `pinned`, only the snapshot
 * `{refreshId:String}` names, if it is still complete and kept. Returns
 * `refresh_id` and `refreshed_text` (its `refreshed_at` as UTC text; an alias named `refreshed_at` would shadow the column in ORDER BY), or no row.
 */
export function weeklyTotalsSnapshotSql(table: string, pinned = false): string {
	return `SELECT refresh_id, toString(max(refreshed_at)) AS refreshed_text
		FROM ${table}${pinned ? "\n\t\tWHERE refresh_id = {refreshId:String}" : ""}
		GROUP BY refresh_id
		HAVING count() = any(snapshot_rows)
		ORDER BY max(refreshed_at) DESC, refresh_id DESC
		LIMIT 1`;
}

export const WEEKLY_TOTALS_ORDER_BY = [
	"organization_id",
	"refresh_id",
	"user_id",
	"agent",
	"week",
] as const;
