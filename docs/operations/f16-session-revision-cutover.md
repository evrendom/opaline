# F16 session revision cutover

This runbook applies cross-instance revision ordering to session ingest. The
ClickHouse portion is a destructive, owner-operated migration. Never run it in
CI, a release hook, or while either Fly or Vercel can accept session uploads.

The checked-in migration preserves the old raw and analytics tables as
`*_f16_backup_20260826`. Do not remove those backups during this cutover.

## Artifacts and rollout order

- PostgreSQL: `packages/sql-schema/db/migrations/0028_tidy_human_fly.sql`
- ClickHouse DDL: `20260826090551_auto.sql`
- ClickHouse backfill: `20260826090600_f16_backfill.sql`
- Application: a revision is allocated in PostgreSQL, its transaction commits,
  and only then is that exact revision inserted into ClickHouse.

Apply PostgreSQL first, then ClickHouse, then the application. The new
ClickHouse column has an `ingested_at`-derived default, so the previous
application remains write-compatible during rollback. The new application is
not compatible with ClickHouse before the DDL migration.

No concrete deferred retention/partition rebuild specification exists in
`.context/plans`. F16 therefore preserves the current monthly raw partitions
and 365-day TTL. A future rebuild needs a separate reviewed specification.

## 1. Prepare and quiesce ingest

1. Take provider backups and record restore identifiers for PostgreSQL and
   ClickHouse. Capture `SHOW CREATE TABLE` output for the three tables and two
   materialized views changed by F16.
2. Set `SESSION_INGEST_QUIESCED=true` in both Fly and Vercel and complete the
   required deployments. Confirm both legacy ingest and R2 init return
   `session_ingest_quiesced`.
3. Wait for in-flight work to drain. Both queries must return zero before DDL:

   ```sql
   SELECT count(*)
   FROM ingest_job
   WHERE status = 'running';

   SELECT count(*)
   FROM ingest_processing_ledger
   WHERE status = 'processing'
     AND updated_at > now() - interval '15 minutes';
   ```

4. Record pre-cutover ClickHouse counts for `claude_sessions`,
   `codex_sessions`, and `session_analytics`. Confirm the backup table names do
   not already exist.
5. Verify the deterministic tie space. Each result must be at most 32,768:

   ```sql
   SELECT source, max(rows_per_session_millisecond) AS maximum
   FROM
   (
     SELECT
       'claude_code' AS source,
       count() AS rows_per_session_millisecond
     FROM rudel.claude_sessions
     GROUP BY organization_id, session_id,
       toUnixTimestamp64Milli(ingested_at)

     UNION ALL

     SELECT
       'codex' AS source,
       count() AS rows_per_session_millisecond
     FROM rudel.codex_sessions
     GROUP BY organization_id, session_id,
       toUnixTimestamp64Milli(ingested_at)
   )
   GROUP BY source;
   ```

   The analytics-only history backfill has a full 16-bit suffix. This query
   must return at most 65,536:

   ```sql
   SELECT max(rows_per_session_millisecond) AS maximum
   FROM
   (
     SELECT count() AS rows_per_session_millisecond
     FROM rudel.session_analytics
     GROUP BY source, organization_id, user_id, session_id,
       toUnixTimestamp64Milli(ingested_at)
   );
   ```

   Also stop if any retained `ingested_at` is in the future. Live allocations
   start at the current epoch millisecond shifted left by 16 bits and must be
   above the historical backfill range.

## 2. Apply PostgreSQL

From the reviewed production operator environment:

```bash
bun run --cwd packages/sql-schema migrate
```

Verify `session_ownership.revision_head`,
`session_ownership.last_revision`, and `session_ingest_revision` exist. The new
table must be empty while ingest remains quiesced. This migration is additive;
do not roll it back during an application rollback.

## 3. Apply ClickHouse manually

Review the two checked-in migration files immediately before execution. They
must retain all of these properties:

- materialized views are dropped before their source/target tables are renamed;
- each propagation boundary uses `SELECT sleep(8)`;
- canonical tables are created before materialized views;
- raw and analytics engines are `ReplacingMergeTree(revision)`;
- every `INSERT ... SELECT` has an explicit target and source column list and
  `SETTINGS async_insert=0`;
- no migration statement uses positional `SELECT *` for backfill;
- the old tables are renamed, not dropped.

Apply from `packages/ch-schema` with production ClickHouse credentials:

```bash
bun run ch:status
bun run ch:migrate
bun run ch:status
```

`ch:migrate` applies the DDL and backfill files in order. It includes the
required eight-second waits before rename, before materialized-view creation,
and before backfill. Do not run `OPTIMIZE FINAL` as part of the cutover.

