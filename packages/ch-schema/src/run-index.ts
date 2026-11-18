/**
 * The columns of `rudel.run_index` and its free-text columns, without the
 * schema toolkit, so the API's builder, readers and SQL views import them at
 * runtime (`@rudel/ch-schema/run-index`).
 *
 * Nothing in the run index expires: like the raw transcripts and
 * `transcript_records` it is kept until a deletion request (docs/l1-retention.md).
 * These columns once had a 365-day column TTL; the retention migration
 * `20261011120000_l1_retention_removed.sql` removes it, and its runner checks
 * these columns by name.
 */
export const RUN_INDEX_TEXT_COLUMNS = [
	"prompt_head",
	"turn_error",
	"hook_stop_reason",
	"hook_errors",
	"hook_runs",
	"api_error",
	"goal",
	"title",
] as const;

/** A literal string fact: NULL when it cannot be recorded, '' when none was. */
const FACT = "LowCardinality(Nullable(String))";
const NOT_RECORDABLE =
	"NULL when the parser version or agent does not record it";

/** One column of `rudel.run_index`: its name, ClickHouse type and comment (meaning and traps). */
export interface RunIndexColumn {
	readonly name: string;
	readonly type: string;
	readonly comment: string;
}

/**
 * Every column of `rudel.run_index`, in table order. The table definition
 * (`db/schema/run-index.ts`) and the API's SQL views read the same list, so a
 * column's comment is written once.
 */
