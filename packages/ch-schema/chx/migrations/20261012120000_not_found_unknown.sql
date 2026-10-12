-- OPL-384: reads and searches that found nothing, unknown where they cannot
-- be recorded, and the session repository on every run (docs/l1-literal-schema.md,
-- "Scale" and "Weekly totals").
--
-- run_index.not_found becomes nullable: NULL (and named in unrecorded_facts)
-- where the parser version or agent stream cannot record it, never 0. The
-- type change is a mutation that rewrites this one column of a small table;
-- run index 3 rebuilds every snapshot with the new count. repository is now
-- written on every run, not only on the receipt, so its comment changes.
--
-- weekly_totals sums not_found only over the runs that can record it and
-- counts them in not_found_known_runs, like every other gated fact; runs of
-- run index 2 builds, which counted only failures with not-found text, are
-- not known until their session is rebuilt at index 3. Its
-- refreshable view is recreated with the new query: chkit cannot express
-- REFRESH, and dropping the view keeps the target table and its snapshots.
-- Unlike the insert-triggered session analytics views (changed in place with
-- MODIFY QUERY), nothing is lost between DROP and CREATE: every refresh
-- recomputes all of it from the run index. Creating it runs its first refresh
-- at once, which only reads the run index and appends a snapshot. Applied by
-- scripts/migrate-not-found-unknown.ts.

ALTER TABLE rudel.run_index
    MODIFY COLUMN not_found Nullable(UInt32) COMMENT 'Read and search calls whose result records that they found nothing: Claude Code\'s zero-result text, zero match or file counts or returnCodeInterpretation \'No matches found\', the shell\'s no matches found for a file pattern, a search that printed nothing (unless its command silences or redirects its output), or a failure whose text says not found, no such file, ENOENT or does not exist; NULL when the parser version or agent does not record it (Claude Code before parser 6, and its subagent streams, which keep no tool result details).',
    COMMENT COLUMN repository 'The session repository key as recorded (git remote, else package name, else project path), on every run and on the receipt; empty when none was recorded.';

ALTER TABLE rudel.weekly_totals
    ADD COLUMN IF NOT EXISTS not_found_known_runs UInt64 COMMENT 'Runs of the row that can record reads and searches that found nothing (run index 3 or newer; Claude Code parser 6 or newer on its main stream, Codex every parser); the matching sums cover only these runs.' AFTER searches,
    MODIFY COLUMN not_found Nullable(UInt64) COMMENT 'Read and search calls that found nothing, summed over the known runs; NULL when no run of the row can record it.';

DROP VIEW IF EXISTS rudel.weekly_totals_mv;

CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.weekly_totals_mv
REFRESH EVERY 1 DAY OFFSET 3 HOUR APPEND
TO rudel.weekly_totals
AS SELECT
  refreshed_at, refresh_id, count() OVER () AS snapshot_rows,
  organization_id, user_id, agent, week, sessions, sessions_started,
  runs, genuine_prompts, minutes, active_minutes, tool_calls, failed_calls, edits, reads, searches, not_found_known_runs, not_found, compactions, interrupt_markers, edit_outcomes_known_runs, failed_edits, refused_edits, denied_calls_known_runs, denied_calls, interrupted_calls_known_runs, interrupted_calls, timed_out_calls_known_runs, timed_out_calls, mcp_calls_known_runs, mcp_calls, api_errors_known_runs, api_errors, retry_attempts_known_runs, retry_attempts, refusals_known_runs, refusals, aborted_known_runs, aborted_runs, turn_error_known_runs, turn_error_runs, git_operations_known_runs, push_runs, commit_runs, pr_runs, commit_shas, pr_urls_known_runs, pr_urls, skills_known_runs, skill_runs, skills, slash_commands_known_runs, slash_commands, subagent_types_known_runs, subagent_type_runs, usage_known_runs, usage_observations, usage_unpriced, cost_usd, unattributed_cost_usd, uncached_input_tokens, cache_read_input_tokens, cache_write_5m_input_tokens, cache_write_1h_input_tokens, output_tokens, reasoning_output_tokens
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
    sum(s.not_found_known_runs) AS not_found_known_runs,
    if(sum(s.not_found_known_runs) = 0, NULL, sum(s.not_found)) AS not_found,
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
        countIf(r.row_kind = 'run' AND r.index_version >= 3 AND NOT has(r.unrecorded_facts, 'not_found')) AS not_found_known_runs,
        sumIf(r.not_found, r.row_kind = 'run' AND r.index_version >= 3 AND NOT has(r.unrecorded_facts, 'not_found')) AS not_found,
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
