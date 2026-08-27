-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:06:00.000Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 6
-- rename-suggestion-count: 0
-- risk-summary: safe=1, caution=5, danger=0

-- F16-B01: Enforce the controlled executor with an explicit request timeout.
SELECT throwIf(
	getSetting('log_comment') != 'rudel-f16-controlled-migration',
	'F16 backfill requires bun run ch:migrate:f16; stock chkit is not supported'
);

-- F16-B02: Preservation remains the immutable input until cleanup approval.
SELECT throwIf(
	coalesce(maxIf(approved, checkpoint = 'preservation_verified'), 0) != 1,
	'F16 backfill aborted: preservation_verified checkpoint is missing'
)
FROM rudel.f16_revision_cutover_control_20260826 FINAL;

-- F16-B03: Poll every writer for all targets, backups, and insert-trigger MVs.
SELECT throwIf(
	countIf(
		name IN ('claude_sessions', 'codex_sessions')
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND endsWith(engine_full, 'revision)')
		AND sorting_key = 'organization_id, session_date, session_id'
	) != 2
	OR countIf(
		name = 'session_analytics'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND endsWith(engine_full, 'revision)')
		AND sorting_key = 'source, organization_id, user_id, session_id'
	) != 1
	OR countIf(
		name = 'session_language_signals'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND endsWith(engine_full, 'signal_version)')
		AND sorting_key = 'organization_id, session_date, session_id, source'
	) != 1
	OR countIf(
		name = 'codex_session_analytics_mv'
		AND engine = 'MaterializedView'
		AND position(create_table_query, 'codex_sessions') > 0
		AND position(create_table_query, 'session_analytics') > 0
		AND position(create_table_query, 'ORDER BY cs.revision DESC') > 0
	) != 1
	OR countIf(
		name = 'session_analytics_mv'
		AND engine = 'MaterializedView'
		AND position(create_table_query, 'claude_sessions') > 0
		AND position(create_table_query, 'session_analytics') > 0
		AND position(create_table_query, 'ORDER BY cs.revision DESC') > 0
	) != 1
	OR countIf(name IN (
		'claude_sessions_f16_backup_20260826',
		'codex_sessions_f16_backup_20260826',
		'session_analytics_f16_backup_20260826',
		'session_language_signals_f16_backup_20260826'
	)) != 4
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND name = 'revision'
			AND type = 'UInt64'
			AND table IN ('claude_sessions', 'codex_sessions', 'session_analytics')
	) != 3
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND table = 'session_language_signals'
			AND (
				(name = 'raw_revision' AND type = 'UInt64')
				OR (name = 'signal_version' AND type = 'UInt128')
			)
	) != 2,
	'F16 backfill visibility barrier: canonical targets, backups, or materialized views are not fully visible'
) AS f16_poll_backfill_targets_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-B04: Durable post-backfill counts remain after preservation cleanup.
CREATE TABLE IF NOT EXISTS rudel.f16_revision_cutover_postbackfill_verification_20260826
(
	`table_name` LowCardinality(String),
	`expected_logical_rows` UInt64,
	`canonical_logical_rows` UInt64,
	`canonical_physical_rows` UInt64,
	`verified_at` DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(verified_at)
ORDER BY (`table_name`)
SETTINGS index_granularity = 1;

-- F16-B05: A retry replaces the unapproved post-backfill receipt.
TRUNCATE TABLE rudel.f16_revision_cutover_postbackfill_verification_20260826;

-- F16-B06: A retry resets every pre-resume F16 target. Ingest remains quiesced.
TRUNCATE TABLE rudel.claude_sessions;
-- F16-B07
TRUNCATE TABLE rudel.codex_sessions;
-- F16-B08
TRUNCATE TABLE rudel.session_analytics;
-- F16-B09
TRUNCATE TABLE rudel.session_language_signals;

-- F16-B10: Remove any partial verification stages from a failed run.
DROP TABLE IF EXISTS rudel.session_analytics_f16_rebuilt_identities_20260826 SYNC;
-- F16-B11
DROP TABLE IF EXISTS rudel.session_analytics_f16_expected_rows_20260826 SYNC;

-- operation: data_backfill key=table:rudel.claude_sessions:revision risk=caution
-- Backfill after both materialized views exist so session_analytics receives
-- the exact revision emitted for each canonical raw row. ClickHouse binds
-- INSERT ... SELECT columns positionally, so every target is explicit.
-- Ascending filter_version gives newer filter output the higher ordinal and
-- therefore the winning revision. The remaining full-row tuple is the final
-- deterministic tie-break, so payload-distinct rows never compare equal.
-- The controlled executor expands the two typed placeholders once per
-- F16_BACKFILL_BUCKET_COUNT bucket. organization_id/session_id is immutable
-- and contains every row in a tie partition. N=1 therefore preserves the
-- original whole-source behavior.
-- F16-B12
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
	WHERE modulo(
		cityHash64(`organization_id`, `session_id`),
		{f16_bucket_count:UInt64}
	) = {f16_bucket_id:UInt64}
);

