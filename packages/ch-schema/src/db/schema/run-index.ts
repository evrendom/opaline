import { schema, table } from "@chkit/core";
import { RUN_INDEX_TTL } from "../../run-index.js";

/**
 * `run_index` (docs/l1-literal-schema.md, "Scale"): the `runs` view
 * materialized per committed transcript-records generation, one row per run
 * (one human prompt and everything until the next) and one `receipt` row per
 * session generation, written last by the L1 reconciliation worker. Facts are
 * copied from the generation's records, never inferred, and a fact the
 * generation's parser version or agent cannot record is NULL (arrays name it
 * in `unrecorded_facts`), so unknown never reads as false or zero.
 *
 * Every build is an immutable snapshot: the generation `(revision,
 * parser_version, index_version)` and the build (`build_revision`, the
 * worker's claimed revision) are both in the key, so a build never replaces
 * or merges away the rows of another. A build writes its runs, then its
 * receipt; the receipt with the newest (generation, build) commits the
 * session's runs, and readers read only that build's rows. Superseded and
 * uncommitted snapshots are retired after a grace, as in
 * `transcript_records`.
 */
export const RUN_INDEX_KEY = [
	"organization_id",
	"user_id",
	"session_id",
	"revision",
	"parser_version",
	"index_version",
	"build_revision",
	"agent_id",
	"start_record",
];

export {
	RUN_INDEX_RETENTION_DAYS,
	RUN_INDEX_TEXT_COLUMNS,
	RUN_INDEX_TEXT_RETENTION_DAYS,
	RUN_INDEX_TEXT_TTL,
	RUN_INDEX_TTL,
} from "../../run-index.js";

/** A literal string fact: NULL when it cannot be recorded, '' when none was. */
const FACT = "LowCardinality(Nullable(String))";
const NOT_RECORDABLE =
	"NULL when the parser version or agent does not record it";

