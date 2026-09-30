-- chkit-migration-format: v1
-- generated-at: 2026-09-30T10:58:09.322Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 15
-- operation-count: 2
-- rename-suggestion-count: 0
-- risk-summary: safe=2, caution=0, danger=0

-- operation: create_database key=database:rudel risk=safe
CREATE DATABASE IF NOT EXISTS rudel;

-- operation: create_table key=table:rudel.transcript_records risk=safe
CREATE TABLE IF NOT EXISTS rudel.transcript_records
(
  `organization_id` String,
  `user_id` String,
  `session_id` String,
  `source` LowCardinality(String),
  `agent_id` String,
  `revision` UInt64,
  `record_idx` UInt32,
  `block_idx` UInt16,
  `turn_idx` UInt32,
  `ts` DateTime64(3, 'UTC'),
  `session_date` DateTime64(3, 'UTC'),
  `kind` LowCardinality(String),
  `subtype` LowCardinality(String),
  `tool_name` LowCardinality(String),
  `command_class` LowCardinality(String),
  `is_error` Bool,
  `exit_code` Nullable(Int32),
  `call_id` String,
  `file_path` String,
  `file_op` LowCardinality(String),
  `spawned_agent_id` String,
  `byte_start` UInt64,
  `byte_len` UInt32,
  `text_chars` UInt32,
  `parser_version` UInt16,
  `head` String,
  `tail` String,
  `text` String CODEC(ZSTD(3))
) ENGINE = ReplacingMergeTree()
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`)
TTL toDate(session_date) + toIntervalDay(365)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Deterministic per-record transcript index for selective reads. Light columns answer structure questions; text is read only for explicit record drill-downs.';