If the command fails after a rename, do not blindly rerun it. Keep ingest
quiesced, inspect the migration journal and exact table names, and choose
forward completion or the rollback below.

## 4. Verify before application deploy

1. `SHOW CREATE TABLE` must report `ReplacingMergeTree(revision)` for both raw
   tables and `session_analytics`. Confirm `revision UInt64` exists in all
   three, `raw_revision UInt64` exists in `session_language_signals`, and the
   three skill tables use `extraction_seq UInt128`.
2. Confirm raw logical cardinality survived the rebuild. Run the matching query
   for Claude and Codex; both values on each row must match:

   ```sql
   SELECT
     (SELECT count() FROM rudel.claude_sessions FINAL) AS rebuilt_rows,
     (SELECT uniqExact(tuple(organization_id, session_date, session_id))
      FROM rudel.claude_sessions_f16_backup_20260826) AS expected_rows;
   ```

3. Confirm revision derivation stayed inside its allocated 16-bit suffix and
   produced no duplicate per-session revisions:

   ```sql
   SELECT count() AS invalid_revisions
   FROM
   (
     SELECT organization_id, session_id, revision, count() AS copies
     FROM
     (
       SELECT organization_id, session_id, revision
       FROM rudel.claude_sessions
       UNION ALL
       SELECT organization_id, session_id, revision
       FROM rudel.codex_sessions
     )
     GROUP BY organization_id, session_id, revision
     HAVING copies > 1
   );
   ```

   `invalid_revisions` must be zero.
4. Raw-retained analytics must use the exact corresponding raw revision.
   Analytics-only identities are expected when their raw transcript expired;
   the migration preserves those directly from the analytics backup.

   ```sql
   WITH raw AS
   (
     SELECT 'claude_code' AS source, organization_id, user_id, session_id, revision
     FROM rudel.claude_sessions
     UNION ALL
     SELECT 'codex' AS source, organization_id, user_id, session_id, revision
     FROM rudel.codex_sessions
   ),
   raw_identities AS
   (
     SELECT source, organization_id, user_id, session_id
     FROM raw
     GROUP BY source, organization_id, user_id, session_id
   )
   SELECT count() AS mismatched_raw_backed_analytics_rows
   FROM rudel.session_analytics AS analytics
   INNER JOIN raw_identities AS identity
     USING (source, organization_id, user_id, session_id)
   LEFT JOIN raw
     USING (source, organization_id, user_id, session_id, revision)
   WHERE raw.revision IS NULL
   SETTINGS join_use_nulls=1;
   ```

   `mismatched_raw_backed_analytics_rows` must be zero. Also verify
   `session_analytics FINAL` has the same distinct
   `(source, organization_id, user_id, session_id)` count as the union of the
   analytics backup and rebuilt raw identities. Then compare representative
   Claude, Codex, analytics-only, and same-millisecond sessions using
   `argMax(..., revision)`.
5. Confirm the application queries contain no winner selection ordered by
   `ingested_at`; it is observability-only after F16.

## 5. Deploy and resume

1. Deploy the F16 application to Fly and Vercel while ingest remains quiesced.
2. Upload one Claude and one Codex session from each runtime. Temporarily clear
   quiescence only for the controlled smoke test if the platform cannot route
   an operator-only request.
3. For each smoke session, verify:
   - `session_ingest_revision` has one receipt;
   - the raw and analytics rows carry that same revision;
   - retrying the same R2 job and content hash reuses the receipt and revision;
   - a distinct operation receives a larger revision;
   - session detail returns the content at the largest revision.
4. Restore `SESSION_INGEST_QUIESCED=false` in both runtimes and monitor ingest
   failures, revision allocation latency, ClickHouse insert failures, and
   language-signal reconciliation lag.
5. Retain all three backup tables until the owner approves a separate cleanup
   migration after the observation window.

## Rollback posture

If only the application fails, set `SESSION_INGEST_QUIESCED=true`, deploy the
previous application, and leave both additive PostgreSQL changes and the F16
ClickHouse schema in place. The revision defaults keep old writers compatible.

For a ClickHouse data or DDL failure, keep ingest quiesced:

1. Drop both new materialized views with `SYNC`, then wait eight seconds.
2. Rename the three new canonical tables to unique `*_f16_failed_*` names; do
   not drop them.
3. Rename the three `*_f16_backup_20260826` tables back to their canonical
   names, then wait eight seconds.
4. Recreate the two pre-F16 materialized views from the captured `SHOW CREATE`
   output, never from an unreviewed historical migration replay.
5. Deploy the previous application and verify representative sessions before
   clearing quiescence.

PostgreSQL revision receipts may remain. They are additive and harmless to the
old application. Never delete them as part of emergency rollback.
