-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:06:00.000Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 6
-- rename-suggestion-count: 0
-- risk-summary: safe=1, caution=5, danger=0

-- operation: data_backfill key=table:rudel.claude_sessions:revision risk=caution
-- Backfill after both materialized views exist so session_analytics receives
-- the exact revision emitted for each canonical raw row. ClickHouse binds
-- INSERT ... SELECT columns positionally, so every target is explicit.
-- Ascending filter_version gives newer filter output the higher ordinal and
-- therefore the winning revision. The remaining full-row tuple is the final
-- deterministic tie-break, so payload-distinct rows never compare equal.
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
			ORDER BY
				`filter_version` ASC,
				tuple(
					`session_date`,
					`last_interaction_date`,
					`session_id`,
					`organization_id`,
					`project_path`,
					`git_remote`,
					`package_name`,
					`package_type`,
					`content`,
					`ingested_at`,
					`user_id`,
					`git_branch`,
					`git_sha`,
					`tag`,
					toJSONString(`subagents`)
				) ASC
		) - 1 AS `tie_ordinal`
	FROM rudel.claude_sessions_f16_backfill_source_20260826
);

-- operation: data_backfill key=table:rudel.codex_sessions:revision risk=caution
-- Keep the same winner contract for Codex: newer filter output wins first,
-- then every remaining stored value supplies a total content order.
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
			ORDER BY
				`filter_version` ASC,
				tuple(
					`session_date`,
					`last_interaction_date`,
					`session_id`,
					`organization_id`,
					`project_path`,
					`git_remote`,
					`package_name`,
					`package_type`,
					`content`,
					`ingested_at`,
					`user_id`,
					`git_branch`,
					`git_sha`,
					`tag`
				) ASC
		) - 1 AS `tie_ordinal`
	FROM rudel.codex_sessions_f16_backfill_source_20260826
);

-- operation: create_table key=table:rudel.session_analytics_f16_rebuilt_identities_20260826 risk=safe
-- Stage the identities actually emitted by the rebuilt MVs. Raw existence is
-- insufficient because the current MV predicate intentionally filters some
-- raw rows.
CREATE TABLE rudel.session_analytics_f16_rebuilt_identities_20260826
ENGINE = MergeTree
ORDER BY (`source`, `organization_id`, `user_id`, `session_id`)
AS
SELECT
	`source`,
	`organization_id`,
	`user_id`,
	`session_id`
FROM rudel.session_analytics
GROUP BY `source`, `organization_id`, `user_id`, `session_id`;

-- operation: data_backfill key=table:rudel.session_analytics:revision risk=caution
-- Raw-backed analytics were recreated above by the materialized views with the
-- exact raw revision. Preserve analytics-only history after raw TTL expiry
-- without creating a competing revision for retained raw identities.
-- As for raw history, higher filter_version receives the higher revision; the
-- tuple then orders every remaining payload column deterministically.
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
			ORDER BY
				`filter_version` ASC,
				tuple(
					`session_date`,
					`last_interaction_date`,
					`project_path`,
					`git_remote`,
					`package_name`,
					`package_type`,
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
					reinterpretAsUInt64(`avg_period_sec`),
					reinterpretAsUInt64(`median_period_sec`),
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
	FROM rudel.session_analytics_f16_backfill_source_20260826
) AS analytics
LEFT ANTI JOIN
rudel.session_analytics_f16_rebuilt_identities_20260826 AS rebuilt
ON rebuilt.`source` = analytics.`source`
	AND rebuilt.`organization_id` = analytics.`organization_id`
	AND rebuilt.`user_id` = analytics.`user_id`
	AND rebuilt.`session_id` = analytics.`session_id`;

-- operation: drop_table key=table:rudel.session_analytics_f16_rebuilt_identities_20260826 risk=caution
DROP TABLE rudel.session_analytics_f16_rebuilt_identities_20260826 SYNC;

-- operation: data_backfill key=table:rudel.session_language_signals:signal_version risk=caution
-- Existing scans predate raw revisions. Version zero makes them lose to every
-- post-F16 revision while preserving them until reconciliation rescans.
-- Equal historical signal versions would otherwise fall back to insertion
-- order. Keep exactly the lexicographically greatest full-row payload for each
-- identity/scanned-at/scan-version key; exact duplicates are interchangeable.
INSERT INTO rudel.session_language_signals
(
	`organization_id`,
	`session_date`,
	`session_id`,
	`user_id`,
	`source`,
	`raw_revision`,
	`raw_ingested_at`,
	`scan_version`,
	`member_swears`,
	`member_apologies`,
	`member_positive`,
	`model_swears`,
	`model_apologies`,
	`model_positive`,
	`scanned_at`
)
SETTINGS async_insert=0
SELECT
	signals.`organization_id`,
	signals.`session_date`,
	signals.`session_id`,
	signals.`user_id`,
	signals.`source`,
	toUInt64(0) AS `raw_revision`,
	signals.`raw_ingested_at`,
	signals.`scan_version`,
	signals.`member_swears`,
	signals.`member_apologies`,
	signals.`member_positive`,
	signals.`model_swears`,
	signals.`model_apologies`,
	signals.`model_positive`,
	signals.`scanned_at`
FROM
(
	SELECT
		`organization_id`,
		`session_date`,
		`session_id`,
		`user_id`,
		`source`,
		`raw_ingested_at`,
		`scan_version`,
		`member_swears`,
		`member_apologies`,
		`member_positive`,
		`model_swears`,
		`model_apologies`,
		`model_positive`,
		`scanned_at`,
		row_number() OVER
		(
			PARTITION BY
				`organization_id`,
				`session_date`,
				`session_id`,
				`source`,
				`scanned_at`,
				`scan_version`
			ORDER BY tuple(
				`user_id`,
				`raw_ingested_at`,
				`member_swears`,
				`member_apologies`,
				`member_positive`,
				`model_swears`,
				`model_apologies`,
				`model_positive`
			) DESC
		) AS `dedupe_rank`
	FROM rudel.session_language_signals_f16_backfill_source_20260826
) AS signals
WHERE signals.`dedupe_rank` = 1;

-- The owner rollback backups keep their original engines and data. Only the
-- non-replacing snapshots used to make this backfill deterministic are removed.
DROP TABLE rudel.claude_sessions_f16_backfill_source_20260826 SYNC;
DROP TABLE rudel.codex_sessions_f16_backfill_source_20260826 SYNC;
DROP TABLE rudel.session_analytics_f16_backfill_source_20260826 SYNC;
DROP TABLE rudel.session_language_signals_f16_backfill_source_20260826 SYNC;
