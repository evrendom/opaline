-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:05:50.000Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 10
-- rename-suggestion-count: 0
-- risk-summary: safe=6, caution=4, danger=0

-- F16-P01: Enforce the controlled executor with an explicit request timeout.
SELECT throwIf(
	getSetting('log_comment') != 'rudel-f16-controlled-migration',
	'F16 preservation requires bun run ch:migrate:f16; stock chkit has a 30 second request timeout'
);

-- F16-P02: Never take a new snapshot after the atomic cutover has begun.
SELECT throwIf(
	countIf(name IN (
		'claude_sessions_f16_backup_20260826',
		'codex_sessions_f16_backup_20260826',
		'session_analytics_f16_backup_20260826',
		'session_language_signals_f16_backup_20260826'
	)) > 0,
	'F16 preservation aborted: backup names already exist; use the recovery matrix instead of resnapshotting canonical tables'
)
FROM system.tables
WHERE database = 'rudel';

-- F16-P03: Operator checkpoints are append-only and survive snapshot cleanup.
CREATE TABLE IF NOT EXISTS rudel.f16_revision_cutover_control_20260826
(
	`checkpoint` LowCardinality(String),
	`approved` UInt8,
	`approved_by` String,
	`approved_at` DateTime64(3, 'UTC'),
	`evidence_reference` String
) ENGINE = ReplacingMergeTree(approved_at)
ORDER BY (`checkpoint`)
SETTINGS index_granularity = 1;