const RUN_INDEX_COLUMNS = [
	// Identity and generation.
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
		comment: "Raw transcript revision of the transcript records generation.",
	},
	{
		name: "parser_version",
		type: "UInt16",
		comment: "Transcript records parser version of the generation.",
	},
	{
		name: "index_version",
		type: "UInt16",
		comment:
			"Version of the run index rules; a new version is a new generation.",
	},
	{
		name: "agent_id",
		type: "String",
		comment: "Transcript stream; empty for the main stream and the receipt.",
	},
	{
		name: "start_record",
		type: "UInt32",
		comment:
			"Raw record index of the record that starts the run (its prompt), as in the L1 edge run ids; 4294967295 for the receipt.",
	},
	{
		name: "row_kind",
		type: "LowCardinality(String)",
		comment:
			"run, or receipt: one per build, written after its runs, holding session facts and committing the build.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream; zero for the receipt.",
	},
	{
		name: "run_id",
		type: "String",
		comment:
			"L1 run node id (user/source/session/agent/start record, percent-encoded), equal to l1_edges.from_id of the run.",
	},
	{
		name: "build_revision",
		type: "UInt64",
		comment:
			"Worker build revision that wrote the snapshot. In the key: each build is an immutable snapshot, and the newest receipt names the build readers read.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker wrote the row.",
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		comment: "Session date of the generation; retention is measured from it.",
	},
	{
		name: "unrecorded_facts",
		type: "Array(LowCardinality(String))",
		comment:
			"Fact columns of this row whose values are unknown, not none: the parser version or agent cannot record them, or the usage extraction was incomplete.",
	},
	// Agent.
	{
		name: "agent_version",
		type: FACT,
		comment: `First agent version recorded in the run (Claude Code version, Codex cli_version); ${NOT_RECORDABLE}.`,
	},
	{
		name: "entrypoint",
		type: FACT,
		comment: `First entrypoint recorded in the run (Claude Code entrypoint, Codex originator); ${NOT_RECORDABLE}.`,
	},
	// Time.
	{
		name: "started_at",
		type: "DateTime64(3, 'UTC')",
		comment: "Timestamp of the run's first record.",
	},
	{
		name: "ended_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"Timestamp of the run's last non-meta record; started_at when it has none.",
	},
	{
		name: "end_record",
		type: "UInt32",
		comment:
			"Start record of the next run in the stream, or one past the run's last record: usage on lines in [start_record, end_record) belongs to the run.",
	},
	{
		name: "minutes",
		type: "Float64",
		comment:
			"Wall-clock minutes from the first record to the last non-meta record.",
	},
	{
		name: "active_minutes",
		type: "Float64",
		comment:
			"Sum of the gaps between non-meta records, each capped at five minutes.",
	},
	{
		name: "record_count",
		type: "UInt32",
		comment: "Transcript lines of the run.",
	},
	{
		name: "raw_chars",
		type: "UInt64",
		comment: "Characters of the run's records before any cap.",
	},
	// Codex task timing.
	{
		name: "duration_ms",
		type: "Nullable(UInt32)",
		comment: `Sum of the duration_ms of the run's Codex task_complete and turn_aborted events; ${NOT_RECORDABLE} or no event records it.`,
	},
	{
		name: "time_to_first_token_ms",
		type: "Nullable(UInt32)",
		comment: `time_to_first_token_ms of the run's first Codex task_complete; ${NOT_RECORDABLE} or no event records it.`,
	},
	// Prompt.
	{
		name: "prompt_head",
		type: "Nullable(String)",
		comment:
			"First 160 characters of the run's first genuine prompt; NULL once the text retention passed.",
	},
	{
		name: "genuine_prompts",
		type: "UInt32",
		comment:
			"Human prompts in the run (queued prompts included, delegated tasks not).",
	},
	{
		name: "turn_origin",
		type: FACT,
		comment: `Claude turnOrigin of the run's starting prompt; ${NOT_RECORDABLE}.`,
	},
	{
		name: "prompt_source",
		type: FACT,
		comment: `Claude promptSource of the run's starting prompt; ${NOT_RECORDABLE}.`,
	},
	{
		name: "origin_kind",
		type: FACT,
		comment: `Claude origin.kind of the run's starting prompt; ${NOT_RECORDABLE}.`,
	},
	{
		name: "trigger_turn",
		type: FACT,
		comment: `First Codex inter-agent trigger_turn recorded in the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "thread_source",
		type: FACT,
		comment: `Codex session_meta thread_source of the run's stream (user, subagent, guardian_review); ${NOT_RECORDABLE}.`,
	},
	{
		name: "prompt_origin_basis",
		type: "LowCardinality(String)",
		comment:
			"native when the starting prompt or its stream records a native origin field, else wrapper: the prompt kind comes only from the parser's wrapper rules.",
	},
	// Permissions.
	{
		name: "permission_mode",
		type: FACT,
		comment: `First Claude permissionMode recorded in the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "permission_modes",
		type: "Array(LowCardinality(String))",
		comment: "Every Claude permissionMode recorded in the run, sorted.",
	},
	{
		name: "auto_mode_bash_first",
		type: FACT,
		comment: `First Claude auto_mode bashFirst in the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "auto_mode_bash_first_steer",
		type: FACT,
		comment: `First Claude auto_mode bashFirstSteer in the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "auto_mode_bypass",
		type: FACT,
		comment: `First Claude auto_mode bypass in the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "auto_mode_steer_only",
		type: FACT,
		comment: `First Claude auto_mode steerOnly in the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "auto_mode_consent_flow",
		type: FACT,
		comment: `First Claude auto_mode autoModeConsentFlow in the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "approval_policy",
		type: FACT,
		comment: `First Codex turn_context approval_policy of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "approvals_reviewer",
		type: FACT,
		comment: `First Codex turn_context approvals_reviewer of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "sandbox_policy",
		type: FACT,
		comment: `First Codex turn_context sandbox_policy type of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "sandbox_network_access",
		type: FACT,
		comment: `First Codex turn_context sandbox network_access of the run (true or false); ${NOT_RECORDABLE}.`,
	},
	{
		name: "permission_profile",
		type: FACT,
		comment: `First Codex turn_context permission_profile type of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "collaboration_mode",
		type: FACT,
		comment: `First Codex collaboration mode of the run (turn_context or task_started); ${NOT_RECORDABLE}.`,
	},
	// Model.
	{
		name: "model",
		type: FACT,
		comment: `First model recorded in the run (Claude assistant message.model, Codex turn_context model); ${NOT_RECORDABLE}.`,
	},
	{
		name: "models",
		type: "Array(LowCardinality(String))",
		comment: "Every model recorded in the run's records, sorted.",
	},
	{
		name: "effort",
		type: FACT,
		comment: `First effort recorded in the run (Claude assistant effort, Codex turn_context effort); ${NOT_RECORDABLE}.`,
	},
	{
		name: "per_turn_effort",
		type: FACT,
		comment: `First Claude perTurnEffort recorded in the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "context_window",
		type: "Nullable(UInt32)",
		comment: `First Codex task_started model_context_window of the run; ${NOT_RECORDABLE} or none was.`,
	},
	{
		name: "context_input_tokens_at_start",
		type: "Nullable(UInt64)",
		comment:
			"Context input tokens of the run's first verified usage event; NULL without one.",
	},
	// Calls.
	{
		name: "tool_calls",
		type: "UInt32",
		comment: "Tool call records of the run.",
	},
	{
		name: "failed_calls",
		type: "UInt32",
		comment:
			"Calls whose result is an error or has a non-zero exit code, counted once per call.",
	},
	{
		name: "edits",
		type: "UInt32",
		comment:
			"Distinct files written, edited or deleted by native edits, patches or unconditional shell commands whose call did not fail.",
	},
	{
		name: "reads",
		type: "UInt32",
		comment: "Tool calls in the read group.",
	},
	{
		name: "searches",
		type: "UInt32",
		comment: "Tool calls in the search group.",
	},
	{
		name: "not_found",
		type: "UInt32",
		comment:
			"Failed read or search results whose text says not found, no such file, ENOENT or No files found.",
	},
	{
		name: "denied_calls",
		type: "Nullable(UInt32)",
		comment: `Calls whose result records a denial_kind; ${NOT_RECORDABLE}.`,
	},
	{
		name: "interrupted_calls",
		type: "Nullable(UInt32)",
		comment: `Calls whose result records interrupted = true; ${NOT_RECORDABLE}.`,
	},
	{
		name: "timed_out_calls",
		type: "Nullable(UInt32)",
		comment: `Calls whose result records timedOutAfterMs; ${NOT_RECORDABLE}.`,
	},
	{
		name: "mcp_calls",
		type: "Nullable(UInt32)",
		comment: `Calls with a recorded MCP server; ${NOT_RECORDABLE}.`,
	},
	{
		name: "mcp_servers",
		type: "Array(LowCardinality(String))",
		comment: "MCP servers recorded on the run's calls, sorted.",
	},
	// Inputs of the retirement of regex session columns.
	{
		name: "skills",
		type: "Array(String)",
		comment:
			"Skills of the run: Claude attributionSkill values and the skill input of Skill tool calls, sorted.",
	},
	{
		name: "slash_commands",
		type: "Array(String)",
		comment:
			"Command names of the run's Claude slash-command records, without the leading slash, sorted.",
	},
	{
		name: "subagent_types",
		type: "Array(LowCardinality(String))",
		comment:
			"subagent_type inputs of the run's Claude Task and Agent tool calls, sorted.",
	},
	// Compaction.
	{
		name: "compactions",
		type: "UInt32",
		comment: "Compaction records of the run.",
	},
	{
		name: "compact_trigger",
		type: FACT,
		comment: `First Claude compactMetadata trigger of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "compact_pre_tokens",
		type: "Nullable(UInt64)",
		comment: `First Claude compactMetadata preTokens of the run; ${NOT_RECORDABLE} or none was.`,
	},
	// Ending.
	{
		name: "aborted",
		type: FACT,
		comment: `true when a record of the run says aborted (Codex turn_aborted, Claude interruptedByShutdown), false when records say only false, empty when none says; ${NOT_RECORDABLE}.`,
	},
	{
		name: "abort_reason",
		type: FACT,
		comment: `First Codex turn_aborted reason of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "turn_error",
		type: "Nullable(String)",
		comment: `First Codex task_complete error message of the run; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	{
		name: "turn_error_kind",
		type: FACT,
		comment: `First Codex task_complete codex_error_info of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "interrupt_markers",
		type: "UInt32",
		comment:
			"Interrupt marker records of the run (Claude [Request interrupted by user], Codex turn_aborted wrappers).",
	},
	// Stop and hooks.
	{
		name: "stop_reason",
		type: FACT,
		comment: `Last Claude assistant stop_reason recorded in the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "hook_stop_reason",
		type: "Nullable(String)",
		comment: `First Claude stop hook stopReason of the run; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	{
		name: "prevented_continuation",
		type: FACT,
		comment: `true when a stop hook summary of the run records preventedContinuation, false when they record only false; ${NOT_RECORDABLE}.`,
	},
	{
		name: "hook_count",
		type: "Nullable(UInt32)",
		comment: `Sum of the hookCount of the run's stop hook summaries; ${NOT_RECORDABLE} or none was.`,
	},
	{
		name: "hook_errors",
		type: "Nullable(String)",
		comment: `JSON array of the run's stop hook hookErrors in record order; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	{
		name: "hook_runs",
		type: "Nullable(String)",
		comment: `JSON array of the run's stop hook hookInfos (command, durationMs) in record order; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	// API.
	{
		name: "api_errors",
		type: "Nullable(UInt32)",
		comment: `Claude API error records of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "api_error",
		type: "Nullable(String)",
		comment: `First Claude API error of the run; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	{
		name: "api_error_statuses",
		type: "Array(LowCardinality(String))",
		comment: "Claude apiErrorStatus values of the run, sorted.",
	},
	{
		name: "retry_attempts",
		type: "Nullable(UInt32)",
		comment: `Claude API retry records of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "refusals",
		type: "Nullable(UInt32)",
		comment: `Claude model refusal records of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "fallback_model",
		type: FACT,
		comment: `First Claude fallbackModel of the run; ${NOT_RECORDABLE}.`,
	},
	{
		name: "goal",
		type: "Nullable(String)",
		comment: `Last Codex thread goal objective set in the run; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	// Git, as the transcript records it; PR and CI links are followed through l1_edges by run_id.
	{
		name: "git_operations",
		type: "Array(LowCardinality(String))",
		comment:
			"Claude gitOperation keys of the run (push, pr, branch, commit), sorted.",
	},
	{
		name: "pushed_branches",
		type: "Array(String)",
		comment: "Claude gitOperation push branches of the run, sorted.",
	},
	{
		name: "commit_shas",
		type: "Array(String)",
		comment: "Claude gitOperation commit SHAs of the run as recorded, sorted.",
	},
	{
		name: "pr_urls",
		type: "Array(String)",
		comment:
			"Pull request URLs of the run from Claude gitOperation and pr-link records, sorted.",
	},
	// Usage, priced at build time.
	{
		name: "usage_observations",
		type: "UInt32",
		comment:
			"Usage events of the session's usage extraction verified on the run's lines; on the receipt, its events assigned to no run.",
	},
	{
		name: "usage_unpriced",
		type: "UInt32",
		comment: "Of usage_observations, events without a price.",
	},
	{
		name: "usage_model",
		type: "LowCardinality(String)",
		comment: "Model of the run's latest usage event; empty without usage.",
	},
	{
		name: "cost_usd",
		type: "Nullable(Float64)",
		comment:
			"Priced cost of usage_observations at pricing_version; NULL when none is priced.",
	},
	{
		name: "model_costs",
		type: "Array(Tuple(String, Nullable(Float64), UInt32))",
		comment:
			"Per model: priced cost (NULL when unpriced) and unpriced events, most expensive first.",
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
	{
		name: "pricing_version",
		type: "LowCardinality(String)",
		comment:
			"Rate card version and pricing rules hash the costs were computed with.",
	},
	{
		name: "facts_truncated",
		type: "Nullable(Bool)",
		comment: `Whether a record of the run dropped long fact values to the session fact budget; ${NOT_RECORDABLE}.`,
	},
	// Session facts, on the receipt only.
	{
		name: "run_count",
		type: "UInt32",
		comment:
			"Receipt: runs of the generation. Its call, error, skill and model columns total or merge those of the runs.",
	},
	{
		name: "usage_receipt",
		type: "String",
		comment:
			"Receipt: the usage extraction the costs were built from (generation:checksum, with :incomplete when it was not complete and usage is unknown); empty without usage.",
	},
	{
		name: "cost_state",
		type: "Map(LowCardinality(String), String)",
		comment:
			"Receipt: the main stream's last Claude cost-state record (cost_usd, lines, durations), keyed by fact name; empty when none.",
	},
	{
		name: "title",
		type: "Nullable(String)",
		comment: `Receipt: last Claude ai-title of the main stream; ${NOT_RECORDABLE} or once the text retention passed.`,
	},
	{
		name: "repository",
		type: "String",
		comment:
			"Receipt: the session repository key as recorded (git remote, else package name, else project path).",
	},
	{
		name: "session_model",
		type: "LowCardinality(String)",
		comment: "Receipt: the session model recorded at upload.",
	},
];

export const runIndexTable = table({
	database: "rudel",
	name: "run_index",
	engine: "SharedReplacingMergeTree(build_revision)",
	columns: RUN_INDEX_COLUMNS,
	primaryKey: RUN_INDEX_KEY,
	orderBy: RUN_INDEX_KEY,
	ttl: RUN_INDEX_TTL,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"L1 runs per committed transcript generation, with a receipt per session generation written last; written only by the reconciliation worker.",
});

export default schema(runIndexTable);
