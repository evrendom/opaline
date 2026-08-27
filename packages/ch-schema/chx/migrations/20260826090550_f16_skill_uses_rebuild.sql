-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:05:50.200Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 4
-- rename-suggestion-count: 0
-- risk-summary: safe=1, caution=2, danger=1

-- F16-SU01: Enforce the controlled executor and its exclusive lease.
SELECT throwIf(
	getSetting('log_comment') != 'rudel-f16-controlled-migration',
	'F16 skill_uses rebuild requires bun run ch:migrate:f16'
);

-- F16-SU02: Validate the exact keyed/versioned UInt64 source before copying.
SELECT throwIf(
	countIf(
		name = 'skill_uses'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND endsWith(engine_full, 'extraction_seq)')
		AND primary_key = 'organization_id, skill_name, agent, user_id, session_id'
		AND sorting_key = 'organization_id, skill_name, agent, user_id, session_id, extraction_seq'
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'non_replicated_deduplication_window = 1000') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND table = 'skill_uses'
			AND name = 'extraction_seq'
			AND type = 'UInt64'
	) != 1
	OR countIf(name = 'skill_uses_f16_uint64_backup_20260826') > 1,
	'F16 skill_uses rebuild source or retry artifact has an unexpected definition'
)
FROM system.tables
WHERE database = 'rudel';

-- operation: drop_table key=table:rudel.skill_uses_f16_uint64_backup_20260826 risk=caution
-- F16-SU03: A pre-exchange retry discards only the incomplete UInt128 copy.
DROP TABLE IF EXISTS rudel.skill_uses_f16_uint64_backup_20260826 SYNC;

-- operation: create_table key=table:rudel.skill_uses_f16_uint64_backup_20260826 risk=safe
-- F16-SU04: Exact pre-F16 engine, key, settings, and comment with UInt128.
CREATE TABLE rudel.skill_uses_f16_uint64_backup_20260826
(
  `organization_id` String,
  `skill_name` String,
  `agent` LowCardinality(String),
  `user_id` String,
  `session_id` String,
  `content_sha256` String,
  `source_content_sha256` FixedString(64),
  `used_at` DateTime64(3, 'UTC'),
  `parser_version` UInt16,
  `extraction_seq` UInt128,
  `extracted_at` DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(extraction_seq)
PRIMARY KEY (`organization_id`, `skill_name`, `agent`, `user_id`, `session_id`)
ORDER BY (`organization_id`, `skill_name`, `agent`, `user_id`, `session_id`, `extraction_seq`)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Versioned session skill uses bound to an exact completed extraction receipt. Mutable usage timestamps and content hashes are excluded from the replacing key.';

-- operation: data_backfill key=table:rudel.skill_uses_f16_uint64_backup_20260826:extraction_seq risk=caution
-- F16-SU05: One synchronous explicit-column copy widens without a key mutation.
INSERT INTO rudel.skill_uses_f16_uint64_backup_20260826
(
	`organization_id`,
	`skill_name`,
	`agent`,
	`user_id`,
	`session_id`,
	`content_sha256`,
	`source_content_sha256`,
	`used_at`,
	`parser_version`,
	`extraction_seq`,
	`extracted_at`
)
SETTINGS async_insert=0
SELECT
	`organization_id`,
	`skill_name`,
	`agent`,
	`user_id`,
	`session_id`,
	`content_sha256`,
	`source_content_sha256`,
	`used_at`,
	`parser_version`,
	toUInt128(`extraction_seq`),
	`extracted_at`
FROM rudel.skill_uses;

-- F16-SU06: Verify all physical rows and keyed versions before the swap.
SELECT throwIf(
	(SELECT count() FROM rudel.skill_uses)
		!= (SELECT count() FROM rudel.skill_uses_f16_uint64_backup_20260826)
	OR (
		SELECT uniqExact(tuple(
			organization_id, skill_name, agent, user_id, session_id, extraction_seq
		))
		FROM rudel.skill_uses
	) != (
		SELECT uniqExact(tuple(
			organization_id, skill_name, agent, user_id, session_id, extraction_seq
		))
		FROM rudel.skill_uses_f16_uint64_backup_20260826
	),
	'F16 skill_uses rebuild copy verification failed'
);

-- operation: exchange_table key=table:rudel.skill_uses risk=danger
-- F16-SU07: Atomic pairwise EXCHANGE handles the sorting/version column safely.
EXCHANGE TABLES
	rudel.skill_uses
	AND rudel.skill_uses_f16_uint64_backup_20260826;

-- RECOVERY: F16-SKILL-REBUILD-AFTER-EXCHANGE
-- F16-SU08: Recovery accepts only the intended UInt128/UInt64 pair.
SELECT throwIf(
	countIf(
		name = 'skill_uses'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND endsWith(engine_full, 'extraction_seq)')
		AND primary_key = 'organization_id, skill_name, agent, user_id, session_id'
		AND sorting_key = 'organization_id, skill_name, agent, user_id, session_id, extraction_seq'
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'non_replicated_deduplication_window = 1000') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR countIf(
		name = 'skill_uses_f16_uint64_backup_20260826'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree')
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'non_replicated_deduplication_window = 1000') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND name = 'extraction_seq'
			AND (
				(table = 'skill_uses' AND type = 'UInt128')
				OR (
					table = 'skill_uses_f16_uint64_backup_20260826'
					AND type = 'UInt64'
				)
			)
	) != 2,
	'F16 skill_uses rebuild exchange is not fully visible'
) AS f16_poll_skill_uses_exchange_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-SU09: Every key/version identity remains present after recovery.
SELECT throwIf(
	(
		SELECT uniqExact(tuple(
			organization_id, skill_name, agent, user_id, session_id, extraction_seq
		))
		FROM rudel.skill_uses
	) != (
		SELECT uniqExact(tuple(
			organization_id, skill_name, agent, user_id, session_id, extraction_seq
		))
		FROM rudel.skill_uses_f16_uint64_backup_20260826
	),
	'F16 skill_uses rebuild post-exchange identity verification failed'
);
