CREATE TABLE IF NOT EXISTS rudel.session_inventory
(
  `organization_id` String COMMENT 'Workspace the member\'s CLI reported the sessions to.',
  `user_id` String COMMENT 'Member whose machine holds the sessions.',
  `row_kind` LowCardinality(String) COMMENT 'report: the member\'s latest inventory (time, CLI version, totals); session: one session it listed.',
  `source` LowCardinality(String) COMMENT 'Agent of the session (claude_code, codex); empty on the report.',
  `session_id` String COMMENT 'Session id; empty on the report.',
  `reported_at` DateTime64(3, 'UTC') COMMENT 'UTC time the API received the inventory; the replacing version, so each row keeps its latest report.',
  `main_lines` UInt32 COMMENT 'Non-empty lines of the session\'s main transcript on the machine; 0 on the report.',
  `subagent_lines` UInt32 COMMENT 'Non-empty lines of the subagent transcripts an upload of the session would include; 0 on the report.',
  `subagent_files` UInt32 COMMENT 'Subagent transcripts an upload of the session would include; 0 on the report.',
  `main_bytes` UInt64 COMMENT 'Bytes of the main transcript on the machine; 0 on the report.',
  `subagent_bytes` UInt64 COMMENT 'Bytes of the subagent transcripts an upload would include; 0 on the report.',
  `modified_at` DateTime64(3, 'UTC') COMMENT 'Newest modification time of the session\'s files on the machine; the report time on the report.',
  `started_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'First timestamp the CLI read at the start of the transcript; NULL when it found none, and on the report.',
  `cli_version` String COMMENT 'Report: version of the CLI that sent it; empty on sessions.',
  `session_count` UInt32 COMMENT 'Report: sessions the inventory listed; 0 on sessions.',
  `omitted_count` UInt32 COMMENT 'Report: sessions the CLI found but left out of the inventory at its size cap; 0 on sessions.'
) ENGINE = ReplacingMergeTree(reported_at)
PRIMARY KEY (`organization_id`, `user_id`, `row_kind`, `source`, `session_id`)
ORDER BY (`organization_id`, `user_id`, `row_kind`, `source`, `session_id`)
TTL toDateTime(reported_at) + toIntervalDay(90)
SETTINGS index_granularity = 1024, storage_policy = 's3'
COMMENT 'Sessions each member\'s CLI reports on their machine under their upload settings (ids, line counts, sizes, times; no content): a report row per member and a session row per session, replaced by newer reports. Kept 90 days after the last report.';
