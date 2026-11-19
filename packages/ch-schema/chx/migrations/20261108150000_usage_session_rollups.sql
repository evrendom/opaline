CREATE TABLE IF NOT EXISTS rudel.usage_session_rollups
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `source` LowCardinality(String) COMMENT 'Agent source, as in usage_events.',
  `session_id` String COMMENT 'Native session ID within organization, user and source.',
  `receipt_generation` UInt64 COMMENT 'Usage-event generation of the latest receipt the row was built from; 0 without one. The replacing version.',
  `is_consistent` UInt8 COMMENT '1 when that receipt is complete, not deleted and its generation holds exactly its event count; only these sessions are priced.',
  `latest_main_model` LowCardinality(String) COMMENT 'Model of the main thread\'s latest request in that generation; empty when unknown.',
  `latest_event_model` LowCardinality(String) COMMENT 'Model of the latest request of any thread in that generation; empty when unknown.',
  `record_kinds` Array(LowCardinality(String)) COMMENT 'Per pricing group: event or receipt.',
  `usage_dates` Array(Date) COMMENT 'Per pricing group: UTC usage date.',
  `pricing_identities` Array(LowCardinality(String)) COMMENT 'Per pricing group: the raw model when unresolved, else the resolved model.',
  `model_providers` Array(LowCardinality(String)) COMMENT 'Per pricing group: recorded model provider.',
  `service_tiers` Array(LowCardinality(String)) COMMENT 'Per pricing group: recorded service tier.',
  `inference_speeds` Array(LowCardinality(String)) COMMENT 'Per pricing group: recorded inference speed.',
  `inference_geos` Array(LowCardinality(String)) COMMENT 'Per pricing group: recorded inference geography.',
  `context_bands` Array(LowCardinality(String)) COMMENT 'Per pricing group: long when the request context exceeded its model\'s long-context threshold, else base.',
  `priceable` Array(UInt8) COMMENT 'Per pricing group: 1 when its requests pass the pricing quality checks.',
  `geo_gaps` Array(UInt8) COMMENT 'Per pricing group: 1 when the provider reported no billing geography.',
  `uncached_input_tokens` Array(UInt64) COMMENT 'Per pricing group: uncached input tokens.',
  `cache_read_input_tokens` Array(UInt64) COMMENT 'Per pricing group: cache read input tokens.',
  `cache_write_5m_input_tokens` Array(UInt64) COMMENT 'Per pricing group: 5-minute cache write input tokens.',
  `cache_write_1h_input_tokens` Array(UInt64) COMMENT 'Per pricing group: 1-hour cache write input tokens.',
  `output_tokens` Array(UInt64) COMMENT 'Per pricing group: output tokens.',
  `build_version` UInt32 COMMENT 'Fingerprint of the grouping rules that built the row; rows of another fingerprint are rebuilt.',
  `built_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the row was built.',
  `retry_after` DateTime64(3, 'UTC') COMMENT 'After a failed rebuild, the backfill leaves the session alone until this UTC time; the epoch otherwise.'
) ENGINE = ReplacingMergeTree(receipt_generation)
PRIMARY KEY (`organization_id`, `user_id`, `source`, `session_id`)
ORDER BY (`organization_id`, `user_id`, `source`, `session_id`)
SETTINGS index_granularity = 1024, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Request usage of a session summed per pricing group (date, model identity, provider, tier, speed, geography, context band), one row per session from its latest usage-event generation; priced against the rate card at read time.';
