-- Gap A1: saved outputs of a session. The CLI uploads the files Claude Code
-- saves next to a session with the session's evidence captures: background task
-- outputs (root claude-task-outputs) and tool outputs too large for the
-- transcript (root claude-tool-results), with the transcript records that name
-- them and the task ids it names whose output was not on disk. The evidence
-- commit stages one row per file (and per missing task id) in Postgres, and the
-- evidence index publisher writes them here. One row per session and file, the
-- latest capture's; a row with content is never replaced by one without
-- (version). Kept until a deletion request and purged with the account and the
-- workspace. Applied by scripts/migrate-session-saved-outputs.ts.

CREATE TABLE IF NOT EXISTS rudel.session_saved_outputs
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `session_id` String COMMENT 'Native session ID within organization and user.',
  `session_source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `root_id` LowCardinality(String) COMMENT 'Capture root of the file: claude-task-outputs (the session\'s tasks directory) or claude-tool-results (its tool-results directory).',
  `path` String COMMENT 'Path relative to the root: <task id>.output or rerooted/<task id>.output for a task output, the file name for a tool output.',
  `kind` LowCardinality(String) COMMENT 'task_output (a background Bash, Monitor or agent task) or tool_result (a tool output too large for the transcript).',
  `task_id` String COMMENT 'Claude Code\'s background task id (L1 facts[\'task_id\']); empty for a tool output.',
  `tool_use_id` String COMMENT 'Tool call that started the task or produced the tool output, as the transcript names it; empty when unknown.',
  `agent_id` String COMMENT 'Transcript stream of the referencing record; empty for the main stream or no reference.',
  `record_idx` UInt32 COMMENT '1-based JSONL line of the referencing record in its stream (the starting call\'s result when known); 0 without a reference.',
  `entry_kind` LowCardinality(String) COMMENT 'What was on disk: file, symlink (an async agent\'s output, a link to its subagent transcript; never read) or empty for missing.',
  `status` LowCardinality(String) COMMENT 'captured (whole file), truncated (its tail), reused (content sent with an earlier capture, blob_capture_id), omitted (file seen, content not kept: omitted_reason), symlink, or missing (named by the transcript, not on disk at capture time).',
  `omitted_reason` LowCardinality(String) COMMENT 'Why an omitted file\'s content was not kept (the CLI\'s reason, e.g. file-content-cap, binary); empty otherwise.',
  `blob_object_id` String COMMENT 'Evidence object (sha256:<hex>) holding the secret-filtered text; empty without content.',
  `blob_capture_id` String COMMENT 'Capture whose upload carried the blob: this capture, or the earlier one of a reused blob.',
  `source_bytes` UInt64 COMMENT 'Bytes of the file that the stored text was made from.',
  `stored_bytes` UInt64 COMMENT 'Bytes of the stored, secret-filtered text.',
  `original_bytes` UInt64 COMMENT 'Size of the whole file when only its tail was kept (truncated); 0 otherwise.',
  `truncated` Bool COMMENT 'Whether the stored text is only the end of a longer file.',
  `file_modified_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'Modification time of the file at capture time; NULL when missing.',
  `capture_id` String COMMENT 'Evidence capture (context id) that wrote the row.',
  `captured_at` DateTime64(3, 'UTC') COMMENT 'When that capture completed on the member\'s machine.',
  `capture_reason` LowCardinality(String) COMMENT 'Empty for a capture at the session\'s own time; task-output-sweep for a later one-time capture of the session\'s saved outputs.',
  `version` UInt64 COMMENT 'Replacing version: rank (3 with content or a symlink, 2 omitted, 1 missing) * 2^48 + captured_at in ms, so a later capture replaces an earlier one unless it knows less.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the API accepted the capture and staged the row.'
) ENGINE = ReplacingMergeTree(version)
PRIMARY KEY (`organization_id`, `user_id`, `session_id`, `session_source`, `root_id`, `path`)
ORDER BY (`organization_id`, `user_id`, `session_id`, `session_source`, `root_id`, `path`)
SETTINGS index_granularity = 1024, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Saved outputs of a session (background task outputs, large tool outputs) as its evidence captures uploaded them: one row per session and file, the latest capture\'s; the text is the evidence object blob_object_id.';
