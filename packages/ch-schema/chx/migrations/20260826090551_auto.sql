-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:05:51.426Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 14
-- rename-suggestion-count: 0
-- risk-summary: safe=4, caution=7, danger=3

-- Snapshot every active source part before any propagation wait. The old
-- ReplacingMergeTree version columns can tie and then fall back to insertion
-- order during a background merge. Plain MergeTree clones preserve every row
-- until the backfill can apply a total, content-derived ordering.
CREATE TABLE rudel.claude_sessions_f16_backfill_source_20260826
CLONE AS rudel.claude_sessions
ENGINE = MergeTree;

CREATE TABLE rudel.codex_sessions_f16_backfill_source_20260826
CLONE AS rudel.codex_sessions
ENGINE = MergeTree;

CREATE TABLE rudel.session_analytics_f16_backfill_source_20260826
CLONE AS rudel.session_analytics
ENGINE = MergeTree;

CREATE TABLE rudel.session_language_signals_f16_backfill_source_20260826
CLONE AS rudel.session_language_signals
ENGINE = MergeTree;

-- operation: drop_materialized_view key=materialized_view:rudel.codex_session_analytics_mv risk=caution
DROP TABLE IF EXISTS rudel.codex_session_analytics_mv SYNC;

-- operation: drop_materialized_view key=materialized_view:rudel.session_analytics_mv risk=caution
DROP TABLE IF EXISTS rudel.session_analytics_mv SYNC;

SELECT sleepEachRow(1) FROM numbers(8) SETTINGS max_block_size = 1;

-- operation: drop_table key=table:rudel.claude_sessions risk=danger
-- Preserve the pre-F16 tables for verified backfill and owner-controlled rollback.
RENAME TABLE
	rudel.claude_sessions TO rudel.claude_sessions_f16_backup_20260826,
	rudel.codex_sessions TO rudel.codex_sessions_f16_backup_20260826,
	rudel.session_analytics TO rudel.session_analytics_f16_backup_20260826,
	rudel.session_language_signals TO rudel.session_language_signals_f16_backup_20260826;

-- operation: alter_table_modify_column key=table:rudel.skill_receipts:column:extraction_seq risk=caution
ALTER TABLE rudel.skill_receipts MODIFY COLUMN `extraction_seq` UInt128;

-- operation: alter_table_modify_column key=table:rudel.skill_uses:column:extraction_seq risk=caution
ALTER TABLE rudel.skill_uses MODIFY COLUMN `extraction_seq` UInt128;

-- operation: alter_table_modify_column key=table:rudel.skill_version_contents:column:extraction_seq risk=caution
ALTER TABLE rudel.skill_version_contents MODIFY COLUMN `extraction_seq` UInt128;

-- operation: create_table key=table:rudel.claude_sessions risk=safe
CREATE TABLE IF NOT EXISTS rudel.claude_sessions
(
  `session_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `last_interaction_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `session_id` String,
  `organization_id` String,
  `project_path` String,
  `git_remote` String DEFAULT '''''',
  `package_name` String DEFAULT '''''',
  `package_type` String DEFAULT '''''',
  `content` String,
  `filter_version` UInt8 DEFAULT 0,
  `revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16),
  `ingested_at` DateTime64(3, 'UTC') DEFAULT now64(3),
  `user_id` String,
  `git_branch` Nullable(String),
  `git_sha` Nullable(String),
  `tag` Nullable(String),
  `subagents` Map(String, String) DEFAULT map()
) ENGINE = ReplacingMergeTree(revision)
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`)
ORDER BY (`organization_id`, `session_date`, `session_id`)
TTL toDate(session_date) + toIntervalDay(365)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3';

-- operation: create_table key=table:rudel.codex_sessions risk=safe
CREATE TABLE IF NOT EXISTS rudel.codex_sessions
(
  `session_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `last_interaction_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `session_id` String,
  `organization_id` String,
  `project_path` String,
  `git_remote` String DEFAULT '''''',
  `package_name` String DEFAULT '''''',
  `package_type` String DEFAULT '''''',
  `content` String,
  `filter_version` UInt8 DEFAULT 0,
  `revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16),
  `ingested_at` DateTime64(3, 'UTC') DEFAULT now64(3),
  `user_id` String,
  `git_branch` Nullable(String),
  `git_sha` Nullable(String),
  `tag` Nullable(String)
) ENGINE = ReplacingMergeTree(revision)
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`)
ORDER BY (`organization_id`, `session_date`, `session_id`)
TTL toDate(session_date) + toIntervalDay(365)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3';