export const RUN_INDEX_COLUMNS: readonly RunIndexColumn[] = [
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
		comment: "Session date of the generation.",
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
			"Timestamp of the run's last activity record (not metadata, a compaction or injected context); started_at when it has none.",
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
			"Wall-clock minutes from the first record to the last activity record (not metadata, a compaction or injected context).",
	},
	{
		name: "active_minutes",
		type: "Float64",
		comment:
			"Sum of the gaps between activity records, each capped at five minutes.",
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
			"First 160 characters of the run's first genuine prompt; NULL when the run has none.",
	},
	{
		name: "genuine_prompts",
		type: "UInt32",
		comment:
			"Human prompts in the run (queued prompts included, delegated tasks not).",
	},
	{
		name: "prompt_subtype",
		type: FACT,
		comment:
			"The subtype of the prompt the run starts with, as the parser recorded it: '' for a prompt sent while the agent was waiting, queued (sent while it worked: the agent reads it at its next request, so the run before ends mid-work), delegation (a parent agent's task to a subagent); '' also when the run starts with no prompt. NULL when the parser version cannot tell them apart (Claude Code subagent streams before parser 11 read a coordinator's message as queued), and on runs built before the column existed.",
	},
	{
		name: "prompt_reactions",
		type: "Array(LowCardinality(String))",
		comment:
			"Word-list categories (negative, swear, apology, positive) the language-signals scanner finds in the run's first genuine prompt (its first 16,384 characters, as find scans it), sorted; empty when it finds none or the run has none. From run index 4; empty before.",
	},
	{
		name: "final_message",
		type: "Nullable(String)",
		comment:
			"First 2,000 characters of the run's last assistant text when no tool call follows it in the run: what the agent said when it stopped. NULL when the run ended on a tool call, has no assistant text, or was built before run index 4.",
	},
	{
		name: "final_message_cut",
		type: "Bool",
		comment:
			"Whether final_message holds only part of the message: it was longer than 2,000 characters, or the transcript stored it cut. From run index 4; false before.",
	},
	{
		name: "system_prompt_recorded",
		type: "Bool",
		comment:
			"Whether the run's stream recorded the system prompt it received (a Claude Code prompt_snapshot attachment or Codex base instructions) at or before the run. From run index 4; false before.",
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
		name: "efforts",
		type: "Array(LowCardinality(String))",
		comment:
			"Every effort recorded in the run (Claude assistant effort, Codex turn_context effort), sorted: more than one when the effort changed within the run, whose effort column holds only the first. Empty when none was recorded, and on runs built before the column existed.",
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
		name: "failed_edits",
		type: "Nullable(UInt32)",
		comment: "Failed edit requests, excluding refusals; parser 9 or newer.",
	},
	{
		name: "refused_edits",
		type: "Nullable(UInt32)",
		comment:
			"Refused native edit requests, including user declines but excluding interruptions; parser 9 or newer.",
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
		type: "Nullable(UInt32)",
		comment:
			"Read and search calls whose result records that they found nothing: Claude Code's zero-result text, zero match or file counts or returnCodeInterpretation 'No matches found', the shell's no matches found for a file pattern, a search that printed nothing (unless its command silences or redirects its output), or a failure whose text says not found, no such file, ENOENT or does not exist; NULL when the parser version or agent does not record it (Claude Code before parser 6, and its subagent streams, which keep no tool result details).",
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
		name: "approvals_by_user",
		type: "Nullable(UInt32)",
		comment:
			"Calls whose result records a permission decision the user accepted (Claude Code permissionDecision accept with source user_temporary, allowed once at a prompt, or user_permanent, allowed at a prompt from then on, which also marks the later calls the rule it saved allows, with reasonType rule; permission_prompts counts only the prompts). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.",
	},
	{
		name: "approvals_by_hook",
		type: "Nullable(UInt32)",
		comment:
			"Calls whose result records a permission decision a hook accepted (permissionDecision accept with source hook). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.",
	},
	{
		name: "approvals_by_config",
		type: "Nullable(UInt32)",
		comment:
			"Calls whose result records a permission decision configuration accepted without asking (permissionDecision accept with source config: the permission mode, reasonType mode; the auto mode classifier, classifier; an allow rule, rule). NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.",
	},
	{
		name: "permission_prompts",
		type: "Nullable(UInt32)",
		comment:
			"Calls a person decided at a permission prompt while the agent waited: accepted (permissionDecision source user_temporary or user_permanent without a reasonType; with reasonType rule a saved rule decided and nobody was asked) or rejected (denial_kind user-rejected). The wait is in the call's own time. NULL when the agent records no permission decisions: Codex, Claude Code before 2.1.293, a run none of whose results records one (some subagent streams write none), and runs built before the column existed.",
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
	{
		name: "mcp_unavailable",
		type: "Array(LowCardinality(String))",
		comment:
			"MCP servers the stream's latest server-state record at or before the run's end lists as needing authentication or failed to connect (Claude Code deferred_tools_delta needsAuthMcpServers and failedMcpServers names), sorted; the stream's own records, carried from run to run until the next such record. Empty when that record lists none, or the stream recorded no server state; still connecting (pendingMcpServers) is not unavailable.",
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
		comment: `First Codex task_complete error message of the run; ${NOT_RECORDABLE}.`,
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
		comment: `First Claude stop hook stopReason of the run; ${NOT_RECORDABLE}.`,
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
		comment: `JSON array of the run's stop hook hookErrors in record order; ${NOT_RECORDABLE}.`,
	},
	{
		name: "hook_runs",
		type: "Nullable(String)",
		comment: `JSON array of the run's stop hook hookInfos (command, durationMs) in record order; ${NOT_RECORDABLE}.`,
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
		comment: `First Claude API error of the run; ${NOT_RECORDABLE}.`,
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
		name: "rate_limit_max_used_percent",
		type: "Nullable(Float64)",
		comment:
			"The highest used_percent of a provider rate-limit window that the run's records report (Codex token_count rate_limits, primary and secondary windows). The windows are the account's (5 hours, 7 days), so other sessions' use counts too, and 100 is a full window, not a refused request (rate_limited says that). NULL when no record of the run reports one (Codex versions or plans that write none; Claude Code reports quota only with a refused request), and on runs built before the column existed.",
	},
	{
		name: "rate_limited",
		type: "Nullable(Bool)",
		comment:
			"true when a record of the run says a request was refused for a rate or usage limit: a Claude Code API error rate_limit (HTTP 429) or quotaLimits status rejected, a Codex turn error usage_limit_exceeded; false when none says so. A limit the agent waited out without such a record is not seen. NULL when the parser version cannot record it, and on runs built before the column existed.",
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
		comment: `Last Codex thread goal objective set in the run; ${NOT_RECORDABLE}.`,
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
		comment: `Receipt: last Claude ai-title of the main stream; ${NOT_RECORDABLE}.`,
	},
	{
		name: "repository",
		type: "String",
		comment:
			"The session repository key as recorded (git remote, else package name, else project path), on every run and on the receipt; empty when none was recorded.",
	},
	{
		name: "cwd",
		type: "Nullable(String)",
		comment:
			"The directory the run's shell commands ran in: per call, the literal directory its command starts by moving to (a leading cd, pushd or git -C; a leading ~ is the home directory of the recorded cwd, a relative one is joined to it), else the directory recorded for it (Claude Code record cwd, Codex CommandExecution cwd); the one most of the run's shell calls ran in, the earliest on a tie. A run without shell calls takes its first recorded cwd. NULL when none is recorded, and on runs built before the column existed.",
	},
	{
		name: "cwd_repository",
		type: "Nullable(String)",
		comment:
			"The repository (host/owner/name of its git remote) the session's own records tie to cwd or the deepest directory above it, as cwd_repository_basis says; NULL when nothing ties it to one, or that directory's records name several: unknown, not the session's repository.",
	},
	{
		name: "cwd_repository_basis",
		type: "LowCardinality(String)",
		comment:
			"What ties cwd to cwd_repository, strongest first: codex_session_meta (the git remote a Codex session_meta records for its directory), session_branch (the upload's remote, for the session's own directory, where a record shows the upload's branch), remote_output (origin URL a call there printed), transfer_remote (the remote a git push, fetch or pull there printed), gh_output (the one repository whose pull request or Actions URLs a gh pr or gh run there printed); conflicting when the records name more than one repository; empty when none.",
	},
	{
		name: "session_model",
		type: "LowCardinality(String)",
		comment: "Receipt: the session model recorded at upload.",
	},
];

