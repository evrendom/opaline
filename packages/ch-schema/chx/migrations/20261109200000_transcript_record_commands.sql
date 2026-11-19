CREATE TABLE IF NOT EXISTS rudel.transcript_record_commands
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `revision` UInt64 COMMENT 'Raw transcript revision of the record\'s generation.',
  `parser_version` UInt16 COMMENT 'Transcript records parser version of the generation.',
  `agent_id` String COMMENT 'Transcript stream; empty for the main stream.',
  `record_idx` UInt32 COMMENT 'Record index as in transcript_records; the receipt record index marks a complete generation.',
  `block_idx` UInt16 COMMENT 'Block of that record.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `session_date` DateTime64(3, 'UTC') COMMENT 'Session date of the generation.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream, as in transcript_records.',
  `ts` DateTime64(3, 'UTC') COMMENT 'Timestamp of the record.',
  `tool_name` LowCardinality(String) COMMENT 'Tool the record names, as recorded.',
  `file_path` String COMMENT 'File the record names, as in transcript_records.',
  `call_id` String COMMENT 'The call\'s id within its stream.',
  `head` String COMMENT 'The record\'s stored head, as in transcript_records.',
  `command_from` LowCardinality(String) COMMENT 'command, script or written; empty only on the receipt row.',
  `command_text` Nullable(String) COMMENT 'The command or script text; NULL when transcript_records stores only part of it.' CODEC(ZSTD(3)),
  `command_argv0` Nullable(String) COMMENT 'The program a shell command runs; NULL for scripts.',
  `command_prefix` Nullable(String) COMMENT 'The program and its subcommand; NULL for scripts.',
  `command_normalized` Nullable(String) COMMENT 'The normalized text the fingerprint and simhash hash; NULL without command_text.' CODEC(ZSTD(3)),
  `command_fingerprint` Nullable(UInt64) COMMENT 'cityHash64 of command_normalized.',
  `command_simhash` Nullable(UInt64) COMMENT 'Word-shingle simhash of command_normalized; NULL under 20 words.',
  `built_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the row was computed; the replacing version.'
) ENGINE = ReplacingMergeTree(built_at)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`)
TTL toDate(session_date) + toIntervalDay(365)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Command identity of each transcript record that carries a command (a shell call, a Codex code-mode script, a written script file), computed once per transcript generation with the same expressions find source=calls used per query; a row at the receipt record index marks a generation as complete.';