-- operation: create_table key=table:rudel.session_analytics risk=safe
CREATE TABLE IF NOT EXISTS rudel.session_analytics
(
  `session_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `last_interaction_date` DateTime64(3, 'UTC') DEFAULT now64(3),
  `session_id` String,
  `organization_id` String,
  `project_path` String,
  `git_remote` String DEFAULT '''''',
  `package_name` String DEFAULT '''''',
  `package_type` String DEFAULT '''''',
  `filter_version` UInt8 DEFAULT 0,
  `revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16),
  `ingested_at` DateTime64(3, 'UTC') DEFAULT now64(3),
  `user_id` String,
  `git_branch` Nullable(String),
  `git_sha` Nullable(String),
  `tag` Nullable(String),
  `source` LowCardinality(String) DEFAULT '''claude_code''',
  `skills` Array(String) DEFAULT [],
  `slash_commands` Array(String) DEFAULT [],
  `subagent_types` Array(String) DEFAULT [],
  `input_tokens` UInt64 DEFAULT 0,
  `output_tokens` UInt64 DEFAULT 0,
  `cache_read_input_tokens` UInt64 DEFAULT 0,
  `cache_creation_input_tokens` UInt64 DEFAULT 0,
  `total_tokens` UInt64 DEFAULT 0,
  `total_interactions` UInt32 DEFAULT 0,
  `actual_duration_min` UInt32 DEFAULT 0,
  `avg_period_sec` Float64 DEFAULT 0,
  `median_period_sec` Float64 DEFAULT 0,
  `quick_responses` UInt32 DEFAULT 0,
  `normal_responses` UInt32 DEFAULT 0,
  `long_pauses` UInt32 DEFAULT 0,
  `error_count` UInt32 DEFAULT 0,
  `error_pattern` LowCardinality(String) DEFAULT '''''',
  `model_used` String DEFAULT '''''',
  `has_commit` UInt8 DEFAULT 0,
  `session_archetype` String DEFAULT '''standard''',
  `success_score` UInt8 DEFAULT 0,
  `used_plan_mode` UInt8 DEFAULT 0,
  `inference_duration_sec` UInt32 DEFAULT 0,
  `human_duration_sec` UInt32 DEFAULT 0
) ENGINE = ReplacingMergeTree(revision)
PRIMARY KEY (`source`, `organization_id`, `user_id`, `session_id`)
ORDER BY (`source`, `organization_id`, `user_id`, `session_id`)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3';

-- operation: create_table key=table:rudel.session_language_signals risk=safe
CREATE TABLE IF NOT EXISTS rudel.session_language_signals
(
  `organization_id` String,
  `session_date` DateTime64(3, 'UTC'),
  `session_id` String,
  `user_id` String,
  `source` LowCardinality(String),
  `raw_revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(raw_ingested_at)), 16),
  `raw_ingested_at` DateTime64(3, 'UTC'),
  `scan_version` UInt16,
  `member_swears` UInt32,
  `member_apologies` UInt32,
  `member_positive` UInt32,
  `model_swears` UInt32,
  `model_apologies` UInt32,
  `model_positive` UInt32,
  `scanned_at` DateTime64(3, 'UTC'),
  `signal_version` UInt128 DEFAULT bitShiftLeft(toUInt128(raw_revision), 64) + bitShiftLeft(toUInt128(toUnixTimestamp64Milli(scanned_at)), 16) + toUInt128(scan_version)
) ENGINE = ReplacingMergeTree(signal_version)
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`, `source`)
ORDER BY (`organization_id`, `session_date`, `session_id`, `source`)
TTL toDate(session_date) + toIntervalDay(365)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3';

-- ClickHouse Cloud can lag table visibility after destructive DDL. Keep the
-- repository-required propagation wait inside the manually applied migration.
SELECT sleepEachRow(1) FROM numbers(8) SETTINGS max_block_size = 1;

