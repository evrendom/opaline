-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:06:00.000Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 3
-- rename-suggestion-count: 0
-- risk-summary: safe=0, caution=3, danger=0

-- operation: data_backfill key=table:rudel.claude_sessions:revision risk=caution
-- Backfill after both materialized views exist so session_analytics receives
-- the exact revision emitted for each canonical raw row. ClickHouse binds
-- INSERT ... SELECT columns positionally, so every target is explicit.
INSERT INTO rudel.claude_sessions
(
	`session_date`,
	`last_interaction_date`,
	`session_id`,
	`organization_id`,
	`project_path`,
	`git_remote`,
	`package_name`,
	`package_type`,
	`content`,
	`filter_version`,
	`revision`,
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`subagents`
)
SETTINGS async_insert=0
SELECT
	`session_date`,
	`last_interaction_date`,
	`session_id`,
	`organization_id`,
	`project_path`,
	`git_remote`,
	`package_name`,
	`package_type`,
	`content`,
	`filter_version`,
	bitShiftLeft(toUInt64(toUnixTimestamp64Milli(`ingested_at`)), 16)
		+ (toUInt64(`tie_ordinal`) * 2) AS `revision`,
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`subagents`
FROM
(
	SELECT
		`session_date`,
		`last_interaction_date`,
		`session_id`,
		`organization_id`,
		`project_path`,
		`git_remote`,
		`package_name`,
		`package_type`,
		`content`,
		`filter_version`,
		`ingested_at`,
		`user_id`,
		`git_branch`,
		`git_sha`,
		`tag`,
		`subagents`,
		row_number() OVER
		(
			PARTITION BY
				`organization_id`,
				`session_id`,
				toUnixTimestamp64Milli(`ingested_at`)
			ORDER BY hex(SHA256(concat(
				`content`,
				'\0', `user_id`,
				'\0', `project_path`,
				'\0', ifNull(`git_sha`, ''),
				'\0', toJSONString(`subagents`)
			))) ASC
		) - 1 AS `tie_ordinal`
	FROM rudel.claude_sessions_f16_backup_20260826
);