-- F16-P04: This artifact remains after cleanup as the durable count receipt.
CREATE TABLE IF NOT EXISTS rudel.f16_revision_cutover_verification_20260826
(
	`phase` LowCardinality(String),
	`table_name` LowCardinality(String),
	`source_physical_rows` UInt64,
	`snapshot_physical_rows` UInt64,
	`source_equal_key_version_groups` UInt64,
	`snapshot_equal_key_version_groups` UInt64,
	`verified_at` DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(verified_at)
ORDER BY (`phase`, `table_name`)
SETTINGS index_granularity = 1;

-- F16-P05: Claude preservation table.
CREATE TABLE IF NOT EXISTS rudel.claude_sessions_f16_backfill_source_20260826
(
	`session_date` DateTime64(3, 'UTC'),
	`last_interaction_date` DateTime64(3, 'UTC'),
	`session_id` String,
	`organization_id` String,
	`project_path` String,
	`git_remote` String,
	`package_name` String,
	`package_type` String,
	`content` String,
	`ingested_at` DateTime64(3, 'UTC'),
	`user_id` String,
	`git_branch` Nullable(String),
	`git_sha` Nullable(String),
	`tag` Nullable(String),
	`subagents` Map(String, String),
	`filter_version` UInt8
) ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`)
ORDER BY (`organization_id`, `session_date`, `session_id`)
SETTINGS index_granularity = 8192;

-- F16-P06: A stale or incompatible snapshot name fails before data changes.
SELECT throwIf(
	countIf(
		name = 'claude_sessions_f16_backfill_source_20260826'
		AND engine IN ('MergeTree', 'SharedMergeTree')
	) != 1,
	'F16 preservation aborted: Claude snapshot metadata is not visible with the expected engine'
) AS f16_poll_claude_snapshot_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-P07: Reset makes a cancelled or partially committed copy replay-safe.
TRUNCATE TABLE rudel.claude_sessions_f16_backfill_source_20260826;

-- F16-P08: Copy every active physical Claude row without FINAL.
INSERT INTO rudel.claude_sessions_f16_backfill_source_20260826
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
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`subagents`,
	`filter_version`
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
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`subagents`,
	`filter_version`
FROM rudel.claude_sessions;

-- F16-P09: Codex preservation table.
CREATE TABLE IF NOT EXISTS rudel.codex_sessions_f16_backfill_source_20260826
(
	`session_date` DateTime64(3, 'UTC'),
	`last_interaction_date` DateTime64(3, 'UTC'),
	`session_id` String,
	`organization_id` String,
	`project_path` String,
	`git_remote` String,
	`package_name` String,
	`package_type` String,
	`content` String,
	`ingested_at` DateTime64(3, 'UTC'),
	`user_id` String,
	`git_branch` Nullable(String),
	`git_sha` Nullable(String),
	`tag` Nullable(String),
	`filter_version` UInt8
) ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY (`organization_id`, `session_date`, `session_id`)
ORDER BY (`organization_id`, `session_date`, `session_id`)
SETTINGS index_granularity = 8192;

-- F16-P10: Validate Codex preservation metadata.
SELECT throwIf(
	countIf(
		name = 'codex_sessions_f16_backfill_source_20260826'
		AND engine IN ('MergeTree', 'SharedMergeTree')
	) != 1,
	'F16 preservation aborted: Codex snapshot metadata is not visible with the expected engine'
) AS f16_poll_codex_snapshot_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-P11: Reset makes the Codex copy replay-safe.
TRUNCATE TABLE rudel.codex_sessions_f16_backfill_source_20260826;

-- F16-P12: Copy every active physical Codex row without FINAL.
INSERT INTO rudel.codex_sessions_f16_backfill_source_20260826
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
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`filter_version`
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
	`ingested_at`,
	`user_id`,
	`git_branch`,
	`git_sha`,
	`tag`,
	`filter_version`
FROM rudel.codex_sessions;

-- F16-P13: Analytics preservation table.
CREATE TABLE IF NOT EXISTS rudel.session_analytics_f16_backfill_source_20260826
(
	`session_date` DateTime64(3, 'UTC'),
	`last_interaction_date` DateTime64(3, 'UTC'),
	`session_id` String,
	`organization_id` String,
	`project_path` String,
	`git_remote` String,
	`package_name` String,
	`package_type` String,
	`filter_version` UInt8,
	`ingested_at` DateTime64(3, 'UTC'),
	`user_id` String,
	`git_branch` Nullable(String),
	`git_sha` Nullable(String),
	`tag` Nullable(String),
	`source` LowCardinality(String),
	`skills` Array(String),
	`slash_commands` Array(String),
	`subagent_types` Array(String),
	`input_tokens` UInt64,
	`output_tokens` UInt64,
	`cache_read_input_tokens` UInt64,
	`cache_creation_input_tokens` UInt64,
	`total_tokens` UInt64,
	`total_interactions` UInt32,
	`actual_duration_min` UInt32,
	`avg_period_sec` Float64,
	`median_period_sec` Float64,
	`quick_responses` UInt32,
	`normal_responses` UInt32,
	`long_pauses` UInt32,
	`error_count` UInt32,
	`error_pattern` LowCardinality(String),
	`model_used` String,
	`has_commit` UInt8,
	`session_archetype` String,
	`success_score` UInt8,
	`used_plan_mode` UInt8,
	`inference_duration_sec` UInt32,
	`human_duration_sec` UInt32
) ENGINE = MergeTree
PRIMARY KEY (`source`, `organization_id`, `user_id`, `session_id`)
ORDER BY (`source`, `organization_id`, `user_id`, `session_id`)
SETTINGS index_granularity = 8192;

-- F16-P14: Validate analytics preservation metadata.
SELECT throwIf(
	countIf(
		name = 'session_analytics_f16_backfill_source_20260826'
		AND engine IN ('MergeTree', 'SharedMergeTree')
	) != 1,
	'F16 preservation aborted: analytics snapshot metadata is not visible with the expected engine'
) AS f16_poll_analytics_snapshot_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-P15: Reset makes the analytics copy replay-safe.
TRUNCATE TABLE rudel.session_analytics_f16_backfill_source_20260826;

-- F16-P16: Copy every active physical analytics row without FINAL.
INSERT INTO rudel.session_analytics_f16_backfill_source_20260826
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
	`human_duration_sec`
FROM rudel.session_analytics;

-- F16-P17: Language-signal preservation table.
CREATE TABLE IF NOT EXISTS rudel.session_language_signals_f16_backfill_source_20260826
(
	`organization_id` String,
	`session_date` DateTime64(3, 'UTC'),
	`session_id` String,
	`user_id` String,
	`source` LowCardinality(String),
	`raw_ingested_at` DateTime64(3, 'UTC'),
	`scan_version` UInt16,
	`member_swears` UInt32,
	`member_apologies` UInt32,
	`member_positive` UInt32,
	`model_swears` UInt32,
	`model_apologies` UInt32,
	`model_positive` UInt32,
	`scanned_at` DateTime64(3, 'UTC')
) ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(session_date))
PRIMARY KEY ()
ORDER BY (`organization_id`, `session_date`, `session_id`, `source`)
SETTINGS index_granularity = 8192;

-- F16-P18: Validate language-signal preservation metadata.
SELECT throwIf(
	countIf(
		name = 'session_language_signals_f16_backfill_source_20260826'
		AND engine IN ('MergeTree', 'SharedMergeTree')
	) != 1,
	'F16 preservation aborted: language-signal snapshot metadata is not visible with the expected engine'
) AS f16_poll_signal_snapshot_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-P19: Reset makes the language-signal copy replay-safe.
TRUNCATE TABLE rudel.session_language_signals_f16_backfill_source_20260826;

-- F16-P20: Copy every active physical language-signal row without FINAL.
INSERT INTO rudel.session_language_signals_f16_backfill_source_20260826
(
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
	`scanned_at`
)
SETTINGS async_insert=0
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
	`scanned_at`
FROM rudel.session_language_signals;

-- F16-P21: A replay rewrites the preservation receipt from scratch.
TRUNCATE TABLE rudel.f16_revision_cutover_verification_20260826;

-- F16-P22: Persist source/snapshot physical counts and equal-key/version groups.
INSERT INTO rudel.f16_revision_cutover_verification_20260826
(
	`phase`,
	`table_name`,
	`source_physical_rows`,
	`snapshot_physical_rows`,
	`source_equal_key_version_groups`,
	`snapshot_equal_key_version_groups`,
	`verified_at`
)
SELECT
	'preservation' AS phase,
	'claude_sessions' AS table_name,
	(SELECT count() FROM rudel.claude_sessions) AS source_physical_rows,
	(SELECT count() FROM rudel.claude_sessions_f16_backfill_source_20260826) AS snapshot_physical_rows,
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions
			GROUP BY organization_id, session_date, session_id, ingested_at
			HAVING count() > 1
		)
	) AS source_equal_key_version_groups,
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions_f16_backfill_source_20260826
			GROUP BY organization_id, session_date, session_id, ingested_at
			HAVING count() > 1
		)
	) AS snapshot_equal_key_version_groups,
	now64(3) AS verified_at
UNION ALL
SELECT
	'preservation',
	'codex_sessions',
	(SELECT count() FROM rudel.codex_sessions),
	(SELECT count() FROM rudel.codex_sessions_f16_backfill_source_20260826),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions
			GROUP BY organization_id, session_date, session_id, ingested_at
			HAVING count() > 1
		)
	),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions_f16_backfill_source_20260826
			GROUP BY organization_id, session_date, session_id, ingested_at
			HAVING count() > 1
		)
	),
	now64(3)
UNION ALL
SELECT
	'preservation',
	'session_analytics',
	(SELECT count() FROM rudel.session_analytics),
	(SELECT count() FROM rudel.session_analytics_f16_backfill_source_20260826),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_analytics
			GROUP BY source, organization_id, user_id, session_id, ingested_at
			HAVING count() > 1
		)
	),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_analytics_f16_backfill_source_20260826
			GROUP BY source, organization_id, user_id, session_id, ingested_at
			HAVING count() > 1
		)
	),
	now64(3)
UNION ALL
SELECT
	'preservation',
	'session_language_signals',
	(SELECT count() FROM rudel.session_language_signals),
	(SELECT count() FROM rudel.session_language_signals_f16_backfill_source_20260826),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_language_signals
			GROUP BY organization_id, session_date, session_id, source, scanned_at
			HAVING count() > 1
		)
	),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_language_signals_f16_backfill_source_20260826
			GROUP BY organization_id, session_date, session_id, source, scanned_at
			HAVING count() > 1
		)
	),
	now64(3);

-- F16-P23: Abort before journaling on any physical or tie-group loss.
SELECT throwIf(
	count() != 4
	OR countIf(source_physical_rows > snapshot_physical_rows) > 0
	OR countIf(
		source_equal_key_version_groups > snapshot_equal_key_version_groups
	) > 0,
	'F16 preservation aborted: source/snapshot verification receipt reports unexplained row or equal-key/version-group loss'
)
FROM rudel.f16_revision_cutover_verification_20260826 FINAL
WHERE phase = 'preservation';
