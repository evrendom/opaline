export const GITHUB_OUTCOME_TABLES = [
	{
		name: "github_pull_requests",
		orderBy: ["workspace_id", "provider", "repository_id", "number"],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "number",
				type: "UInt32",
				comment: "number from the GitHub provider object.",
			},
			{
				name: "provider_pull_request_id",
				type: "String",
				comment: "provider pull request id from the GitHub provider object.",
			},
			{
				name: "state",
				type: "LowCardinality(String)",
				comment: "state from the GitHub provider object.",
			},
			{
				name: "draft",
				type: "UInt8",
				comment: "draft from the GitHub provider object.",
			},
			{
				name: "created_at",
				type: "DateTime64(3, 'UTC')",
				comment:
					"Provider creation time; CI run identity uses this stable timestamp.",
			},
			{
				name: "updated_at",
				type: "DateTime64(3, 'UTC')",
				comment: "updated at from the GitHub provider object.",
			},
			{
				name: "closed_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "closed at from the GitHub provider object.",
			},
			{
				name: "merged_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "merged at from the GitHub provider object.",
			},
			{
				name: "head_sha",
				type: "String",
				comment: "head sha from the GitHub provider object.",
			},
			{
				name: "head_ref",
				type: "String",
				comment: "head ref from the GitHub provider object.",
			},
			{
				name: "base_ref",
				type: "String",
				comment: "base ref from the GitHub provider object.",
			},
			{
				name: "head_repository_id",
				type: "String",
				comment: "head repository id from the GitHub provider object.",
			},
			{
				name: "merge_commit_sha",
				type: "String",
				comment: "merge commit sha from the GitHub provider object.",
			},
			{
				name: "author_id",
				type: "String",
				comment: "author id from the GitHub provider object.",
			},
			{
				name: "author_login",
				type: "String",
				comment: "author login from the GitHub provider object.",
			},
			{
				name: "title",
				type: "String",
				comment: "title from the GitHub provider object.",
			},
			{
				name: "labels",
				type: "Array(String)",
				comment: "labels from the GitHub provider object.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
	{
		name: "github_pull_request_details",
		orderBy: ["workspace_id", "provider", "repository_id", "number"],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "number",
				type: "UInt32",
				comment: "number from the GitHub provider object.",
			},
			{
				name: "additions",
				type: "Nullable(UInt32)",
				comment: "additions from the GitHub provider object.",
			},
			{
				name: "deletions",
				type: "Nullable(UInt32)",
				comment: "deletions from the GitHub provider object.",
			},
			{
				name: "changed_files",
				type: "Nullable(UInt32)",
				comment: "changed files from the GitHub provider object.",
			},
			{
				name: "commits",
				type: "Nullable(UInt32)",
				comment: "commits from the GitHub provider object.",
			},
			{
				name: "merged_by",
				type: "String",
				comment: "merged by from the GitHub provider object.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
	{
		name: "github_pull_request_commits",
		orderBy: ["workspace_id", "provider", "repository_id", "sha", "pr_number"],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "sha",
				type: "String",
				comment: "sha from the GitHub provider object.",
			},
			{
				name: "pr_number",
				type: "UInt32",
				comment: "pr number from the GitHub provider object.",
			},
			{
				name: "last_seen_head_sha",
				type: "String",
				comment:
					"PR head SHA observed when this commit membership was collected.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
	{
		name: "github_ci_runs",
		orderBy: [
			"workspace_id",
			"provider",
			"repository_id",
			"toDate(created_at)",
			"kind",
			"run_id",
			"attempt",
		],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "kind",
				type: "Enum8('actions_run' = 1, 'check_suite' = 2, 'check_run' = 3, 'status' = 4)",
				comment: "kind from the GitHub provider object.",
			},
			{
				name: "run_id",
				type: "String",
				comment: "run id from the GitHub provider object.",
			},
			{
				name: "attempt",
				type: "UInt32",
				comment: "attempt from the GitHub provider object.",
			},
			{
				name: "created_at",
				type: "DateTime64(3, 'UTC')",
				comment:
					"Provider creation time; CI run identity uses this stable timestamp.",
			},
			{
				name: "updated_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "updated at from the GitHub provider object.",
			},
			{
				name: "workflow_id",
				type: "String",
				comment: "workflow id from the GitHub provider object.",
			},
			{
				name: "workflow_name",
				type: "String",
				comment: "workflow name from the GitHub provider object.",
			},
			{
				name: "workflow_path",
				type: "String",
				comment: "workflow path from the GitHub provider object.",
			},
			{
				name: "app_slug",
				type: "String",
				comment: "app slug from the GitHub provider object.",
			},
			{
				name: "event",
				type: "LowCardinality(String)",
				comment: "event from the GitHub provider object.",
			},
			{
				name: "head_sha",
				type: "String",
				comment: "head sha from the GitHub provider object.",
			},
			{
				name: "head_branch",
				type: "String",
				comment: "head branch from the GitHub provider object.",
			},
			{
				name: "status",
				type: "LowCardinality(String)",
				comment: "status from the GitHub provider object.",
			},
			{
				name: "conclusion",
				type: "LowCardinality(Nullable(String))",
				comment: "conclusion from the GitHub provider object.",
			},
			{
				name: "run_started_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "run started at from the GitHub provider object.",
			},
			{
				name: "completed_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "completed at from the GitHub provider object.",
			},
			{
				name: "actor",
				type: "String",
				comment: "actor from the GitHub provider object.",
			},
			{
				name: "triggering_actor",
				type: "String",
				comment: "triggering actor from the GitHub provider object.",
			},
			{
				name: "display_title",
				type: "String",
				comment: "display title from the GitHub provider object.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
	{
		name: "github_ci_run_pull_requests",
		orderBy: [
			"workspace_id",
			"provider",
			"repository_id",
			"pr_number",
			"run_created_at",
			"kind",
			"run_id",
			"attempt",
		],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "pr_number",
				type: "UInt32",
				comment: "pr number from the GitHub provider object.",
			},
			{
				name: "run_created_at",
				type: "DateTime64(3, 'UTC')",
				comment: "run created at from the GitHub provider object.",
			},
			{
				name: "kind",
				type: "Enum8('actions_run' = 1, 'check_suite' = 2, 'check_run' = 3, 'status' = 4)",
				comment: "kind from the GitHub provider object.",
			},
			{
				name: "run_id",
				type: "String",
				comment: "run id from the GitHub provider object.",
			},
			{
				name: "attempt",
				type: "UInt32",
				comment: "attempt from the GitHub provider object.",
			},
			{
				name: "basis",
				type: "Enum8('provider' = 1, 'head-sha' = 2)",
				comment: "Provider pull_requests membership or fork head-SHA match.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
	{
		name: "github_ci_jobs",
		orderBy: [
			"workspace_id",
			"provider",
			"repository_id",
			"run_id",
			"attempt",
			"job_id",
		],
		columns: [
			{
				name: "workspace_id",
				type: "String",
				comment: "Actual Opaline workspace organization ID.",
			},
			{
				name: "provider",
				type: "LowCardinality(String)",
				comment: "Provider identity; github in stage 1.",
			},
			{
				name: "repository_id",
				type: "String",
				comment: "Immutable GitHub repository ID, not owner/name.",
			},
			{
				name: "run_id",
				type: "String",
				comment: "run id from the GitHub provider object.",
			},
			{
				name: "attempt",
				type: "UInt32",
				comment: "attempt from the GitHub provider object.",
			},
			{
				name: "job_id",
				type: "String",
				comment: "job id from the GitHub provider object.",
			},
			{
				name: "name",
				type: "String",
				comment: "name from the GitHub provider object.",
			},
			{
				name: "status",
				type: "LowCardinality(String)",
				comment: "status from the GitHub provider object.",
			},
			{
				name: "conclusion",
				type: "LowCardinality(Nullable(String))",
				comment: "conclusion from the GitHub provider object.",
			},
			{
				name: "created_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment:
					"Provider creation time; CI run identity uses this stable timestamp.",
			},
			{
				name: "started_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "started at from the GitHub provider object.",
			},
			{
				name: "completed_at",
				type: "Nullable(DateTime64(3, 'UTC'))",
				comment: "completed at from the GitHub provider object.",
			},
			{
				name: "runner_name",
				type: "String",
				comment: "runner name from the GitHub provider object.",
			},
			{
				name: "labels",
				type: "Array(String)",
				comment: "labels from the GitHub provider object.",
			},
			{
				name: "version",
				type: "UInt64",
				comment:
					"Replacing version in milliseconds: provider timestamp, or synced_at for memberships.",
			},
			{
				name: "synced_at",
				type: "DateTime64(3, 'UTC')",
				comment: "UTC millisecond timestamp at which this fact was collected.",
			},
		],
	},
];
