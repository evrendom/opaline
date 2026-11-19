-- chkit-migration-format: v1
-- generated-at: 2026-10-01T10:44:02.720Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 22
-- operation-count: 7
-- rename-suggestion-count: 0
-- risk-summary: safe=7, caution=0, danger=0

-- operation: create_database key=database:rudel risk=safe
CREATE DATABASE IF NOT EXISTS rudel;

-- operation: create_table key=table:rudel.github_ci_jobs risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_ci_jobs
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `run_id` String COMMENT 'run id from the GitHub provider object.',
  `attempt` UInt32 COMMENT 'attempt from the GitHub provider object.',
  `job_id` String COMMENT 'job id from the GitHub provider object.',
  `name` String COMMENT 'name from the GitHub provider object.',
  `status` LowCardinality(String) COMMENT 'status from the GitHub provider object.',
  `conclusion` LowCardinality(Nullable(String)) COMMENT 'conclusion from the GitHub provider object.',
  `created_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'Provider creation time; CI run identity uses this stable timestamp.',
  `started_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'started at from the GitHub provider object.',
  `completed_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'completed at from the GitHub provider object.',
  `runner_name` String COMMENT 'runner name from the GitHub provider object.',
  `labels` Array(String) COMMENT 'labels from the GitHub provider object.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, `run_id`, `attempt`, `job_id`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, `run_id`, `attempt`, `job_id`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;

-- operation: create_table key=table:rudel.github_ci_run_pull_requests risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_ci_run_pull_requests
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `pr_number` UInt32 COMMENT 'pr number from the GitHub provider object.',
  `run_created_at` DateTime64(3, 'UTC') COMMENT 'run created at from the GitHub provider object.',
  `kind` Enum8('actions_run' = 1, 'check_suite' = 2, 'check_run' = 3, 'status' = 4) COMMENT 'kind from the GitHub provider object.',
  `run_id` String COMMENT 'run id from the GitHub provider object.',
  `attempt` UInt32 COMMENT 'attempt from the GitHub provider object.',
  `basis` Enum8('provider' = 1, 'head-sha' = 2) COMMENT 'Provider pull_requests membership or fork head-SHA match.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, `pr_number`, `run_created_at`, `kind`, `run_id`, `attempt`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, `pr_number`, `run_created_at`, `kind`, `run_id`, `attempt`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;

-- operation: create_table key=table:rudel.github_ci_runs risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_ci_runs
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `kind` Enum8('actions_run' = 1, 'check_suite' = 2, 'check_run' = 3, 'status' = 4) COMMENT 'kind from the GitHub provider object.',
  `run_id` String COMMENT 'run id from the GitHub provider object.',
  `attempt` UInt32 COMMENT 'attempt from the GitHub provider object.',
  `created_at` DateTime64(3, 'UTC') COMMENT 'Provider creation time; CI run identity uses this stable timestamp.',
  `updated_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'updated at from the GitHub provider object.',
  `workflow_id` String COMMENT 'workflow id from the GitHub provider object.',
  `workflow_name` String COMMENT 'workflow name from the GitHub provider object.',
  `workflow_path` String COMMENT 'workflow path from the GitHub provider object.',
  `app_slug` String COMMENT 'app slug from the GitHub provider object.',
  `event` LowCardinality(String) COMMENT 'event from the GitHub provider object.',
  `head_sha` String COMMENT 'head sha from the GitHub provider object.',
  `head_branch` String COMMENT 'head branch from the GitHub provider object.',
  `status` LowCardinality(String) COMMENT 'status from the GitHub provider object.',
  `conclusion` LowCardinality(Nullable(String)) COMMENT 'conclusion from the GitHub provider object.',
  `run_started_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'run started at from the GitHub provider object.',
  `completed_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'completed at from the GitHub provider object.',
  `actor` String COMMENT 'actor from the GitHub provider object.',
  `triggering_actor` String COMMENT 'triggering actor from the GitHub provider object.',
  `display_title` String COMMENT 'display title from the GitHub provider object.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, toDate(created_at), `kind`, `run_id`, `attempt`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, toDate(created_at), `kind`, `run_id`, `attempt`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;

-- operation: create_table key=table:rudel.github_pull_request_commits risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_pull_request_commits
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `sha` String COMMENT 'sha from the GitHub provider object.',
  `pr_number` UInt32 COMMENT 'pr number from the GitHub provider object.',
  `last_seen_head_sha` String COMMENT 'PR head SHA observed when this commit membership was collected.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, `sha`, `pr_number`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, `sha`, `pr_number`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;

-- operation: create_table key=table:rudel.github_pull_request_details risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_pull_request_details
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `number` UInt32 COMMENT 'number from the GitHub provider object.',
  `additions` Nullable(UInt32) COMMENT 'additions from the GitHub provider object.',
  `deletions` Nullable(UInt32) COMMENT 'deletions from the GitHub provider object.',
  `changed_files` Nullable(UInt32) COMMENT 'changed files from the GitHub provider object.',
  `commits` Nullable(UInt32) COMMENT 'commits from the GitHub provider object.',
  `merged_by` String COMMENT 'merged by from the GitHub provider object.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, `number`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, `number`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;

-- operation: create_table key=table:rudel.github_pull_requests risk=safe
CREATE TABLE IF NOT EXISTS rudel.github_pull_requests
(
  `workspace_id` String COMMENT 'Actual Opaline workspace organization ID.',
  `provider` LowCardinality(String) COMMENT 'Provider identity; github in stage 1.',
  `repository_id` String COMMENT 'Immutable GitHub repository ID, not owner/name.',
  `number` UInt32 COMMENT 'number from the GitHub provider object.',
  `provider_pull_request_id` String COMMENT 'provider pull request id from the GitHub provider object.',
  `state` LowCardinality(String) COMMENT 'state from the GitHub provider object.',
  `draft` UInt8 COMMENT 'draft from the GitHub provider object.',
  `created_at` DateTime64(3, 'UTC') COMMENT 'Provider creation time; CI run identity uses this stable timestamp.',
  `updated_at` DateTime64(3, 'UTC') COMMENT 'updated at from the GitHub provider object.',
  `closed_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'closed at from the GitHub provider object.',
  `merged_at` Nullable(DateTime64(3, 'UTC')) COMMENT 'merged at from the GitHub provider object.',
  `head_sha` String COMMENT 'head sha from the GitHub provider object.',
  `head_ref` String COMMENT 'head ref from the GitHub provider object.',
  `base_ref` String COMMENT 'base ref from the GitHub provider object.',
  `head_repository_id` String COMMENT 'head repository id from the GitHub provider object.',
  `merge_commit_sha` String COMMENT 'merge commit sha from the GitHub provider object.',
  `author_id` String COMMENT 'author id from the GitHub provider object.',
  `author_login` String COMMENT 'author login from the GitHub provider object.',
  `title` String COMMENT 'title from the GitHub provider object.',
  `labels` Array(String) COMMENT 'labels from the GitHub provider object.',
  `version` UInt64 COMMENT 'Replacing version in milliseconds: provider timestamp, or synced_at for memberships.',
  `synced_at` DateTime64(3, 'UTC') COMMENT 'UTC millisecond timestamp at which this fact was collected.'
) ENGINE = SharedReplacingMergeTree(version)
PRIMARY KEY (`workspace_id`, `provider`, `repository_id`, `number`)
ORDER BY (`workspace_id`, `provider`, `repository_id`, `number`)
SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000;
