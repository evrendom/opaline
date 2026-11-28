-- Requests a live session made since its last import, read by the Mac app from
-- the transcript's appended lines between imports; cost reads add the ones not
-- in the session's stored usage_events yet.

-- operation: create_table key=table:rudel.usage_events_pending risk=safe
CREATE TABLE IF NOT EXISTS rudel.usage_events_pending
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `source` LowCardinality(String) COMMENT 'Agent source, as in usage_events.',
  `session_id` String COMMENT 'Native session ID within organization, user and source.',
  `event_id` FixedString(64) COMMENT 'The request''s usage_events event_id, from the same extractor.',
  `agent_id` String COMMENT '''main'' or the subagent ID, as in usage_events.',
  `occurred_at` DateTime64(3, 'UTC') COMMENT 'When the request happened.',
  `usage_date` Date COMMENT 'UTC day of occurred_at.',
  `raw_model` String COMMENT 'Model as written.',
  `resolved_model` LowCardinality(String) COMMENT 'Canonical model, as in usage_events.',
  `model_status` LowCardinality(String) COMMENT 'As in usage_events.',
  `service_tier` LowCardinality(String) COMMENT 'As in usage_events.',
  `model_provider` LowCardinality(String) COMMENT 'As in usage_events.',
  `inference_speed` LowCardinality(String) COMMENT 'As in usage_events.',
  `inference_geo` LowCardinality(String) COMMENT 'As in usage_events.',
  `context_input_tokens` UInt64 COMMENT 'Input context size, for the long-context price band.',
  `uncached_input_tokens` UInt64 COMMENT 'Tokens.',
  `cache_read_input_tokens` UInt64 COMMENT 'Tokens.',
  `cache_write_5m_input_tokens` UInt64 COMMENT 'Tokens.',
  `cache_write_1h_input_tokens` UInt64 COMMENT 'Tokens.',
  `output_tokens` UInt64 COMMENT 'Tokens.',
  `quality_flags` Array(String) COMMENT 'As in usage_events.',
  `pricing_model` LowCardinality(String) COMMENT 'Rate-card model the request was priced as.',
  `context_band` LowCardinality(String) COMMENT '''base'' or ''long'' price band.',
  `has_geo_gap` UInt8 COMMENT 'Priced at the default region because the region was unknown.',
  `estimated_cost` Nullable(Float64) COMMENT 'USD from the rate card when read; NULL when the model has no published price.',
  `observed_at` DateTime64(3, 'UTC') COMMENT 'When the Mac app read it; the replacing version.'
) ENGINE = ReplacingMergeTree(observed_at)
PRIMARY KEY (`organization_id`, `user_id`, `source`, `session_id`, `event_id`)
ORDER BY (`organization_id`, `user_id`, `source`, `session_id`, `event_id`)
TTL toDateTime(observed_at) + toIntervalDay(3)
SETTINGS index_granularity = 1024, storage_policy = 's3'
COMMENT 'Requests a live session made since its last import, read from the transcript''s appended lines by the Mac app between imports. Cost reads add the ones whose event_id is not in the session''s stored usage_events yet; the next import stores them and they stop counting. Kept three days.';
