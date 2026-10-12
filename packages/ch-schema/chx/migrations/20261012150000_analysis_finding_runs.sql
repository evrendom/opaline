-- Finding impact (docs/retro-architecture.md, "Finding impact"): each saved
-- finding's cited runs with the cost, tokens and active time their committed
-- run index build recorded, written by the API when an analysis is saved and
-- again, with the analysis's new visibility_revision (the version column),
-- when it is shared or unshared: under FINAL the highest revision wins.
-- Readers read it with FINAL through the sql tool's finding_runs view. Account and
-- workspace purges delete its rows. A new table: no lock on existing data.

CREATE TABLE IF NOT EXISTS rudel.analysis_finding_runs
(
  `organization_id` String COMMENT 'Workspace of the analysis; tenant boundary.',
  `analysis_id` String COMMENT 'Saved analysis id.',
  `step_id` String COMMENT 'Step whose finding cites the run; one finding per step.',
  `finding` String COMMENT 'The finding as the analysis saved it.',
  `author_id` String COMMENT 'Author of the analysis; only they read its rows until it is shared.',
  `shared` UInt8 COMMENT '1 while the analysis is shared with its workspace, else 0, as of visibility_revision.',
  `visibility_revision` UInt64 COMMENT 'Revision of the analysis\'s visibility these rows hold, from the analysis log; the highest wins under FINAL, so an older share or unshare written late never replaces a newer one.',
  `quoted_owners` Array(String) COMMENT 'Members whose deletion deletes the analysis and these rows: every member a query of it read and quoted, and every member a finding\'s result names a session of.',
  `saved_at` DateTime64(3, 'UTC') COMMENT 'UTC time the analysis was saved.',
  `user_id` String COMMENT 'Member who owns the run\'s session.',
  `session_id` String COMMENT 'Session of the run.',
  `agent_id` String COMMENT 'Stream of the run; empty for the main transcript.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream, as in runs.',
  `started_at` DateTime64(3, 'UTC') COMMENT 'Timestamp of the run\'s first record. Copied from the run\'s committed run index build when the analysis was saved.',
  `minutes` Float64 COMMENT 'Wall-clock minutes from the first record to the last non-meta record. Copied from the run\'s committed run index build when the analysis was saved.',
  `active_minutes` Float64 COMMENT 'Sum of the gaps between non-meta records, each capped at five minutes. Copied from the run\'s committed run index build when the analysis was saved.',
  `cost_usd` Nullable(Float64) COMMENT 'Priced cost of usage_observations at pricing_version; NULL when none is priced. Copied from the run\'s committed run index build when the analysis was saved.',
  `uncached_input_tokens` Nullable(UInt64) COMMENT 'Uncached input tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `cache_read_input_tokens` Nullable(UInt64) COMMENT 'Cache read input tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `cache_write_5m_input_tokens` Nullable(UInt64) COMMENT 'Five-minute cache write input tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `cache_write_1h_input_tokens` Nullable(UInt64) COMMENT 'One-hour cache write input tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `output_tokens` Nullable(UInt64) COMMENT 'Output tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `reasoning_output_tokens` Nullable(UInt64) COMMENT 'Reasoning output tokens of usage_observations; NULL without usage. Copied from the run\'s committed run index build when the analysis was saved.',
  `unrecorded_facts` Array(LowCardinality(String)) COMMENT 'Fact columns of this row whose values are unknown, not none: the parser version or agent cannot record them, or the usage extraction was incomplete. Copied from the run\'s committed run index build when the analysis was saved.'
) ENGINE = ReplacingMergeTree(visibility_revision)
PRIMARY KEY (`organization_id`, `analysis_id`, `step_id`, `user_id`, `session_id`, `agent_id`, `turn_idx`)
ORDER BY (`organization_id`, `analysis_id`, `step_id`, `user_id`, `session_id`, `agent_id`, `turn_idx`)
SETTINGS index_granularity = 8192, storage_policy = 's3'
COMMENT 'Each saved finding\'s cited runs with their recorded cost, tokens and active time; written when an analysis is saved or shared.';