/** A usage column of a request: the same meaning as on a run, over the request's lines. */
const requestUsage = (name: string, comment: string): RunIndexColumn => ({
	name,
	type: "Nullable(UInt64)",
	comment: `${comment} of the request's usage events; NULL without usage or when the session's usage is unknown.`,
});

/**
 * Every column of `rudel.run_requests`, in table order: the requests of each
 * run index build (one model response and the calls it made), written with
 * the build's runs and committed by the same receipt.
 */
export const RUN_REQUEST_COLUMNS: readonly RunIndexColumn[] = [
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
		comment: "Raw transcript revision of the run index build's generation.",
	},
	{
		name: "parser_version",
		type: "UInt16",
		comment: "Transcript records parser version of the generation.",
	},
	{
		name: "index_version",
		type: "UInt16",
		comment: "Run index rules version of the build.",
	},
	{
		name: "build_revision",
		type: "UInt64",
		comment:
			"Run index build that wrote the request; the session's newest run index receipt names the build readers read.",
	},
	{
		name: "agent_id",
		type: "String",
		comment: "Transcript stream; empty for the main stream.",
	},
	{
		name: "start_record",
		type: "UInt32",
		comment:
			"Raw record index of the request's first response record (assistant text, reasoning or tool call); stable across re-uploads, like run ids.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment: "Transcript source: claude_code or codex.",
	},
	{
		name: "run_id",
		type: "String",
		comment:
			"Run node id of the run the request belongs to (run_index.run_id).",
	},
	{
		name: "run_start_record",
		type: "UInt32",
		comment: "start_record of the run the request belongs to.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment: "Run number within the stream.",
	},
	{
		name: "built_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker wrote the row.",
	},
	{
		name: "session_date",
		type: "DateTime64(3, 'UTC')",
		comment: "Session date of the generation.",
	},
	{
		name: "unrecorded_facts",
		type: "Array(LowCardinality(String))",
		comment:
			"Columns of this row whose values are unknown, not none: the usage columns when the session's usage extraction was incomplete.",
	},
	{
		name: "end_record",
		type: "UInt32",
		comment:
			"Start of the next request of the run, or the run's end_record: the request's lines are [start_record, end_record), and its usage is on them (the first request's from the run's start).",
	},
	{
		name: "started_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"When the model was asked: the time of the run's last non-meta record before the request (the prompt or the previous request's last record).",
	},
	{
		name: "ended_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"Time of the request's last activity record (not metadata, a compaction or injected context).",
	},
	{
		name: "call_records",
		type: "Array(UInt32)",
		comment:
			"Raw record index of each tool call the request made, in record order.",
	},
	{
		name: "call_tools",
		type: "Array(LowCardinality(String))",
		comment: "Tool name of each call, in call_records order.",
	},
	{
		name: "call_groups",
		type: "Array(LowCardinality(String))",
		comment:
			"Tool group of each call (shell, edit, read, search, browser, web, mcp, subagent, other), in call_records order.",
	},
	{
		name: "call_classes",
		type: "Array(LowCardinality(String))",
		comment:
			"Command class the parser gave each shell call (test, build, lint, typecheck, git, migrate, install, other; empty for other tools), in call_records order.",
	},
	{
		name: "call_failed",
		type: "Array(UInt8)",
		comment:
			"1 when the call's result is an error or a non-zero exit code, in call_records order.",
	},
	{
		name: "text_record",
		type: "Nullable(UInt32)",
		comment:
			"Raw record index of the request's last assistant text; NULL when the request wrote none.",
	},
	{
		name: "text_block",
		type: "Nullable(UInt16)",
		comment:
			"Block of that assistant text within its record (a line can hold reasoning, then text); NULL when the request wrote none.",
	},
	{
		name: "text_head",
		type: "Nullable(String)",
		comment:
			"First 160 characters of that assistant text; NULL when the request wrote none.",
	},
	{
		name: "usage_observations",
		type: "UInt32",
		comment:
			"Verified usage events of the session's usage extraction on the request's lines.",
	},
	{
		name: "usage_unpriced",
		type: "UInt32",
		comment: "Of usage_observations, events without a price.",
	},
	{
		name: "usage_model",
		type: "LowCardinality(String)",
		comment: "Model of the request's latest usage event; empty without usage.",
	},
	{
		name: "cost_usd",
		type: "Nullable(Float64)",
		comment:
			"Priced cost of usage_observations at the build's pricing; NULL when none is priced or the usage is unknown.",
	},
	requestUsage("uncached_input_tokens", "Uncached input tokens"),
	requestUsage("cache_read_input_tokens", "Cache read input tokens"),
	requestUsage(
		"cache_write_5m_input_tokens",
		"Five-minute cache write input tokens",
	),
	requestUsage(
		"cache_write_1h_input_tokens",
		"One-hour cache write input tokens",
	),
	requestUsage("output_tokens", "Output tokens"),
	requestUsage("reasoning_output_tokens", "Reasoning output tokens"),
];
