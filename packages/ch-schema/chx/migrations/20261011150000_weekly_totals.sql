-- Weekly totals (docs/l1-literal-schema.md, "Weekly totals"): per workspace,
-- member, agent and ISO week (Monday, UTC), the sums of the additive facts of
-- each session's committed run index build: the build its newest receipt by
-- (revision, parser_version, index_version, build_revision) names, as every
-- run index reader reads it. FINAL collapses a retried insert of the same
-- build. Usage no run claims (on the receipt) counts in the week of its
-- session date; a week with neither runs nor usage has no row. A fact the
-- parser version or agent cannot record is left out of its sum and counted
-- apart in <fact>_known_runs, so unknown is never zero.
--
-- chkit cannot express REFRESH, so the view is hand-written and applied by
-- scripts/migrate-weekly-totals.ts. Production's database is Atomic, where
-- ClickHouse does not coordinate refreshes between replicas: every replica
-- refreshes on its own. The view therefore APPENDs a whole snapshot per
-- refresh, tagged with refresh_id and its row count, and readers read the
-- newest complete snapshot; a replace refresh (EXCHANGE of the target) is
-- only safe when one replica refreshes. Day partitions let the TTL drop old
-- snapshots whole. The first refresh runs when the view is created.

CREATE TABLE IF NOT EXISTS rudel.weekly_totals
(
  `refreshed_at` DateTime64(6, 'UTC') COMMENT 'UTC time the refresh that wrote the snapshot started; snapshots expire after 14 days.',
  `refresh_id` String COMMENT 'Snapshot id (replica host and refreshed_at). Each refresh appends a full snapshot, and readers read only the newest complete one.',
  `snapshot_rows` UInt64 COMMENT 'Rows of the snapshot; a snapshot with fewer rows stored is incomplete and never read.',
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Member: the sessions\' owner.',
  `agent` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `week` Date COMMENT 'Monday (UTC) of the ISO week the runs started in; the usage no run claims counts in the week of its session date.',
  `runs` UInt64 COMMENT 'Runs (one human prompt and everything until the next) that started in the week, subagent streams included.',
  `sessions` UInt64 COMMENT 'Sessions with a run that started in the week. A session that spans weeks counts in each, so it does not add up across weeks.',
  `sessions_started` UInt64 COMMENT 'Sessions whose first run started in the week; adds up across weeks.',
  `genuine_prompts` UInt64 COMMENT 'Human prompts of the runs of the row (queued prompts included, delegated tasks not).',
  `minutes` Float64 COMMENT 'Wall-clock minutes of the runs of the row, each from its first record to its last non-meta record.',
  `active_minutes` Float64 COMMENT 'Active minutes of the runs of the row: gaps between non-meta records, each capped at five minutes.',
  `tool_calls` UInt64 COMMENT 'Tool call records of the runs of the row.',
  `failed_calls` UInt64 COMMENT 'Calls of the runs of the row whose result is an error or has a non-zero exit code.',
  `edits` UInt64 COMMENT 'Sum of each run\'s distinct files written, edited or deleted by calls that did not fail.',
  `reads` UInt64 COMMENT 'Tool calls in the read group of the runs of the row.',
  `searches` UInt64 COMMENT 'Tool calls in the search group of the runs of the row.',
  `not_found` UInt64 COMMENT 'Failed reads and searches of the runs of the row whose text says not found, no such file, ENOENT or No files found.',
  `compactions` UInt64 COMMENT 'Compaction records of the runs of the row.',
  `interrupt_markers` UInt64 COMMENT 'Interrupt marker records of the runs of the row (Claude [Request interrupted by user], Codex turn_aborted wrappers).',
  `edit_outcomes_known_runs` UInt64 COMMENT 'Runs of the row that can record failed and refused edits (parser 9 or newer); the matching sums cover only these runs.',
  `failed_edits` Nullable(UInt64) COMMENT 'Failed edit requests, excluding refusals, summed over the known runs; NULL when no run of the row can record it.',
  `refused_edits` Nullable(UInt64) COMMENT 'Refused native edit requests, including user declines but excluding interruptions, summed over the known runs; NULL when no run of the row can record it.',
  `denied_calls_known_runs` UInt64 COMMENT 'Runs of the row that can record denials (parser 9 or newer); the matching sums cover only these runs.',
  `denied_calls` Nullable(UInt64) COMMENT 'Calls whose result records a denial_kind, summed over the known runs; NULL when no run of the row can record it.',
  `interrupted_calls_known_runs` UInt64 COMMENT 'Runs of the row that can record interrupted calls (Claude Code parser 6, Codex parser 8 or newer); the matching sums cover only these runs.',
  `interrupted_calls` Nullable(UInt64) COMMENT 'Calls whose result records interrupted = true, summed over the known runs; NULL when no run of the row can record it.',
  `timed_out_calls_known_runs` UInt64 COMMENT 'Runs of the row that can record timed-out calls (Claude Code parser 6 or newer); the matching sums cover only these runs.',
  `timed_out_calls` Nullable(UInt64) COMMENT 'Calls whose result records timedOutAfterMs, summed over the known runs; NULL when no run of the row can record it.',
  `mcp_calls_known_runs` UInt64 COMMENT 'Runs of the row that can record MCP calls (Claude Code parser 9, Codex parser 6 or newer); the matching sums cover only these runs.',
  `mcp_calls` Nullable(UInt64) COMMENT 'Calls with a recorded MCP server, summed over the known runs; NULL when no run of the row can record it.',
  `api_errors_known_runs` UInt64 COMMENT 'Runs of the row that can record API errors (Claude Code parser 7, Codex parser 9 or newer); the matching sums cover only these runs.',
  `api_errors` Nullable(UInt64) COMMENT 'API error records (Claude API errors, Codex terminal provider or transport errors), summed over the known runs; NULL when no run of the row can record it.',
  `retry_attempts_known_runs` UInt64 COMMENT 'Runs of the row that can record API retries (Claude Code parser 7 or newer); the matching sums cover only these runs.',
  `retry_attempts` Nullable(UInt64) COMMENT 'Claude API retry records, summed over the known runs; NULL when no run of the row can record it.',
  `refusals_known_runs` UInt64 COMMENT 'Runs of the row that can record model refusals (Claude Code parser 7 or newer); the matching sums cover only these runs.',
  `refusals` Nullable(UInt64) COMMENT 'Claude model refusal records, summed over the known runs; NULL when no run of the row can record it.',
  `aborted_known_runs` UInt64 COMMENT 'Runs of the row that can record an abort (parser 7 or newer); the matching sums cover only these runs.',
  `aborted_runs` Nullable(UInt64) COMMENT 'Runs a record says aborted (Codex turn_aborted, Claude interruptedByShutdown), summed over the known runs; NULL when no run of the row can record it.',
  `turn_error_known_runs` UInt64 COMMENT 'Runs of the row that can record a turn error (Codex parser 7 or newer); the matching sums cover only these runs.',
  `turn_error_runs` Nullable(UInt64) COMMENT 'Runs whose Codex task_complete records an error, summed over the known runs; NULL when no run of the row can record it.',
  `git_operations_known_runs` UInt64 COMMENT 'Runs of the row that can record Claude gitOperation (Claude Code parser 6 or newer; Codex git activity is in find source=git); the matching sums cover only these runs.',
  `push_runs` Nullable(UInt64) COMMENT 'Runs with a Claude gitOperation push, summed over the known runs; NULL when no run of the row can record it.',
  `commit_runs` Nullable(UInt64) COMMENT 'Runs with a Claude gitOperation commit, summed over the known runs; NULL when no run of the row can record it.',
  `pr_runs` Nullable(UInt64) COMMENT 'Runs with a Claude gitOperation pr, summed over the known runs; NULL when no run of the row can record it.',
  `commit_shas` Nullable(UInt64) COMMENT 'Distinct Claude gitOperation commit SHAs of each run, added up, summed over the known runs; NULL when no run of the row can record it.',
  `pr_urls_known_runs` UInt64 COMMENT 'Runs of the row that can record pull request URLs (Claude Code parser 6 or newer, every Codex parser); the matching sums cover only these runs.',
  `pr_urls` Nullable(UInt64) COMMENT 'Distinct pull request URLs of each run (named, not necessarily created), added up, summed over the known runs; NULL when no run of the row can record it.',
  `skills_known_runs` UInt64 COMMENT 'Runs of the row that can record skills (Claude Code parser 6, Codex parser 9 or newer); the matching sums cover only these runs.',
  `skill_runs` Nullable(UInt64) COMMENT 'Runs that used at least one skill, summed over the known runs; NULL when no run of the row can record it.',
  `skills` Nullable(UInt64) COMMENT 'Distinct skills of each run, added up, summed over the known runs; NULL when no run of the row can record it.',
  `slash_commands_known_runs` UInt64 COMMENT 'Runs of the row that can record slash commands (Claude Code); the matching sums cover only these runs.',
  `slash_commands` Nullable(UInt64) COMMENT 'Distinct slash commands of each run, added up, summed over the known runs; NULL when no run of the row can record it.',
  `subagent_types_known_runs` UInt64 COMMENT 'Runs of the row that can record subagent types (Claude Code, Codex parser 9 or newer); the matching sums cover only these runs.',
  `subagent_type_runs` Nullable(UInt64) COMMENT 'Runs that started a subagent with a recorded type, summed over the known runs; NULL when no run of the row can record it.',
  `usage_known_runs` UInt64 COMMENT 'Runs whose session\'s usage extraction was complete, so their usage and cost are known; the others count no usage.',
  `usage_observations` UInt64 COMMENT 'Usage events of the runs, plus the usage no run claims, which counts in the week of its session date.',
  `usage_unpriced` UInt64 COMMENT 'Of usage_observations, events without a price.',
  `cost_usd` Nullable(Float64) COMMENT 'Priced cost in USD of usage_observations (the runs\' and the usage no run claims), at the pricing of each build; NULL when nothing is priced.',
  `unattributed_cost_usd` Nullable(Float64) COMMENT 'Of cost_usd, the priced usage no run claims, counted in the week of its session date; NULL when none.',
  `uncached_input_tokens` Nullable(UInt64) COMMENT 'Uncached input tokens of usage_observations; NULL without usage.',
  `cache_read_input_tokens` Nullable(UInt64) COMMENT 'Cache read input tokens of usage_observations; NULL without usage.',
  `cache_write_5m_input_tokens` Nullable(UInt64) COMMENT 'Five-minute cache write input tokens of usage_observations; NULL without usage.',
  `cache_write_1h_input_tokens` Nullable(UInt64) COMMENT 'One-hour cache write input tokens of usage_observations; NULL without usage.',
  `output_tokens` Nullable(UInt64) COMMENT 'Output tokens of usage_observations; NULL without usage.',
  `reasoning_output_tokens` Nullable(UInt64) COMMENT 'Reasoning output tokens of usage_observations; NULL without usage.'
) ENGINE = MergeTree
PARTITION BY toDate(refreshed_at)
PRIMARY KEY (`organization_id`, `refresh_id`, `user_id`, `agent`, `week`)
ORDER BY (`organization_id`, `refresh_id`, `user_id`, `agent`, `week`)
TTL toDateTime(refreshed_at) + toIntervalDay(14)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 's3'
COMMENT 'Nightly snapshots of the run index summed per workspace, member, agent and ISO week; appended only by weekly_totals_mv.';

CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.weekly_totals_mv
REFRESH EVERY 1 DAY OFFSET 3 HOUR APPEND
TO rudel.weekly_totals
AS SELECT
  refreshed_at, refresh_id, count() OVER () AS snapshot_rows,
  organization_id, user_id, agent, week, sessions, sessions_started,
  runs, genuine_prompts, minutes, active_minutes, tool_calls, failed_calls, edits, reads, searches, not_found, compactions, interrupt_markers, edit_outcomes_known_runs, failed_edits, refused_edits, denied_calls_known_runs, denied_calls, interrupted_calls_known_runs, interrupted_calls, timed_out_calls_known_runs, timed_out_calls, mcp_calls_known_runs, mcp_calls, api_errors_known_runs, api_errors, retry_attempts_known_runs, retry_attempts, refusals_known_runs, refusals, aborted_known_runs, aborted_runs, turn_error_known_runs, turn_error_runs, git_operations_known_runs, push_runs, commit_runs, pr_runs, commit_shas, pr_urls_known_runs, pr_urls, skills_known_runs, skill_runs, skills, slash_commands_known_runs, slash_commands, subagent_types_known_runs, subagent_type_runs, usage_known_runs, usage_observations, usage_unpriced, cost_usd, unattributed_cost_usd, uncached_input_tokens, cache_read_input_tokens, cache_write_5m_input_tokens, cache_write_1h_input_tokens, output_tokens, reasoning_output_tokens