-- operation: create_materialized_view key=materialized_view:rudel.codex_session_analytics_mv risk=caution
CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.codex_session_analytics_mv TO rudel.session_analytics AS
SELECT * EXCEPT (_dedupe_rank) FROM ( WITH ( length(cs.content) > 120000000 OR countSubstrings(cs.content, '\n') > 8000 ) AS _is_capped, if(_is_capped, '', cs.content) AS _line_safe_content, substring(cs.content, 1, 20000000) AS _error_sample_content, arrayFilter( x -> x != '', splitByChar('\n', _line_safe_content) ) AS _all_lines, arrayFilter(x -> JSONHas(x, 'timestamp'), _all_lines) AS _ts_lines, arrayMap( x -> parseDateTime64BestEffort(JSONExtractString(x, 'timestamp')), _ts_lines ) AS _timestamps, if(length(_timestamps) > 1, arrayMap(i -> dateDiff('second', _timestamps[i], _timestamps[i+1]), range(1, length(_timestamps))), [] ) AS _prompt_periods_sec, if(length(_timestamps) > 1, arrayMap(i -> if(i < length(_timestamps), dateDiff('second', _timestamps[i], _timestamps[i+1]), 0), range(1, length(_timestamps))), [] ) AS _inference_gaps, arrayFilter( x -> JSONExtractString(x, 'type') = 'response_item' OR JSONExtractString(x, 'type') = 'event_msg', _all_lines ) AS _interaction_lines, arrayFilter( x -> JSONExtractString(x, 'type') = 'response_item' AND JSONExtractString(JSONExtractRaw(x, 'payload'), 'type') = 'function_call_output', _all_lines ) AS _tool_output_lines, arrayFilter( x -> JSONExtractString(x, 'type') = 'event_msg' AND JSONExtractString(JSONExtractRaw(x, 'payload'), 'type') = 'token_count' AND JSONExtractRaw(JSONExtractRaw(x, 'payload'), 'info') IS NOT NULL AND JSONExtractRaw(JSONExtractRaw(x, 'payload'), 'info') != 'null', _all_lines ) AS _token_count_lines, if(length(_token_count_lines) > 0, JSONExtractRaw(JSONExtractRaw(JSONExtractRaw(arrayElement(_token_count_lines, -1), 'payload'), 'info'), 'total_token_usage'), '{}' ) AS _final_usage, toUInt64OrZero(JSONExtractRaw(_final_usage, 'input_tokens')) AS _input_tokens, toUInt64OrZero(JSONExtractRaw(_final_usage, 'output_tokens')) AS _output_tokens, toUInt64OrZero(JSONExtractRaw(_final_usage, 'cached_input_tokens')) AS _cache_read_input_tokens, if(_is_capped, cs.session_date, arrayMin(_timestamps)) AS _session_date, if(_is_capped, cs.last_interaction_date, arrayMax(_timestamps)) AS _last_interaction_date, dateDiff('minute', _session_date, _last_interaction_date) AS _duration_min, arrayFilter(x -> JSONExtractString(x, 'type') = 'session_meta', _all_lines) AS _meta_lines, JSONExtractString( JSONExtractRaw(arrayElement(_meta_lines, 1), 'payload'), 'model_provider' ) AS _model_provider, arrayFilter( x -> JSONExtractString(x, 'type') = 'turn_context', _all_lines ) AS _turn_context_lines, if(length(_turn_context_lines) > 0, JSONExtractString(JSONExtractRaw(arrayElement(_turn_context_lines, 1), 'payload'), 'model'), '' ) AS _model_from_turn_context, arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"exec_command"[^}]*skills/([a-zA-Z0-9_-]+)/SKILL'))) AS _skills, toUInt32( length(extractAll(_error_sample_content, '\\\\"exit_code\\\\":[1-9][0-9]*')) + if( _is_capped, length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):')) + length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):')), arrayCount( x -> x ILIKE '%Error:%' OR x ILIKE '%Exception:%', _tool_output_lines ) ) ) AS _error_count SELECT * EXCEPT (session_date, last_interaction_date, content), _session_date as session_date, _last_interaction_date as last_interaction_date, 'codex' as source, _input_tokens as input_tokens, _output_tokens as output_tokens, _cache_read_input_tokens as cache_read_input_tokens, toUInt64(0) as cache_creation_input_tokens, _input_tokens + _output_tokens as total_tokens, _skills as skills, [] :: Array(String) as slash_commands, [] :: Array(String) as subagent_types, toUInt32(length(_interaction_lines)) as total_interactions, toUInt32(_duration_min) as actual_duration_min, if(length(_prompt_periods_sec) > 0, round(arrayAvg(_prompt_periods_sec), 2), 0) as avg_period_sec, if( length(_prompt_periods_sec) > 0, toFloat64(arrayElement( arraySort(_prompt_periods_sec), toUInt64(ceil(length(_prompt_periods_sec) / 2)) )), 0 ) as median_period_sec, toUInt32(arrayCount(x -> x < 5, _prompt_periods_sec)) as quick_responses, toUInt32(arrayCount(x -> x >= 5 AND x <= 60, _prompt_periods_sec)) as normal_responses, toUInt32(arrayCount(x -> x > 300, _prompt_periods_sec)) as long_pauses, _error_count as error_count, if( _error_count = 0, '', multiIf( _error_sample_content ILIKE '%OperationFailed%', 'OperationFailed', _error_sample_content ILIKE '%UnknownError%', 'UnknownError', _error_sample_content ILIKE '%ORPCError%', 'ORPCError', _error_sample_content ILIKE '%TimeoutError%', 'TimeoutError', _error_sample_content ILIKE '%TypeError%', 'TypeError', _error_sample_content ILIKE '%ReferenceError%', 'ReferenceError', _error_sample_content ILIKE '%Error:%', if( length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):')) > 0, arrayElement(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):'), 1), 'GenericError' ), _error_sample_content ILIKE '%Exception:%', if( length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):')) > 0, arrayElement(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):'), 1), 'Exception' ), _error_sample_content ILIKE '%error:%', 'GenericError', _error_sample_content ILIKE '%failed%', 'OperationFailed', _error_sample_content ILIKE '%timeout%', 'Timeout', _error_sample_content ILIKE '%not found%', 'NotFound', 'UnknownError' ) ) as error_pattern, multiIf( _model_from_turn_context != '', _model_from_turn_context, _model_provider != '', _model_provider, 'unknown' ) as model_used, toUInt8(if(cs.git_sha IS NOT NULL AND cs.git_sha != '', 1, 0)) as has_commit, toUInt8(0) as used_plan_mode, toUInt32(arraySum(_inference_gaps)) as inference_duration_sec, toUInt32(0) as human_duration_sec, CASE WHEN _duration_min <= 10 AND (_input_tokens + _output_tokens) < 500000 AND _output_tokens > 1000 THEN 'quick_win' WHEN _duration_min > 30 AND _output_tokens > 50000 AND cs.git_sha IS NOT NULL AND cs.git_sha != '' THEN 'deep_work' WHEN (_input_tokens + _output_tokens) > 1000000 AND (_output_tokens / nullif(_input_tokens, 0)) < 0.3 AND _duration_min > 20 THEN 'struggle' WHEN length(_skills) >= 3 AND (cs.git_sha IS NULL OR cs.git_sha = '') AND (_input_tokens + _output_tokens) > 200000 THEN 'exploration' WHEN _duration_min < 3 AND _output_tokens < 500 THEN 'abandoned' ELSE 'standard' END as session_archetype, toUInt8( greatest( toFloat64(0), least( toFloat64(100), round( toFloat64(50) + if(cs.git_sha IS NOT NULL AND cs.git_sha != '', 20, 0) + if((_output_tokens / nullif(_input_tokens, 0)) > 0.5, 15, 0) + (least(toUInt32(length(_skills)), 3) * 5) - if( (_input_tokens + _output_tokens) > 1500000 AND (cs.git_sha IS NULL OR cs.git_sha = ''), 20, 0 ) - if(_duration_min < 2 AND _output_tokens < 200, 30, 0) - (least(_error_count, toUInt32(10)) * 2) ) ) ) ) as success_score, ROW_NUMBER() OVER ( PARTITION BY cs.organization_id, cs.user_id, cs.session_id ORDER BY cs.revision DESC ) AS _dedupe_rank FROM rudel.codex_sessions AS cs WHERE _is_capped OR length(_timestamps) > 0 ) WHERE _dedupe_rank = 1;

