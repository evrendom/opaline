-- Transcript search (docs/retro-architecture.md, "Additions to the data stack"):
-- distinct chunks of transcript text per member and month, after the secret filter, with
-- 512-dimension text-embedding-3-small vectors quantized to 8 bits, and a hit
-- for every place a chunk appeared, naming its run. Written at upload only;
-- both tables are deleted with the account and the workspace. text gets
-- CODEC(ZSTD(3)) by hand, as transcript_records.text does.

CREATE TABLE IF NOT EXISTS rudel.transcript_chunk_hits
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `agent_id` String COMMENT 'Transcript stream; empty for the main stream and the receipt.',
  `record_idx` UInt32 COMMENT 'Transcript record of the hit; 4294967295 for the session''s receipt.',
  `block_idx` UInt16 COMMENT 'Content block of the record.',
  `chunk_idx` UInt16 COMMENT 'Place of the chunk in the block''s text, from 0.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream; zero for the receipt.',
  `kind` LowCardinality(String) COMMENT 'Record kind of the hit: user_prompt, assistant_text, reasoning, tool_call, tool_result or file_change; receipt for the receipt.',
  `tool_name` LowCardinality(String) COMMENT 'Tool of a tool call or result; empty otherwise.',
  `ts` DateTime64(3, 'UTC') COMMENT 'UTC time of the record.',
  `chunk_hash` String COMMENT 'The chunk (transcript_chunks.chunk_hash of the same member); empty for the receipt.',
  `revision` UInt64 COMMENT 'Raw transcript revision of the transcript records generation the hits were cut from.',
  `parser_version` UInt16 COMMENT 'Transcript records parser version of that generation.',
  `pending_chunks` UInt32 COMMENT 'Receipt only: chunks of the generation still without a vector (over the workspace''s OpenAI quota or out of time); 0 when all are embedded.',
  `truncated_records` UInt32 COMMENT 'Receipt only: records searched by their kept prefix and tail only, because transcript records did not keep their middle.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'Replacing version: UTC time the row was written, so a later pass over the same generation wins (its receipt counts fewer pending chunks).',
  INDEX `ts_minmax` (ts) TYPE minmax GRANULARITY 1
) ENGINE = ReplacingMergeTree(written_at)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`, `chunk_idx`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`, `chunk_idx`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Where each transcript chunk appeared, by run and transcript records generation; a receipt row closes each generation.';

CREATE TABLE IF NOT EXISTS rudel.transcript_chunks
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Member whose sessions hold the chunk; chunks are stored once per member and month.',
  `month` Date COMMENT 'First day (UTC) of a month the chunk appeared in; a chunk seen in several months has a row for each, with the same vector.',
  `chunk_hash` String COMMENT 'First 128 bits of the SHA-256 of the chunk text, as hex: the chunk''s identity within the member''s sessions.',
  `text` String COMMENT 'Chunk text after the secret filter, at most 1,200 characters, cut at a line end where possible.' CODEC(ZSTD(3)),
  `embedding` Array(Int8) COMMENT 'text-embedding-3-small vector at 512 dimensions, scaled so its largest component is ±127 (cosine does not depend on the scale); empty while not embedded.',
  `model` LowCardinality(String) COMMENT 'Model and dimensions of the vector, e.g. text-embedding-3-small@512; empty while not embedded.',
  `embedded_at` DateTime64(3, 'UTC') COMMENT 'Replacing version: UTC time the vector was written, or 1970-01-01 for a chunk stored without one, so an embedded row replaces it.'
) ENGINE = ReplacingMergeTree(embedded_at)
PRIMARY KEY (`organization_id`, `user_id`, `month`, `chunk_hash`)
ORDER BY (`organization_id`, `user_id`, `month`, `chunk_hash`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Distinct chunks of transcript text per member and month with their 8-bit vectors, for search by meaning and exact string.';
