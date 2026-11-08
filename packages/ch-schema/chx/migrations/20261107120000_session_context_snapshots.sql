CREATE TABLE IF NOT EXISTS rudel.session_context_snapshots
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `revision` String COMMENT 'Transcript revision the snapshot was built from.',
  `index_version` UInt16 COMMENT 'Run index version of the build that wrote it.',
  `model` LowCardinality(String) COMMENT 'Model of the fullest call; empty when unknown.',
  `used_tokens` UInt64 COMMENT 'Tokens the fullest call sent.',
  `window_tokens` UInt64 COMMENT 'Context window of that call\'s model, in tokens.',
  `part_keys` Array(String) COMMENT 'Key of each part of the default view, largest first.',
  `part_kinds` Array(LowCardinality(String)) COMMENT 'Kind of each part, in part_keys order.',
  `part_labels` Array(String) COMMENT 'Label of each part, in part_keys order.',
  `part_tokens` Array(UInt64) COMMENT 'Tokens of each part, in part_keys order.',
  `snapshot` String COMMENT 'The whole snapshot as JSON (SessionContextSnapshot): each view\'s context map, compaction runs and costs.' CODEC(ZSTD(3)),
  `built_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker built it; the replacing version.'
) ENGINE = ReplacingMergeTree(built_at)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`)
ORDER BY (`organization_id`, `user_id`, `session_id`)
SETTINGS index_granularity = 1024, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Context snapshots of a session: the parts that filled its fullest moment, as its session page draws them; one row per session, the latest build\'s.';