-- operation: data_backfill key=table:rudel.codex_sessions:revision risk=caution
INSERT INTO rudel.codex_sessions
(
	`session_date`,
	`last_interaction_date`,
	`session_id`,
	`organization_id`,
	`project_path`,
	`git_remote`,
	`package_name`,
	`package_type`,
	`content`,
	`filter_version`,
	`revision`,
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`
)
SETTINGS async_insert=0
SELECT
	`session_date`,
	`last_interaction_date`,
	`session_id`,
	`organization_id`,
	`project_path`,
	`git_remote`,
	`package_name`,
	`package_type`,
	`content`,
	`filter_version`,
	bitShiftLeft(toUInt64(toUnixTimestamp64Milli(`ingested_at`)), 16)
		+ (toUInt64(`tie_ordinal`) * 2) + 1 AS `revision`,
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`
FROM
(
	SELECT
		`session_date`,
		`last_interaction_date`,
		`session_id`,
		`organization_id`,
		`project_path`,
		`git_remote`,
		`package_name`,
		`package_type`,
		`content`,
		`filter_version`,
		`ingested_at`,
		`user_id`,
		`git_branch`,
		`git_sha`,
		`tag`,
		row_number() OVER
		(
			PARTITION BY
				`organization_id`,
				`session_id`,
				toUnixTimestamp64Milli(`ingested_at`)
			ORDER BY hex(SHA256(concat(
				`content`,
				'\0', `user_id`,
				'\0', `project_path`,
				'\0', ifNull(`git_sha`, '')
			))) ASC
		) - 1 AS `tie_ordinal`
	FROM rudel.codex_sessions_f16_backup_20260826
);

-- operation: data_backfill key=table:rudel.session_analytics:revision risk=caution
-- Raw-backed analytics were recreated above by the materialized views with the
-- exact raw revision. Preserve analytics-only history after raw TTL expiry
-- without creating a competing revision for retained raw identities.
INSERT INTO rudel.session_analytics
(
	`session_date`,
	`last_interaction_date`,
	`session_id`,
	`organization_id`,
	`project_path`,
	`git_remote`,
	`package_name`,
	`package_type`,
	`filter_version`,
	`revision`,
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`source`,
	`skills`,
	`slash_commands`,
	`subagent_types`,
	`input_tokens`,
	`output_tokens`,
	`cache_read_input_tokens`,
	`cache_creation_input_tokens`,
	`total_tokens`,
	`total_interactions`,
	`actual_duration_min`,
	`avg_period_sec`,
	`median_period_sec`,
	`quick_responses`,
	`normal_responses`,
	`long_pauses`,
	`error_count`,
	`error_pattern`,
	`model_used`,
	`has_commit`,
	`session_archetype`,
	`success_score`,
	`used_plan_mode`,
	`inference_duration_sec`,
	`human_duration_sec`
)
SETTINGS async_insert=0
SELECT
	analytics.`session_date`,
	analytics.`last_interaction_date`,
	analytics.`session_id`,
	analytics.`organization_id`,
	analytics.`project_path`,
	analytics.`git_remote`,
	analytics.`package_name`,
	analytics.`package_type`,
	analytics.`filter_version`,
	bitShiftLeft(toUInt64(toUnixTimestamp64Milli(analytics.`ingested_at`)), 16)
		+ toUInt64(analytics.`tie_ordinal`) AS `revision`,
	analytics.`ingested_at`,
	analytics.`user_id`,
	analytics.`git_branch`,
	analytics.`git_sha`,
	analytics.`tag`,
	analytics.`source`,
	analytics.`skills`,
	analytics.`slash_commands`,
	analytics.`subagent_types`,
	analytics.`input_tokens`,
	analytics.`output_tokens`,
	analytics.`cache_read_input_tokens`,
	analytics.`cache_creation_input_tokens`,
	analytics.`total_tokens`,
	analytics.`total_interactions`,
	analytics.`actual_duration_min`,
	analytics.`avg_period_sec`,
	analytics.`median_period_sec`,
	analytics.`quick_responses`,
	analytics.`normal_responses`,
	analytics.`long_pauses`,
	analytics.`error_count`,
	analytics.`error_pattern`,
	analytics.`model_used`,
	analytics.`has_commit`,
	analytics.`session_archetype`,
	analytics.`success_score`,
	analytics.`used_plan_mode`,
	analytics.`inference_duration_sec`,
	analytics.`human_duration_sec`
FROM
(
	SELECT
		`session_date`,
		`last_interaction_date`,
		`session_id`,
		`organization_id`,
		`project_path`,
		`git_remote`,
		`package_name`,
		`package_type`,
		`filter_version`,
		`ingested_at`,
		`user_id`,
		`git_branch`,
		`git_sha`,
		`tag`,
		`source`,
		`skills`,
		`slash_commands`,
		`subagent_types`,
		`input_tokens`,
		`output_tokens`,
		`cache_read_input_tokens`,
		`cache_creation_input_tokens`,
		`total_tokens`,
		`total_interactions`,
		`actual_duration_min`,
		`avg_period_sec`,
		`median_period_sec`,
		`quick_responses`,
		`normal_responses`,
		`long_pauses`,
		`error_count`,
		`error_pattern`,
		`model_used`,
		`has_commit`,
		`session_archetype`,
		`success_score`,
		`used_plan_mode`,
		`inference_duration_sec`,
		`human_duration_sec`,
		row_number() OVER
		(
			PARTITION BY
				`source`,
				`organization_id`,
				`user_id`,
				`session_id`,
				toUnixTimestamp64Milli(`ingested_at`)
			ORDER BY tuple(
				`session_date`,
				`last_interaction_date`,
				`project_path`,
				`git_remote`,
				`package_name`,
				`package_type`,
				`filter_version`,
				`git_branch`,
				`git_sha`,
				`tag`,
				`skills`,
				`slash_commands`,
				`subagent_types`,
				`input_tokens`,
				`output_tokens`,
				`cache_read_input_tokens`,
				`cache_creation_input_tokens`,
				`total_tokens`,
				`total_interactions`,
				`actual_duration_min`,
				`avg_period_sec`,
				`median_period_sec`,
				`quick_responses`,
				`normal_responses`,
				`long_pauses`,
				`error_count`,
				`error_pattern`,
				`model_used`,
				`has_commit`,
				`session_archetype`,
				`success_score`,
				`used_plan_mode`,
				`inference_duration_sec`,
				`human_duration_sec`
			) ASC
		) - 1 AS `tie_ordinal`
	FROM rudel.session_analytics_f16_backup_20260826
) AS analytics
LEFT ANTI JOIN
(
	SELECT
		'claude_code' AS `source`,
		`organization_id`,
		`user_id`,
		`session_id`
	FROM rudel.claude_sessions_f16_backup_20260826
	GROUP BY `source`, `organization_id`, `user_id`, `session_id`

	UNION ALL

	SELECT
		'codex' AS `source`,
		`organization_id`,
		`user_id`,
		`session_id`
	FROM rudel.codex_sessions_f16_backup_20260826
	GROUP BY `source`, `organization_id`, `user_id`, `session_id`
) AS raw
ON raw.`source` = analytics.`source`
	AND raw.`organization_id` = analytics.`organization_id`
	AND raw.`user_id` = analytics.`user_id`
	AND raw.`session_id` = analytics.`session_id`;
