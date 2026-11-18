CREATE TABLE IF NOT EXISTS rudel.mcp_tool_calls
(
  `organization_id` String COMMENT 'Workspace (organization id) the call ran in; empty when the workspace could not be resolved.',
  `user_id` String COMMENT 'Member who made the call.',
  `called_at` DateTime64(3, 'UTC') COMMENT 'UTC time the server received the call.',
  `call_id` String COMMENT 'Random id of the call, so identical calls stay distinct rows.',
  `tool` LowCardinality(String) COMMENT 'Tool name.',
  `context` String COMMENT 'Why the agent called the tool, in its own words (the context input, 15-25 words, no personal data); empty when not given.',
  `llm_model` LowCardinality(String) COMMENT 'Model id the agent reported (the llm_model input; unknown when it did not know); empty when not given.',
  `duration_ms` UInt32 COMMENT 'Milliseconds from receiving the call to its result.',
  `is_error` UInt8 COMMENT '1 when the call returned an error, else 0.',
  `error_code` LowCardinality(String) COMMENT 'The error\'s code (BAD_REQUEST, NOT_FOUND, FORBIDDEN, INTERNAL_SERVER_ERROR, ...); empty on success.',
  `output_chars` UInt32 COMMENT 'Characters of text the call returned to the agent.',
  `feedback` String COMMENT 'agent_feedback calls only: the feedback as JSON (summary, feedback_type, sentiment, category, ...); empty otherwise.'
) ENGINE = MergeTree
PARTITION BY toYYYYMM(called_at)
PRIMARY KEY (`tool`, `called_at`, `call_id`)
ORDER BY (`tool`, `called_at`, `call_id`)
TTL toDateTime(called_at) + toIntervalDay(365)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 's3'
COMMENT 'One row per call of a model-facing Opaline MCP tool: the tool, the purpose and model the agent stated, how long it took, whether it failed and how much it returned; agent_feedback calls also keep the feedback. Kept 365 days.';
