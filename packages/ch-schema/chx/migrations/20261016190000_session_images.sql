-- Images of a session: the screenshots and pasted images its transcript
-- carried. Transcripts keep only a marker where an image was
-- (opaline-image-omitted:v1;sha256=<hex>;bytes=<n>;type=<media type>); the CLI
-- uploads the bytes with the session's evidence captures as image objects
-- (sha256:<hex>, stored once per workspace) and lists every image with the
-- records that carry it in the manifest. The evidence commit stages one row per
-- image and record in Postgres, and the evidence index publisher writes them
-- here. A row that knows the image was captured is never replaced by one that
-- only knows it was skipped or not uploaded (version). Kept until a deletion
-- request and purged with the account and the workspace. Applied by
-- scripts/migrate-session-images.ts.

CREATE TABLE IF NOT EXISTS rudel.session_images
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `session_source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `sha256` String COMMENT 'SHA-256 (hex) of the decoded image bytes, as the transcript marker names it; the evidence object is sha256:<sha256>.',
  `agent_id` String COMMENT 'Transcript stream of the record that carries the image; empty for the main stream or no record.',
  `record_idx` UInt32 COMMENT '1-based JSONL line of that record in its stream; 0 for an image the capture lists without a record.',
  `media_type` LowCardinality(String) COMMENT 'Image media type (image/png, image/jpeg, ...); the uploaded object\'s when captured.',
  `bytes` UInt64 COMMENT 'Decoded image size in bytes; the uploaded object\'s when captured.',
  `image_source` LowCardinality(String) COMMENT 'inline (base64 in the transcript record) or file (an image file the record names); empty without a record.',
  `root_id` LowCardinality(String) COMMENT 'Capture root of a file image; empty otherwise.',
  `path` String COMMENT 'Path of a file image, as the CLI names it; empty otherwise.',
  `status` LowCardinality(String) COMMENT 'captured (the capture uploaded the image or found it stored), skipped (the CLI did not upload it: skipped_reason) or not_uploaded (named, not part of the capture\'s upload).',
  `skipped_reason` LowCardinality(String) COMMENT 'Why the CLI skipped the image (its reason, e.g. too-large, unreadable); empty otherwise.',
  `capture_id` String COMMENT 'Evidence capture (context id) that wrote the row.',
  `captured_at` DateTime64(3, 'UTC') COMMENT 'When that capture completed on the member\'s machine.',
  `version` UInt64 COMMENT 'Replacing version: rank (3 captured, 2 skipped, 1 not_uploaded) * 2^48 + captured_at in ms, so a later capture replaces an earlier one unless it knows less.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the API accepted the capture and staged the row.'
) ENGINE = ReplacingMergeTree(version)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `session_source`, `sha256`, `agent_id`, `record_idx`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `session_source`, `sha256`, `agent_id`, `record_idx`)
SETTINGS index_granularity = 1024, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Images of a session (screenshots, pasted images) as its evidence captures listed them: one row per session, image and transcript record, the most knowing capture\'s; the bytes are the evidence object sha256:<sha256>.';
