-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:05:50.100Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 4
-- rename-suggestion-count: 0
-- risk-summary: safe=1, caution=2, danger=1

-- F16-SR01: Enforce the controlled executor and its exclusive lease.
SELECT throwIf(
	getSetting('log_comment') != 'rudel-f16-controlled-migration',
	'F16 skill_receipts rebuild requires bun run ch:migrate:f16'
);

-- F16-SR02: Require the exact UInt64 source and deterministic equal-version rows.
SELECT throwIf(
	countIf(
		name = 'skill_receipts'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree', 'SharedMergeTree')
		AND (
			startsWith(engine_full, 'ReplacingMergeTree(extraction_seq)')
			OR startsWith(engine_full, 'SharedReplacingMergeTree(extraction_seq)')
		)
		AND primary_key = 'organization_id, agent, user_id, session_id'
		AND sorting_key = 'organization_id, agent, user_id, session_id'
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND table = 'skill_receipts'
			AND name = 'extraction_seq'
			AND type = 'UInt64'
	) != 1
	OR countIf(name = 'skill_receipts_f16_uint64_backup_20260826') > 1
	OR (
		SELECT count()
		FROM
		(
			SELECT 1
			FROM rudel.skill_receipts
			GROUP BY
				organization_id,
				agent,
				user_id,
				session_id,
				extraction_seq
			HAVING uniqExact(tuple(
				source_content_sha256,
				parser_version,
				extracted_at
			)) > 1
		)
	) != 0,
	'F16 skill_receipts rebuild source or retry artifact has an unexpected definition'
)
FROM system.tables
WHERE database = 'rudel';

-- operation: drop_table key=table:rudel.skill_receipts_f16_uint64_backup_20260826 risk=caution
-- F16-SR03: A pre-exchange retry discards only the incomplete UInt128 copy.
DROP TABLE IF EXISTS rudel.skill_receipts_f16_uint64_backup_20260826 SYNC;

-- operation: create_table key=table:rudel.skill_receipts_f16_uint64_backup_20260826 risk=safe
-- F16-SR04: Exact pre-F16 definition with only extraction_seq widened.
CREATE TABLE rudel.skill_receipts_f16_uint64_backup_20260826
(
  `organization_id` String,
  `user_id` String,
  `agent` LowCardinality(String),
  `session_id` String,
  `source_content_sha256` FixedString(64),
  `parser_version` UInt16,
  `extraction_seq` UInt128,
  `extracted_at` DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(extraction_seq)
PRIMARY KEY (`organization_id`, `agent`, `user_id`, `session_id`)
ORDER BY (`organization_id`, `agent`, `user_id`, `session_id`)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000, storage_policy = 's3'
COMMENT 'Latest completed skill extraction run per workspace, user, agent, and session.';

-- operation: data_backfill key=table:rudel.skill_receipts_f16_uint64_backup_20260826:extraction_seq risk=caution
-- F16-SR05: Copy the stable ReplacingMergeTree winners without forcing a merge.
INSERT INTO rudel.skill_receipts_f16_uint64_backup_20260826
(
	`organization_id`,
	`user_id`,
	`agent`,
	`session_id`,
	`source_content_sha256`,
	`parser_version`,
	`extraction_seq`,
	`extracted_at`
)
SETTINGS async_insert=0
SELECT
	`organization_id`,
	`user_id`,
	`agent`,
	`session_id`,
	`source_content_sha256`,
	`parser_version`,
	toUInt128(`extraction_seq`),
	`extracted_at`
FROM rudel.skill_receipts FINAL;

-- F16-SR06: Exact logical rows must match despite lawful background compaction.
SELECT throwIf(
	(
		SELECT count()
		FROM
		(
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				toUInt128(extraction_seq) AS extraction_seq,
				extracted_at
			FROM rudel.skill_receipts FINAL
			EXCEPT DISTINCT
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				extraction_seq,
				extracted_at
			FROM rudel.skill_receipts_f16_uint64_backup_20260826 FINAL
		)
	) != 0
	OR (
		SELECT count()
		FROM
		(
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				extraction_seq,
				extracted_at
			FROM rudel.skill_receipts_f16_uint64_backup_20260826 FINAL
			EXCEPT DISTINCT
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				toUInt128(extraction_seq) AS extraction_seq,
				extracted_at
			FROM rudel.skill_receipts FINAL
		)
	) != 0,
	'F16 skill_receipts rebuild copy verification failed'
);

-- operation: exchange_table key=table:rudel.skill_receipts risk=danger
-- F16-SR07: EXCHANGE is an atomic pairwise name swap; the backup then holds UInt64.
EXCHANGE TABLES
	rudel.skill_receipts
	AND rudel.skill_receipts_f16_uint64_backup_20260826;

-- RECOVERY: F16-SKILL-REBUILD-AFTER-EXCHANGE
-- F16-SR08: Recovery accepts only the intended UInt128/UInt64 pair.
SELECT throwIf(
	countIf(
		name = 'skill_receipts'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree', 'SharedMergeTree')
		AND (
			startsWith(engine_full, 'ReplacingMergeTree(extraction_seq)')
			OR startsWith(engine_full, 'SharedReplacingMergeTree(extraction_seq)')
		)
		AND primary_key = 'organization_id, agent, user_id, session_id'
		AND sorting_key = 'organization_id, agent, user_id, session_id'
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'non_replicated_deduplication_window = 1000') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR countIf(
		name = 'skill_receipts_f16_uint64_backup_20260826'
		AND engine IN ('ReplacingMergeTree', 'SharedReplacingMergeTree', 'SharedMergeTree')
		AND (
			startsWith(engine_full, 'ReplacingMergeTree(extraction_seq)')
			OR startsWith(engine_full, 'SharedReplacingMergeTree(extraction_seq)')
		)
		AND position(create_table_query, 'index_granularity = 8192') > 0
		AND position(create_table_query, 'storage_policy') > 0
		AND position(create_table_query, 's3') > 0
	) != 1
	OR (
		SELECT count()
		FROM system.columns
		WHERE database = 'rudel'
			AND name = 'extraction_seq'
			AND (
				(table = 'skill_receipts' AND type = 'UInt128')
				OR (
					table = 'skill_receipts_f16_uint64_backup_20260826'
					AND type = 'UInt64'
				)
			)
	) != 2,
	'F16 skill_receipts rebuild exchange is not fully visible'
) AS f16_poll_skill_receipts_exchange_visible
FROM system.tables
WHERE database = 'rudel';

-- F16-SR09: Exact logical rows survive an ambiguous exchange response.
SELECT throwIf(
	(
		SELECT count()
		FROM
		(
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				extraction_seq,
				extracted_at
			FROM rudel.skill_receipts FINAL
			EXCEPT DISTINCT
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				toUInt128(extraction_seq) AS extraction_seq,
				extracted_at
			FROM rudel.skill_receipts_f16_uint64_backup_20260826 FINAL
		)
	) != 0
	OR (
		SELECT count()
		FROM
		(
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				toUInt128(extraction_seq) AS extraction_seq,
				extracted_at
			FROM rudel.skill_receipts_f16_uint64_backup_20260826 FINAL
			EXCEPT DISTINCT
			SELECT
				organization_id,
				user_id,
				agent,
				session_id,
				source_content_sha256,
				parser_version,
				extraction_seq,
				extracted_at
			FROM rudel.skill_receipts FINAL
		)
	) != 0,
	'F16 skill_receipts rebuild post-exchange logical verification failed'
);
