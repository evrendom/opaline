-- L1 run requests (docs/l1-literal-schema.md, "Scale"): one row per request
-- (one model response and the calls it made) of each run index build, with
-- its time, its calls and the usage on its lines. Written only by the
-- reconciliation worker, after the build's runs and before its run index
-- receipt, which commits both, and readers read only the committed build. Kept
-- until a deletion request, like the run index.

CREATE TABLE IF NOT EXISTS rudel.run_requests
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `revision` UInt64 COMMENT 'Raw transcript revision of the run index build\'s generation.',
  `parser_version` UInt16 COMMENT 'Transcript records parser version of the generation.',
  `index_version` UInt16 COMMENT 'Run index rules version of the build.',
  `build_revision` UInt64 COMMENT 'Run index build that wrote the request; the session\'s newest run index receipt names the build readers read.',
  `agent_id` String COMMENT 'Transcript stream; empty for the main stream.',
  `start_record` UInt32 COMMENT 'Raw record index of the request\'s first response record (assistant text, reasoning or tool call); stable across re-uploads, like run ids.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `run_id` String COMMENT 'Run node id of the run the request belongs to (run_index.run_id).',
  `run_start_record` UInt32 COMMENT 'start_record of the run the request belongs to.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream.',
  `built_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker wrote the row.',
  `session_date` DateTime64(3, 'UTC') COMMENT 'Session date of the generation.',
  `unrecorded_facts` Array(LowCardinality(String)) COMMENT 'Columns of this row whose values are unknown, not none: the usage columns when the session\'s usage extraction was incomplete.',
  `end_record` UInt32 COMMENT 'Start of the next request of the run, or the run\'s end_record: the request\'s lines are [start_record, end_record), and its usage is on them (the first request\'s from the run\'s start).',
  `started_at` DateTime64(3, 'UTC') COMMENT 'When the model was asked: the time of the run\'s last non-meta record before the request (the prompt or the previous request\'s last record).',
  `ended_at` DateTime64(3, 'UTC') COMMENT 'Time of the request\'s last non-meta record.',
  `call_records` Array(UInt32) COMMENT 'Raw record index of each tool call the request made, in record order.',
  `call_tools` Array(LowCardinality(String)) COMMENT 'Tool name of each call, in call_records order.',
  `call_groups` Array(LowCardinality(String)) COMMENT 'Tool group of each call (shell, edit, read, search, browser, web, mcp, subagent, other), in call_records order.',
  `call_classes` Array(LowCardinality(String)) COMMENT 'Command class the parser gave each shell call (test, build, lint, typecheck, git, migrate, install, other; empty for other tools), in call_records order.',
  `call_failed` Array(UInt8) COMMENT '1 when the call\'s result is an error or a non-zero exit code, in call_records order.',
  `text_record` Nullable(UInt32) COMMENT 'Raw record index of the request\'s last assistant text; NULL when the request wrote none.',
  `text_block` Nullable(UInt16) COMMENT 'Block of that assistant text within its record (a line can hold reasoning, then text); NULL when the request wrote none.',
  `text_head` Nullable(String) COMMENT 'First 160 characters of that assistant text; NULL when the request wrote none.',
  `usage_observations` UInt32 COMMENT 'Verified usage events of the session\'s usage extraction on the request\'s lines.',
  `usage_unpriced` UInt32 COMMENT 'Of usage_observations, events without a price.',
  `usage_model` LowCardinality(String) COMMENT 'Model of the request\'s latest usage event; empty without usage.',
  `cost_usd` Nullable(Float64) COMMENT 'Priced cost of usage_observations at the build\'s pricing; NULL when none is priced or the usage is unknown.',
  `uncached_input_tokens` Nullable(UInt64) COMMENT 'Uncached input tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.',
  `cache_read_input_tokens` Nullable(UInt64) COMMENT 'Cache read input tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.',
  `cache_write_5m_input_tokens` Nullable(UInt64) COMMENT 'Five-minute cache write input tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.',
  `cache_write_1h_input_tokens` Nullable(UInt64) COMMENT 'One-hour cache write input tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.',
  `output_tokens` Nullable(UInt64) COMMENT 'Output tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.',
  `reasoning_output_tokens` Nullable(UInt64) COMMENT 'Reasoning output tokens of the request\'s usage events; NULL without usage or when the session\'s usage is unknown.'
) ENGINE = ReplacingMergeTree(build_revision)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `index_version`, `build_revision`, `agent_id`, `start_record`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `index_version`, `build_revision`, `agent_id`, `start_record`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'L1 requests (one model response and its calls) of each run index build, committed by the build\'s run index receipt; written only by the reconciliation worker.';