-- operation: data_backfill key=table:rudel.codex_sessions:revision risk=caution
-- Keep the same winner contract for Codex: newer filter output wins first,
-- then every remaining stored value supplies a total content order.
-- F16-B13
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
	WHERE modulo(
		cityHash64(`organization_id`, `session_id`),
		{f16_bucket_count:UInt64}
	) = {f16_bucket_id:UInt64}
);

-- operation: create_table key=table:rudel.session_analytics_f16_rebuilt_identities_20260826 risk=safe
-- Stage the identities actually emitted by the rebuilt MVs. Raw existence is
-- insufficient because the current MV predicate intentionally filters some
-- raw rows.
-- F16-B14
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

-- F16-B15: Freeze the stable analytics identity count expected after replay.
CREATE TABLE rudel.session_analytics_f16_expected_rows_20260826
ENGINE = MergeTree
ORDER BY tuple()
AS
SELECT count() AS expected_rows
FROM
(
	SELECT `source`, `organization_id`, `user_id`, `session_id`
	FROM rudel.session_analytics_f16_rebuilt_identities_20260826

	UNION DISTINCT

	SELECT `source`, `organization_id`, `user_id`, `session_id`
	FROM rudel.session_analytics_f16_backfill_source_20260826
);

-- operation: data_backfill key=table:rudel.session_analytics:revision risk=caution
-- Raw-backed analytics were recreated above by the materialized views with the
-- exact raw revision. Preserve analytics-only history after raw TTL expiry
-- without creating a competing revision for retained raw identities.
-- As for raw history, higher filter_version receives the higher revision; the
-- tuple then orders every remaining payload column deterministically.
-- F16-B16
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
	WHERE modulo(
		cityHash64(`organization_id`, `session_id`),
		{f16_bucket_count:UInt64}
	) = {f16_bucket_id:UInt64}
) AS analytics
LEFT ANTI JOIN
rudel.session_analytics_f16_rebuilt_identities_20260826 AS rebuilt
ON rebuilt.`source` = analytics.`source`
	AND rebuilt.`organization_id` = analytics.`organization_id`
	AND rebuilt.`user_id` = analytics.`user_id`
		AND rebuilt.`session_id` = analytics.`session_id`;

-- F16-B17: A partial analytics insert cannot be mistaken for completion.
SELECT throwIf(
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_analytics
			GROUP BY `source`, `organization_id`, `user_id`, `session_id`
		)
	)
		!= (SELECT any(expected_rows) FROM rudel.session_analytics_f16_expected_rows_20260826),
	'F16 backfill aborted: rebuilt analytics logical identities do not match the frozen expected count'
);