-- operation: create_materialized_view key=materialized_view:rudel.session_analytics_mv risk=caution
CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.session_analytics_mv TO rudel.session_analytics AS
SELECT * EXCEPT (_dedupe_rank) FROM ( WITH ( length(cs.content) > 120000000 OR countSubstrings(cs.content, '\n') > 8000 ) AS _is_capped, if(_is_capped, '', cs.content) AS _line_safe_content, substring(cs.content, 1, 20000000) AS _error_sample_content, arrayFilter( x -> JSONExtractString(x, 'type') IN ('user', 'assistant'), splitByChar('\n', _line_safe_content) ) AS _interaction_lines, arrayFilter(x -> JSONHas(x, 'timestamp'), _interaction_lines) AS _ts_lines, arrayMap( x -> parseDateTime64BestEffort(JSONExtractString(x, 'timestamp')), _ts_lines ) AS _timestamps, arrayMap( x -> JSONExtractString(x, 'type'), _ts_lines ) AS _msg_types, if(length(_timestamps) > 1, arrayMap(i -> dateDiff('second', _timestamps[i], _timestamps[i+1]), range(1, length(_timestamps))), [] ) AS _prompt_periods_sec, if(length(_timestamps) > 1, arrayMap(i -> if(_msg_types[i] = 'user' AND _msg_types[i+1] = 'assistant', dateDiff('second', _timestamps[i], _timestamps[i+1]), 0), range(1, length(_timestamps))), [] ) AS _inference_gaps, if(length(_timestamps) > 1, arrayMap(i -> if(_msg_types[i] = 'assistant' AND _msg_types[i+1] = 'user', dateDiff('second', _timestamps[i], _timestamps[i+1]), 0), range(1, length(_timestamps))), [] ) AS _human_gaps, arrayFilter( x -> JSONExtractString(x, 'type') = 'assistant' AND JSONHas(x, 'message'), splitByChar('\n', _line_safe_content) ) AS _assistant_lines, arrayMap( x -> JSONExtractString(JSONExtractRaw(x, 'message'), 'id'), _assistant_lines ) AS _assistant_ids, arrayFilter( (x, i) -> i = length(_assistant_ids) OR _assistant_ids[i] != _assistant_ids[i + 1], _assistant_lines, arrayEnumerate(_assistant_lines) ) AS _deduped_assistant_lines, arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'input_tokens')) + toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_read_input_tokens')) + toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_creation_input_tokens')), _deduped_assistant_lines)) AS _input_tokens, arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'output_tokens')), _deduped_assistant_lines)) AS _output_tokens, arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_read_input_tokens')), _deduped_assistant_lines)) AS _cache_read, arraySum(arrayMap(x -> toUInt64OrZero(JSONExtractRaw(JSONExtractRaw(x, 'message'), 'usage', 'cache_creation_input_tokens')), _deduped_assistant_lines)) AS _cache_creation, arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"Skill"[^}]*"skill":"([^"]+)"'))) AS _skills, arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '"name":"Task"[^}]*"subagent_type":"([^"]+)"'))) AS _subagent_types, arrayDistinct(arrayFilter(x -> x != '', extractAll(cs.content, '<command-name>/([^<]+)</command-name>'))) AS _slash_commands, toUInt32( length(extractAll(_error_sample_content, '"isApiErrorMessage":true')) + length(extractAll(_error_sample_content, '"is_error":true')) ) AS _error_count, if(_is_capped, cs.session_date, arrayMin(_timestamps)) AS _session_date, if(_is_capped, cs.last_interaction_date, arrayMax(_timestamps)) AS _last_interaction_date, dateDiff('minute', _session_date, _last_interaction_date) AS _duration_min SELECT * EXCEPT (session_date, last_interaction_date, content, subagents), _session_date as session_date, _last_interaction_date as last_interaction_date, 'claude_code' as source, _input_tokens as input_tokens, _output_tokens as output_tokens, _cache_read as cache_read_input_tokens, _cache_creation as cache_creation_input_tokens, _input_tokens + _output_tokens as total_tokens, _skills as skills, _slash_commands as slash_commands, _subagent_types as subagent_types, toUInt32(length(_timestamps)) as total_interactions, toUInt32(_duration_min) as actual_duration_min, if(length(_prompt_periods_sec) > 0, round(arrayAvg(_prompt_periods_sec), 2), 0) as avg_period_sec, if( length(_prompt_periods_sec) > 0, toFloat64(arrayElement( arraySort(_prompt_periods_sec), toUInt64(ceil(length(_prompt_periods_sec) / 2)) )), 0 ) as median_period_sec, toUInt32(arrayCount(x -> x < 5, _prompt_periods_sec)) as quick_responses, toUInt32(arrayCount(x -> x >= 5 AND x <= 60, _prompt_periods_sec)) as normal_responses, toUInt32(arrayCount(x -> x > 300, _prompt_periods_sec)) as long_pauses, _error_count as error_count, if( _error_count = 0, '', multiIf( _error_sample_content ILIKE '%OperationFailed%', 'OperationFailed', _error_sample_content ILIKE '%UnknownError%', 'UnknownError', _error_sample_content ILIKE '%ORPCError%', 'ORPCError', _error_sample_content ILIKE '%TimeoutError%', 'TimeoutError', _error_sample_content ILIKE '%TypeError%', 'TypeError', _error_sample_content ILIKE '%ReferenceError%', 'ReferenceError', _error_sample_content ILIKE '%Error:%', if( length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):')) > 0, arrayElement(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Error):'), 1), 'GenericError' ), _error_sample_content ILIKE '%Exception:%', if( length(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):')) > 0, arrayElement(extractAll(_error_sample_content, '([A-Z][a-zA-Z]+Exception):'), 1), 'Exception' ), _error_sample_content ILIKE '%error:%', 'GenericError', _error_sample_content ILIKE '%failed%', 'OperationFailed', _error_sample_content ILIKE '%timeout%', 'Timeout', _error_sample_content ILIKE '%not found%', 'NotFound', 'UnknownError' ) ) as error_pattern, if( _is_capped, '', JSONExtractString( JSONExtractRaw( arrayElement( arrayFilter( x -> JSONExtractString(x, 'type') = 'assistant', splitByChar('\n', _line_safe_content) ), -1 ), 'message' ), 'model' ) ) as model_used, toUInt8(if(cs.git_sha IS NOT NULL AND cs.git_sha != '', 1, 0)) as has_commit, toUInt8(if(position(cs.content, '"name":"EnterPlanMode"') > 0, 1, 0)) as used_plan_mode, toUInt32(arraySum(_inference_gaps)) as inference_duration_sec, toUInt32(arraySum(_human_gaps)) as human_duration_sec, CASE WHEN _duration_min <= 10 AND (_input_tokens + _output_tokens) < 500000 AND _output_tokens > 1000 THEN 'quick_win' WHEN _duration_min > 30 AND _output_tokens > 50000 AND cs.git_sha IS NOT NULL AND cs.git_sha != '' THEN 'deep_work' WHEN (_input_tokens + _output_tokens) > 1000000 AND (_output_tokens / nullif(_input_tokens, 0)) < 0.3 AND _duration_min > 20 THEN 'struggle' WHEN length(_skills) >= 3 AND (cs.git_sha IS NULL OR cs.git_sha = '') AND (_input_tokens + _output_tokens) > 200000 THEN 'exploration' WHEN _duration_min < 3 AND _output_tokens < 500 THEN 'abandoned' ELSE 'standard' END as session_archetype, toUInt8( greatest( toFloat64(0), least( toFloat64(100), round( toFloat64(50) + if(cs.git_sha IS NOT NULL AND cs.git_sha != '', 20, 0) + if((_output_tokens / nullif(_input_tokens, 0)) > 0.5, 15, 0) + (least(toUInt32(length(_skills)), 3) * 5) - if( (_input_tokens + _output_tokens) > 1500000 AND (cs.git_sha IS NULL OR cs.git_sha = ''), 20, 0 ) - if(_duration_min < 2 AND _output_tokens < 200, 30, 0) - (least(_error_count, toUInt32(10)) * 2) ) ) ) ) as success_score, ROW_NUMBER() OVER ( PARTITION BY cs.organization_id, cs.user_id, cs.session_id ORDER BY cs.revision DESC ) AS _dedupe_rank FROM rudel.claude_sessions AS cs WHERE _is_capped OR length(_timestamps) > 0 ) WHERE _dedupe_rank = 1;

SELECT sleepEachRow(1) FROM numbers(8) SETTINGS max_block_size = 1;
