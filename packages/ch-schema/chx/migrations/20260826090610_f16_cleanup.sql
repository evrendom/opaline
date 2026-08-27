-- chkit-migration-format: v1
-- generated-at: 2026-08-26T09:06:10.000Z
-- cli-version: 0.1.0-beta.16
-- definition-count: 12
-- operation-count: 4
-- rename-suggestion-count: 0
-- risk-summary: safe=0, caution=4, danger=0

-- F16-X01: Enforce the controlled executor with an explicit request timeout.
SELECT throwIf(
	getSetting('log_comment') != 'rudel-f16-controlled-migration',
	'F16 cleanup requires bun run ch:migrate:f16; stock chkit is not supported'
);

-- F16-X02: Cleanup is fail-closed until the owner approves all section-6 proof.
SELECT throwIf(
	coalesce(maxIf(approved, checkpoint = 'post_backfill_verified'), 0) != 1
	OR coalesce(
		maxIf(approved_at, checkpoint = 'post_backfill_verified'),
		toDateTime64(0, 3, 'UTC')
	) <= (
		SELECT max(verified_at)
		FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL
	),
	'F16 cleanup paused: preservation copies remain until post_backfill_verified is approved'
)
FROM rudel.f16_revision_cutover_control_20260826 FINAL;

-- F16-X03: Approval cannot override a bad preservation receipt.
SELECT throwIf(
	count() != 4
	OR countIf(source_physical_rows > snapshot_physical_rows) > 0
	OR countIf(
		source_equal_key_version_groups > snapshot_equal_key_version_groups
	) > 0,
	'F16 cleanup aborted: preservation verification is incomplete or reports loss'
)
FROM rudel.f16_revision_cutover_verification_20260826 FINAL
WHERE phase = 'preservation';

-- F16-X04: Approval also cannot override a bad post-backfill receipt.
SELECT throwIf(
	count() != 4
	OR countIf(expected_logical_rows != canonical_logical_rows) > 0,
	'F16 cleanup aborted: post-backfill verification is incomplete or reports loss'
)
FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL;

-- F16-X05: IF EXISTS makes every terminal drop replay-safe.
DROP TABLE IF EXISTS rudel.claude_sessions_f16_backfill_source_20260826 SYNC;
-- F16-X06
DROP TABLE IF EXISTS rudel.codex_sessions_f16_backfill_source_20260826 SYNC;
-- F16-X07
DROP TABLE IF EXISTS rudel.session_analytics_f16_backfill_source_20260826 SYNC;
-- F16-X08
DROP TABLE IF EXISTS rudel.session_language_signals_f16_backfill_source_20260826 SYNC;

-- F16-X09: Journal only after every writer path observes cleanup completion.
SELECT throwIf(
	countIf(name IN (
		'claude_sessions_f16_backfill_source_20260826',
		'codex_sessions_f16_backfill_source_20260826',
		'session_analytics_f16_backfill_source_20260826',
		'session_language_signals_f16_backfill_source_20260826'
	)) != 0,
	'F16 cleanup visibility barrier: one or more preservation copies remain visible'
) AS f16_poll_cleanup_visible
FROM system.tables
WHERE database = 'rudel';
