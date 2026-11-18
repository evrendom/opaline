ALTER TABLE rudel.usage_events
    ADD COLUMN IF NOT EXISTS recorded_cache_write_5m_input_tokens Nullable(UInt64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS recorded_cache_write_1h_input_tokens Nullable(UInt64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS cache_write_input_tokens Nullable(UInt64) DEFAULT NULL;

ALTER TABLE rudel.run_index
    ADD COLUMN IF NOT EXISTS failed_edits Nullable(UInt32) COMMENT 'Failed edit requests, excluding refusals; parser 9 or newer.',
    ADD COLUMN IF NOT EXISTS refused_edits Nullable(UInt32) COMMENT 'Refused native edit requests, including user declines but excluding interruptions; parser 9 or newer.';
