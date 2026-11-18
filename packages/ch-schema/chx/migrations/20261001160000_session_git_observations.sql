-- chkit-migration-format: v1
-- generated-at: 2026-10-01T13:45:25.694Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 17
-- operation-count: 2
-- rename-suggestion-count: 0
-- risk-summary: safe=2, caution=0, danger=0

-- operation: create_database key=database:rudel risk=safe
CREATE DATABASE IF NOT EXISTS rudel;

-- operation: create_table key=table:rudel.session_git_observations risk=safe
CREATE TABLE IF NOT EXISTS rudel.session_git_observations
(
  `organization_id` String COMMENT 'Owning organization ID; first tenant boundary.',
  `user_id` String COMMENT 'Uploading account ID; second tenant boundary.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex; part of session identity.',
  `session_id` String COMMENT 'Native session ID within organization, user and source.',
  `revision` UInt64 COMMENT 'Exact raw transcript revision used by this extraction generation.',
  `parser_version` UInt16 COMMENT 'Generation version: git extractor version times 256 plus transcript parser version; retries replace only the same generation.',
  `transcript_parser_version` UInt16 COMMENT 'Published transcript records parser version consumed by the extractor.',
  `agent_id` String COMMENT 'Transcript stream agent ID; empty for the main stream.',
  `record_idx` UInt32 COMMENT 'One-based raw JSONL record index; 4294967295 is the completion receipt.',
  `block_idx` UInt32 COMMENT 'Source content block index times 65536 plus output match ordinal; zero for metadata and receipts.',
  `call_id` String COMMENT 'Observed tool call ID, paired within the same agent stream; empty for metadata and receipts.',
  `kind` LowCardinality(String) COMMENT 'commit_created, push_range, pr_url, mcp_pr_created, codex_session_meta, or internal receipt.',
  `short_sha` String COMMENT 'Observed abbreviated commit SHA; never expanded or attributed here.',
  `branch` String COMMENT 'Secret-filtered observed commit, push target or session metadata branch; capped at 512 characters.',
  `subject_sha256` String COMMENT 'SHA256 of the observed commit subject; subject text is never stored.',
  `push_from_sha` String COMMENT 'Observed abbreviated SHA before a push range; empty for other kinds.',
  `push_to_sha` String COMMENT 'Observed abbreviated SHA after a push range; empty for other kinds.',
  `push_source_branch` String COMMENT 'Secret-filtered observed push source branch; capped at 512 characters.',
  `pr_repo` String COMMENT 'Secret-filtered GitHub owner/name from an observed pull request URL; capped at 512 characters.',
  `pr_number` UInt32 COMMENT 'Observed GitHub pull request number; zero when not applicable.',
  `commit_hash` String COMMENT 'Observed full commit hash in Codex session metadata; not a resolved short SHA.',
  `repository_url` String COMMENT 'Secret-filtered repository URL from Codex metadata; credentials removed and capped at 512 characters.',
  `ts` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp of the evidence record, or receipt publication.',
  `label` LowCardinality(String) COMMENT 'Evidence label observed; a receipt is an internal completion marker, not evidence.'
) ENGINE = ReplacingMergeTree()
PRIMARY KEY (`organization_id`, `user_id`, `source`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`, `call_id`, `kind`)
ORDER BY (`organization_id`, `user_id`, `source`, `session_id`, `revision`, `parser_version`, `agent_id`, `record_idx`, `block_idx`, `call_id`, `kind`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Deterministic observed git and GitHub PR evidence from published transcript records. Receipts commit bounded extraction generations; no resolver or attribution.';
