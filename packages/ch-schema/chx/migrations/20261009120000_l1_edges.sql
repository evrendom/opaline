-- L1 edges (docs/adr/0003-l1-evidence-entities-edges.md): relationships between
-- runs, sessions, commits, pull requests and CI runs, their reverse copy, and
-- per-evidence resolutions. Written only by the reconciliation worker.

CREATE TABLE IF NOT EXISTS rudel.l1_edges
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `from_kind` LowCardinality(String) COMMENT 'Source node kind: run, session, commit or pull_request.',
  `from_id` String COMMENT 'Source node id, percent-encoded components joined by /: run user/source/session/agent/start record, session user/source/session/agent, commit repository/SHA, pull_request repository/number.',
  `relation` LowCardinality(String) COMMENT 'Relationship the evidence states: commit_created, commit_pushed, commit_captured, sha_mentioned, pr_named, pr_branch_head, pr_listed, ci_named, ci_on_branch_window, commit_in_pr, ci_on_sha, ci_for_pr.',
  `to_kind` LowCardinality(String) COMMENT 'Target node kind: commit, pull_request or ci_run.',
  `to_id` String COMMENT 'Target node id: commit repository/SHA, pull_request repository/number, ci_run repository/kind/run id/attempt.',
  `evidence_id` String COMMENT 'Stable id of the evidence row that witnesses the relationship (observation, capture, snapshot or GitHub row).',
  `basis` LowCardinality(String) COMMENT 'Where the evidence came from: transcript, capture, hook or github.',
  `user_id` String COMMENT 'Session owner for session evidence; empty for GitHub edges.',
  `source` LowCardinality(String) COMMENT 'Transcript source (claude_code or codex) for session evidence; empty for GitHub edges.',
  `session_id` String COMMENT 'Native session ID for session evidence; empty for GitHub edges.',
  `agent_id` String COMMENT 'Transcript stream for session evidence; empty for the main stream.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream when the source is a run; zero otherwise.',
  `repository_id` String COMMENT 'GitHub repository ID the edge resolved in; reads keep only actively bound repositories.',
  `evidence_revision` UInt64 COMMENT 'Transcript revision of the evidence generation; zero for GitHub edges.',
  `evidence_parser_version` UInt16 COMMENT 'Git observation generation version of the evidence; zero for other bases.',
  `transcript_parser_version` UInt16 COMMENT 'Transcript records parser version of the evidence; zero for other bases.',
  `observed_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time of the evidence: observation, capture, snapshot or GitHub fact.',
  `matched_value` String COMMENT 'Literal value the evidence matched on: abbreviated SHA, branch, PR number, run id or membership head.',
  `match_rule` LowCardinality(String) COMMENT 'How the value matched: full_sha, unique_prefix, number, branch_head, run_id, branch_window, membership, merge_commit, head_sha, or the GitHub link basis.',
  `candidate_count` UInt32 COMMENT 'How many targets the value matched; an edge per target, so more than one is a branch or prefix shared by several.',
  `details` String COMMENT 'Small JSON object of further literal values (check label, branch window, ceiling reached, whether the PR head still contains the commit).',
  `resolver_version` UInt16 COMMENT 'Version of the worker rules that wrote the row.',
  `revision` UInt64 COMMENT 'Replacing version: monotonic build revision of the worker, so a later build wins.',
  `is_active` UInt8 COMMENT '1 while the relationship holds; 0 retracts it.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker wrote the row.'
) ENGINE = ReplacingMergeTree(revision)
PRIMARY KEY (`organization_id`, `from_kind`, `from_id`, `relation`, `to_kind`, `to_id`, `evidence_id`)
ORDER BY (`organization_id`, `from_kind`, `from_id`, `relation`, `to_kind`, `to_id`, `evidence_id`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'L1 edges between runs, sessions, commits, pull requests and CI runs, ordered by source; written only by the reconciliation worker.';

CREATE TABLE IF NOT EXISTS rudel.l1_edges_by_target
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `from_kind` LowCardinality(String) COMMENT 'Source node kind: run, session, commit or pull_request.',
  `from_id` String COMMENT 'Source node id, percent-encoded components joined by /: run user/source/session/agent/start record, session user/source/session/agent, commit repository/SHA, pull_request repository/number.',
  `relation` LowCardinality(String) COMMENT 'Relationship the evidence states: commit_created, commit_pushed, commit_captured, sha_mentioned, pr_named, pr_branch_head, pr_listed, ci_named, ci_on_branch_window, commit_in_pr, ci_on_sha, ci_for_pr.',
  `to_kind` LowCardinality(String) COMMENT 'Target node kind: commit, pull_request or ci_run.',
  `to_id` String COMMENT 'Target node id: commit repository/SHA, pull_request repository/number, ci_run repository/kind/run id/attempt.',
  `evidence_id` String COMMENT 'Stable id of the evidence row that witnesses the relationship (observation, capture, snapshot or GitHub row).',
  `basis` LowCardinality(String) COMMENT 'Where the evidence came from: transcript, capture, hook or github.',
  `user_id` String COMMENT 'Session owner for session evidence; empty for GitHub edges.',
  `source` LowCardinality(String) COMMENT 'Transcript source (claude_code or codex) for session evidence; empty for GitHub edges.',
  `session_id` String COMMENT 'Native session ID for session evidence; empty for GitHub edges.',
  `agent_id` String COMMENT 'Transcript stream for session evidence; empty for the main stream.',
  `turn_idx` UInt32 COMMENT 'Run number within the stream when the source is a run; zero otherwise.',
  `repository_id` String COMMENT 'GitHub repository ID the edge resolved in; reads keep only actively bound repositories.',
  `evidence_revision` UInt64 COMMENT 'Transcript revision of the evidence generation; zero for GitHub edges.',
  `evidence_parser_version` UInt16 COMMENT 'Git observation generation version of the evidence; zero for other bases.',
  `transcript_parser_version` UInt16 COMMENT 'Transcript records parser version of the evidence; zero for other bases.',
  `observed_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time of the evidence: observation, capture, snapshot or GitHub fact.',
  `matched_value` String COMMENT 'Literal value the evidence matched on: abbreviated SHA, branch, PR number, run id or membership head.',
  `match_rule` LowCardinality(String) COMMENT 'How the value matched: full_sha, unique_prefix, number, branch_head, run_id, branch_window, membership, merge_commit, head_sha, or the GitHub link basis.',
  `candidate_count` UInt32 COMMENT 'How many targets the value matched; an edge per target, so more than one is a branch or prefix shared by several.',
  `details` String COMMENT 'Small JSON object of further literal values (check label, branch window, ceiling reached, whether the PR head still contains the commit).',
  `resolver_version` UInt16 COMMENT 'Version of the worker rules that wrote the row.',
  `revision` UInt64 COMMENT 'Replacing version: monotonic build revision of the worker, so a later build wins.',
  `is_active` UInt8 COMMENT '1 while the relationship holds; 0 retracts it.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker wrote the row.'
) ENGINE = ReplacingMergeTree(revision)
PRIMARY KEY (`organization_id`, `to_kind`, `to_id`, `relation`, `from_kind`, `from_id`, `evidence_id`)
ORDER BY (`organization_id`, `to_kind`, `to_id`, `relation`, `from_kind`, `from_id`, `evidence_id`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Copy of l1_edges ordered by target, filled by l1_edges_by_target_mv; purged separately.';

CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.l1_edges_by_target_mv TO rudel.l1_edges_by_target AS SELECT * FROM rudel.l1_edges;

CREATE TABLE IF NOT EXISTS rudel.l1_edge_resolutions
(
  `organization_id` String COMMENT 'Owning workspace ID; tenant boundary.',
  `user_id` String COMMENT 'Session owner.',
  `source` LowCardinality(String) COMMENT 'Transcript source: claude_code or codex.',
  `session_id` String COMMENT 'Native session ID.',
  `evidence_id` String COMMENT 'Stable id of the evidence row, as in l1_edges.',
  `target` LowCardinality(String) COMMENT 'What was resolved from the evidence: repository, commit, pull_request (by number), branch_pull_request (by head branch) or ci_run.',
  `status` LowCardinality(String) COMMENT 'linked, unbound (repository without an active binding), not_github, no_repository, ambiguous (several candidates), or not_found.',
  `candidate_count` UInt32 COMMENT 'How many collected targets matched.',
  `repository_id` String COMMENT 'Resolved GitHub repository ID; empty when none.',
  `repository_basis` LowCardinality(String) COMMENT 'Where the repository came from: event, session, capture, or empty when none.',
  `repository_value` String COMMENT 'Literal remote, repository or owner/name value it resolved from.',
  `matched_value` String COMMENT 'Literal value resolved: abbreviated SHA, branch, number or run id.',
  `evidence_revision` UInt64 COMMENT 'Transcript revision of the evidence generation; zero for captures.',
  `resolver_version` UInt16 COMMENT 'Version of the worker rules that wrote the row.',
  `revision` UInt64 COMMENT 'Replacing version: monotonic build revision of the worker.',
  `is_active` UInt8 COMMENT '1 while current; 0 retracts it.',
  `written_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond time the worker wrote the row.'
) ENGINE = ReplacingMergeTree(revision)
PRIMARY KEY (`organization_id`, `user_id`, `source`, `session_id`, `evidence_id`, `target`)
ORDER BY (`organization_id`, `user_id`, `source`, `session_id`, `evidence_id`, `target`)
SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Per evidence row and target, whether the worker resolved it and why not; evidence without an edge keeps its reason here.';