-- operation: data_backfill key=table:rudel.session_language_signals:signal_version risk=caution
-- Existing scans predate raw revisions. Version zero makes them lose to every
-- post-F16 revision while preserving them until reconciliation rescans.
-- Equal historical signal versions would otherwise fall back to insertion
-- order. Keep exactly the lexicographically greatest full-row payload for each
-- identity/scanned-at/scan-version key; exact duplicates are interchangeable.
-- F16-B18
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
	WHERE modulo(
		cityHash64(`organization_id`, `session_id`),
		{f16_bucket_count:UInt64}
	) = {f16_bucket_id:UInt64}
) AS signals
WHERE signals.`dedupe_rank` = 1;

-- F16-B19: Abort before journaling if any stable target identity was lost.
-- Physical counts are intentionally not equality gates here: background
-- ReplacingMergeTree merges can collapse replayed history at any time.
SELECT throwIf(
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	) != (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions_f16_backfill_source_20260826
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	)
	OR (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	) != (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions_f16_backfill_source_20260826
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	)
	OR (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_analytics
			GROUP BY `source`, `organization_id`, `user_id`, `session_id`
		)
	)
		!= (SELECT any(expected_rows) FROM rudel.session_analytics_f16_expected_rows_20260826)
	OR (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_language_signals
			GROUP BY `organization_id`, `session_date`, `session_id`, `source`
		)
	) != (
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.session_language_signals_f16_backfill_source_20260826
				GROUP BY
					organization_id,
					session_date,
					session_id,
					source
			)
		),
	'F16 backfill aborted: one or more canonical logical identity counts do not match the deterministic replay expectation'
);

-- F16-B20: Persist the post-backfill count receipt before cleanup is possible.
INSERT INTO rudel.f16_revision_cutover_postbackfill_verification_20260826
(
	`table_name`,
	`expected_logical_rows`,
	`canonical_logical_rows`,
	`canonical_physical_rows`,
	`verified_at`
)
SELECT
	'claude_sessions' AS table_name,
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions_f16_backfill_source_20260826
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	) AS expected_logical_rows,
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.claude_sessions
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	) AS canonical_logical_rows,
	(SELECT count() FROM rudel.claude_sessions) AS canonical_physical_rows,
	now64(3) AS verified_at
UNION ALL
SELECT
	'codex_sessions',
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions_f16_backfill_source_20260826
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.codex_sessions
			GROUP BY `organization_id`, `session_date`, `session_id`
		)
	),
	(SELECT count() FROM rudel.codex_sessions),
	now64(3)
UNION ALL
SELECT
	'session_analytics',
	(SELECT any(expected_rows) FROM rudel.session_analytics_f16_expected_rows_20260826),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_analytics
			GROUP BY `source`, `organization_id`, `user_id`, `session_id`
		)
	),
	(SELECT count() FROM rudel.session_analytics),
	now64(3)
UNION ALL
SELECT
	'session_language_signals',
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_language_signals_f16_backfill_source_20260826
			GROUP BY
				organization_id,
				session_date,
				session_id,
				source
		)
	),
	(
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.session_language_signals
			GROUP BY `organization_id`, `session_date`, `session_id`, `source`
		)
	),
	(SELECT count() FROM rudel.session_language_signals),
	now64(3);

-- F16-B21: The cleanup checkpoint cannot override a malformed receipt.
SELECT throwIf(
	count() != 4
	OR countIf(expected_logical_rows != canonical_logical_rows) > 0,
	'F16 backfill aborted: durable post-backfill verification is incomplete or reports loss'
)
FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL;

-- F16-B22: Temporary stages are no longer needed. Preservation copies
-- remain until the independently journaled, owner-approved cleanup phase.
DROP TABLE IF EXISTS rudel.session_analytics_f16_rebuilt_identities_20260826 SYNC;
-- F16-B23
DROP TABLE IF EXISTS rudel.session_analytics_f16_expected_rows_20260826 SYNC;
