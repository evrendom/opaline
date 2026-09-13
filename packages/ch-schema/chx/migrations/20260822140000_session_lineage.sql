-- chkit-migration-format: v1
-- generated-at: 2026-08-22T07:01:22.804Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 13
-- operation-count: 2
-- rename-suggestion-count: 0
-- risk-summary: safe=2, caution=0, danger=0

-- operation: create_database key=database:rudel risk=safe
CREATE DATABASE IF NOT EXISTS rudel;

-- operation: create_table key=table:rudel.session_lineage risk=safe
CREATE TABLE IF NOT EXISTS rudel.session_lineage
(
  `organization_id` String,
  `user_id` String,
  `child_source` LowCardinality(String),
  `child_session_id` String,
  `child_session_date` DateTime64(3, 'UTC'),
  `child_first_ingested_at` DateTime64(3, 'UTC'),
  `child_start_ts` DateTime64(3, 'UTC'),
  `child_model` String,
  `child_originator` LowCardinality(String) DEFAULT '',
  `child_entrypoint` LowCardinality(String) DEFAULT '',
  `parent_source` LowCardinality(String),
  `parent_session_id` String,
  `parent_session_date` DateTime64(3, 'UTC'),
  `anchor_ts` DateTime64(3, 'UTC'),
  `anchor_tool_use_id` String,
  `anchor_operation_ordinal` UInt16,
  `carrier` LowCardinality(String),
  `outcome` LowCardinality(String),
  `confidence` LowCardinality(String),
  `countable` UInt8,
  `reason` String,
  `workdir` String DEFAULT '',
  `prompt_fingerprint` FixedString(64),
  `derivation_version` UInt16,
  `input_sequence` UInt64,
  `replacement_version` UInt64,
  `derived_at` DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(replacement_version)
PRIMARY KEY (`organization_id`, `user_id`, `child_source`, `child_session_id`)
ORDER BY (`organization_id`, `user_id`, `child_source`, `child_session_id`)
TTL toDate(child_session_date) + toIntervalDay(365)
SETTINGS index_granularity = 8192, storage_policy = 's3';