FROM (
  SELECT
    now64(6, 'UTC') AS refreshed_at,
    concat(hostName(), ' ', toString(refreshed_at)) AS refresh_id,
    s.organization_id AS organization_id, s.user_id AS user_id, s.agent AS agent, s.week AS week,
    countIf(s.runs > 0) AS sessions,
    countIf(s.runs > 0 AND s.week = s.first_week) AS sessions_started,
    sum(s.runs) AS runs,
    sum(s.genuine_prompts) AS genuine_prompts,
    sum(s.minutes) AS minutes,
    sum(s.active_minutes) AS active_minutes,
    sum(s.tool_calls) AS tool_calls,
    sum(s.failed_calls) AS failed_calls,
    sum(s.edits) AS edits,
    sum(s.reads) AS reads,
    sum(s.searches) AS searches,
    sum(s.not_found) AS not_found,
    sum(s.compactions) AS compactions,
    sum(s.interrupt_markers) AS interrupt_markers,
    sum(s.edit_outcomes_known_runs) AS edit_outcomes_known_runs,
    if(sum(s.edit_outcomes_known_runs) = 0, NULL, sum(s.failed_edits)) AS failed_edits,
    if(sum(s.edit_outcomes_known_runs) = 0, NULL, sum(s.refused_edits)) AS refused_edits,
    sum(s.denied_calls_known_runs) AS denied_calls_known_runs,
    if(sum(s.denied_calls_known_runs) = 0, NULL, sum(s.denied_calls)) AS denied_calls,
    sum(s.interrupted_calls_known_runs) AS interrupted_calls_known_runs,
    if(sum(s.interrupted_calls_known_runs) = 0, NULL, sum(s.interrupted_calls)) AS interrupted_calls,
    sum(s.timed_out_calls_known_runs) AS timed_out_calls_known_runs,
    if(sum(s.timed_out_calls_known_runs) = 0, NULL, sum(s.timed_out_calls)) AS timed_out_calls,
    sum(s.mcp_calls_known_runs) AS mcp_calls_known_runs,
    if(sum(s.mcp_calls_known_runs) = 0, NULL, sum(s.mcp_calls)) AS mcp_calls,
    sum(s.api_errors_known_runs) AS api_errors_known_runs,
    if(sum(s.api_errors_known_runs) = 0, NULL, sum(s.api_errors)) AS api_errors,
    sum(s.retry_attempts_known_runs) AS retry_attempts_known_runs,
    if(sum(s.retry_attempts_known_runs) = 0, NULL, sum(s.retry_attempts)) AS retry_attempts,
    sum(s.refusals_known_runs) AS refusals_known_runs,
    if(sum(s.refusals_known_runs) = 0, NULL, sum(s.refusals)) AS refusals,
    sum(s.aborted_known_runs) AS aborted_known_runs,
    if(sum(s.aborted_known_runs) = 0, NULL, sum(s.aborted_runs)) AS aborted_runs,
    sum(s.turn_error_known_runs) AS turn_error_known_runs,
    if(sum(s.turn_error_known_runs) = 0, NULL, sum(s.turn_error_runs)) AS turn_error_runs,
    sum(s.git_operations_known_runs) AS git_operations_known_runs,
    if(sum(s.git_operations_known_runs) = 0, NULL, sum(s.push_runs)) AS push_runs,
    if(sum(s.git_operations_known_runs) = 0, NULL, sum(s.commit_runs)) AS commit_runs,
    if(sum(s.git_operations_known_runs) = 0, NULL, sum(s.pr_runs)) AS pr_runs,
    if(sum(s.git_operations_known_runs) = 0, NULL, sum(s.commit_shas)) AS commit_shas,
    sum(s.pr_urls_known_runs) AS pr_urls_known_runs,
    if(sum(s.pr_urls_known_runs) = 0, NULL, sum(s.pr_urls)) AS pr_urls,
    sum(s.skills_known_runs) AS skills_known_runs,
    if(sum(s.skills_known_runs) = 0, NULL, sum(s.skill_runs)) AS skill_runs,
    if(sum(s.skills_known_runs) = 0, NULL, sum(s.skills)) AS skills,
    sum(s.slash_commands_known_runs) AS slash_commands_known_runs,
    if(sum(s.slash_commands_known_runs) = 0, NULL, sum(s.slash_commands)) AS slash_commands,
    sum(s.subagent_types_known_runs) AS subagent_types_known_runs,
    if(sum(s.subagent_types_known_runs) = 0, NULL, sum(s.subagent_type_runs)) AS subagent_type_runs,
    sum(s.usage_known_runs) AS usage_known_runs,
    sum(s.usage_observations) AS usage_observations,
    sum(s.usage_unpriced) AS usage_unpriced,
    sum(s.cost_usd) AS cost_usd,
    sum(s.unattributed_cost_usd) AS unattributed_cost_usd,
    sum(s.uncached_input_tokens) AS uncached_input_tokens,
    sum(s.cache_read_input_tokens) AS cache_read_input_tokens,
    sum(s.cache_write_5m_input_tokens) AS cache_write_5m_input_tokens,
    sum(s.cache_write_1h_input_tokens) AS cache_write_1h_input_tokens,
    sum(s.output_tokens) AS output_tokens,
    sum(s.reasoning_output_tokens) AS reasoning_output_tokens
  FROM (
    SELECT *, minIf(week, runs > 0) OVER (PARTITION BY organization_id, user_id, session_id) AS first_week
    FROM (
      SELECT
        r.organization_id AS organization_id, r.user_id AS user_id, r.session_id AS session_id,
        r.source AS agent, toMonday(r.started_at) AS week,
        countIf(r.row_kind = 'run') AS runs,
        sumIf(r.genuine_prompts, r.row_kind = 'run') AS genuine_prompts,
        sumIf(r.minutes, r.row_kind = 'run') AS minutes,
        sumIf(r.active_minutes, r.row_kind = 'run') AS active_minutes,
        sumIf(r.tool_calls, r.row_kind = 'run') AS tool_calls,
        sumIf(r.failed_calls, r.row_kind = 'run') AS failed_calls,
        sumIf(r.edits, r.row_kind = 'run') AS edits,
        sumIf(r.reads, r.row_kind = 'run') AS reads,
        sumIf(r.searches, r.row_kind = 'run') AS searches,
        sumIf(r.not_found, r.row_kind = 'run') AS not_found,
        sumIf(r.compactions, r.row_kind = 'run') AS compactions,
        sumIf(r.interrupt_markers, r.row_kind = 'run') AS interrupt_markers,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'failed_edits')) AS edit_outcomes_known_runs,
        sumIf(r.failed_edits, r.row_kind = 'run') AS failed_edits,
        sumIf(r.refused_edits, r.row_kind = 'run') AS refused_edits,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'denied_calls')) AS denied_calls_known_runs,
        sumIf(r.denied_calls, r.row_kind = 'run') AS denied_calls,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'interrupted_calls')) AS interrupted_calls_known_runs,
        sumIf(r.interrupted_calls, r.row_kind = 'run') AS interrupted_calls,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'timed_out_calls')) AS timed_out_calls_known_runs,
        sumIf(r.timed_out_calls, r.row_kind = 'run') AS timed_out_calls,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'mcp_calls')) AS mcp_calls_known_runs,
        sumIf(r.mcp_calls, r.row_kind = 'run') AS mcp_calls,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'api_errors')) AS api_errors_known_runs,
        sumIf(r.api_errors, r.row_kind = 'run') AS api_errors,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'retry_attempts')) AS retry_attempts_known_runs,
        sumIf(r.retry_attempts, r.row_kind = 'run') AS retry_attempts,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'refusals')) AS refusals_known_runs,
        sumIf(r.refusals, r.row_kind = 'run') AS refusals,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'aborted')) AS aborted_known_runs,
        countIf(r.row_kind = 'run' AND r.aborted = 'true') AS aborted_runs,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'turn_error')) AS turn_error_known_runs,
        countIf(r.row_kind = 'run' AND ifNull(r.turn_error, '') != '') AS turn_error_runs,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'git_operations')) AS git_operations_known_runs,
        countIf(r.row_kind = 'run' AND has(r.git_operations, 'push')) AS push_runs,
        countIf(r.row_kind = 'run' AND has(r.git_operations, 'commit')) AS commit_runs,
        countIf(r.row_kind = 'run' AND has(r.git_operations, 'pr')) AS pr_runs,
        sumIf(length(r.commit_shas), r.row_kind = 'run') AS commit_shas,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'pr_urls')) AS pr_urls_known_runs,
        sumIf(length(r.pr_urls), r.row_kind = 'run') AS pr_urls,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'skills')) AS skills_known_runs,
        countIf(r.row_kind = 'run' AND notEmpty(r.skills)) AS skill_runs,
        sumIf(length(r.skills), r.row_kind = 'run') AS skills,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'slash_commands')) AS slash_commands_known_runs,
        sumIf(length(r.slash_commands), r.row_kind = 'run') AS slash_commands,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'subagent_types')) AS subagent_types_known_runs,
        countIf(r.row_kind = 'run' AND notEmpty(r.subagent_types)) AS subagent_type_runs,
        countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'cost_usd')) AS usage_known_runs,
        sum(r.usage_observations) AS usage_observations,
        sum(r.usage_unpriced) AS usage_unpriced,
        sum(r.cost_usd) AS cost_usd,
        sumIf(r.cost_usd, r.row_kind = 'receipt') AS unattributed_cost_usd,
        sum(r.uncached_input_tokens) AS uncached_input_tokens,
        sum(r.cache_read_input_tokens) AS cache_read_input_tokens,
        sum(r.cache_write_5m_input_tokens) AS cache_write_5m_input_tokens,
        sum(r.cache_write_1h_input_tokens) AS cache_write_1h_input_tokens,
        sum(r.output_tokens) AS output_tokens,
        sum(r.reasoning_output_tokens) AS reasoning_output_tokens
      FROM rudel.run_index AS r FINAL
      WHERE (r.organization_id, r.user_id, r.session_id, r.revision, r.parser_version, r.index_version, r.build_revision) IN (
        SELECT organization_id, user_id, session_id, committed.1, committed.2, committed.3, committed.4
        FROM (
          SELECT organization_id, user_id, session_id,
            max((revision, parser_version, index_version, build_revision)) AS committed
          FROM rudel.run_index
          WHERE row_kind = 'receipt'
          GROUP BY organization_id, user_id, session_id
        )
      )
      GROUP BY organization_id, user_id, session_id, agent, week
    )
  ) AS s
  GROUP BY organization_id, user_id, agent, week
  HAVING runs > 0 OR usage_observations > 0
)
SETTINGS max_threads = 2, max_memory_usage = 2000000000, max_bytes_before_external_group_by = 1000000000, remote_filesystem_read_prefetch = 0, max_execution_time = 1800
COMMENT 'Appends a snapshot of weekly_totals every night at 03:00 UTC from the committed run index builds.';
