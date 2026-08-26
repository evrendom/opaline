# F16 session revision cutover

This runbook applies cross-instance revision ordering to session ingest. The
ClickHouse portion is a destructive, owner-operated migration. Never run it in
CI, a release hook, or while either Fly or Vercel can accept ordinary uploads.

The checked-in migration retains the old tables as
`*_f16_backup_20260826`. Raw session tables are intentionally version-history
tables after F16: their sorting key still contains mutable `session_date`.
Logical-session reads must group by immutable
`(organization_id, user_id, session_id)` identity and select the greatest
`revision`; `FINAL` is not a logical-session boundary.

## Artifacts and rollout order

- PostgreSQL: `packages/sql-schema/db/migrations/0029_tidy_human_fly.sql`
- ClickHouse DDL: `20260826090551_auto.sql`
- ClickHouse backfill: `20260826090600_f16_backfill.sql`
- Application: PostgreSQL allocates and commits a decimal revision before that
  exact revision is sent to ClickHouse.
- Vercel maximum function duration: 300 seconds in `vercel.json`. The drain
  below waits 330 seconds: 300 seconds plus a 30-second safety margin.
- R2 job lease duration: 30 minutes. Lease evidence, not row age, determines
  whether a `running` job is active.

Apply PostgreSQL first, then ClickHouse, then the application. The new raw and
analytics revision columns and language-signal raw revision have
ingest-timestamp-derived defaults, so the previous application remains
write-compatible with the F16 ClickHouse schema. The F16 application is not
compatible with ClickHouse before the DDL migration.

Store every command result, timestamp, table count, restore identifier,
watermark, and smoke-session ID in the incident artifact.

## 1. Back up and establish the ingest barrier

1. Take provider backups and record restore identifiers for PostgreSQL and
   ClickHouse. Capture `SHOW CREATE TABLE` for these four tables and both
   analytics materialized views:

   - `claude_sessions`
   - `codex_sessions`
   - `session_analytics`
   - `session_language_signals`
   - `session_analytics_mv`
   - `codex_session_analytics_mv`

2. Generate a high-entropy `SESSION_INGEST_OPERATOR_TOKEN`. Set it and
   `SESSION_INGEST_QUIESCED=true` on both Fly and Vercel. Do not send the token
   to clients or put it in the incident artifact.

   Immediately after the final production runtime accepts the flag, record the
   PostgreSQL clock as `<BARRIER_STARTED_AT_UTC>` and inventory the expiry
   margin of **every** nonterminal R2 job:

   ```sql
   SELECT clock_timestamp() AS barrier_started_at_utc;

   SELECT
     id,
     status,
     attempts,
     max_attempts,
     available_at,
     lease_expires_at,
     expires_at,
     expires_at - clock_timestamp() AS expiry_margin,
     expires_at - interval '30 minutes' AS rescue_deadline
   FROM ingest_job
   WHERE status IN ('pending', 'running')
   ORDER BY expires_at, id;

   SELECT
     count(*) AS nonterminal_jobs,
     min(expires_at) AS earliest_expires_at,
     min(expires_at - interval '30 minutes') AS earliest_rescue_deadline,
     min(expires_at - clock_timestamp()) AS minimum_expiry_margin
   FROM ingest_job
   WHERE status IN ('pending', 'running');
   ```

   Save every row and the exact barrier-start timestamp in the incident
   artifact. The earliest `rescue_deadline` is a hard stop, not an observation:
   choose an operational abort time before it, and do not start a migration
   command that could cross it. If the deadline is already reached or the
   remaining cutover cannot finish before it, keep quiescence enabled, stop new
   migration commands, and enter the expiry-extension rescue in section 7.
   Commit an extension before the deadline, then either safely resume/recover
   (if ClickHouse is untouched) or obtain owner review of forward completion or
   rollback. Never allow the barrier to silently cross the deadline.

3. Drain Fly processes, including legacy requests which have no ledger row:

   - Record every currently running Fly machine ID before deploying the flag.
   - Deploy the flagged release and confirm its health check and environment.
   - Stop every pre-flag machine explicitly with
     `fly machine stop <OLD_MACHINE_ID> --app <FLY_APP>`.
   - `fly machines list --app <FLY_APP>` must show every recorded pre-flag
     machine as `stopped` or destroyed and only flagged-release machines as
     running.
   - Confirm an authenticated legacy upload without the operator header returns
     `session_ingest_quiesced`.

   Stopping the old machines is the active-request barrier for otherwise
   invisible legacy requests. A rolling-deploy completion alone is not proof.

4. Drain Vercel invocations:

   - Deploy the flagged release and promote it to every production alias.
   - Record the alias-promotion timestamp and confirm an authenticated R2 init
     without the operator header returns `session_ingest_quiesced`.
   - Wait **330 seconds after the final alias promotion**. This is derived from
     the configured 300-second `maxDuration` plus a 30-second margin. Restart
     the wait if any alias changes.

5. Classify every R2 job marked `running`; do not filter by age. This inventory
   includes attempts, the lease, the current claim outcome marker, and durable
   canonical-raw-write evidence:

   ```sql
   WITH running_inventory AS (
     SELECT
       job.id,
       job.organization_id,
       job.session_id,
       job.source,
       job.attempts,
       job.max_attempts,
       job.lease_token,
       job.lease_expires_at,
       job.last_error_code,
       job.last_error_message,
       EXISTS (
         SELECT 1
         FROM session_ingest_revision AS revision
         JOIN ingest_processing_ledger AS ledger
           ON ledger.organization_id = revision.organization_id
          AND ledger.session_id = revision.session_id
          AND ledger.filtered_content_sha256 = revision.content_sha256
         JOIN ingest_processing_target_receipt AS receipt
           ON receipt.ledger_id = ledger.id
          AND receipt.target = CASE job.source
            WHEN 'claude_code' THEN 'rudel.claude_sessions'
            ELSE 'rudel.codex_sessions'
          END
         WHERE revision.organization_id = job.organization_id
           AND revision.session_id = job.session_id
           AND revision.operation_id = 'r2:' || job.id
       ) AS canonical_raw_write_recorded,
       clock_timestamp() AS database_now
     FROM ingest_job AS job
     WHERE job.status = 'running'
   )
   SELECT
     *,
     CASE
       WHEN lease_expires_at > database_now THEN 'active_lease'
       WHEN attempts < max_attempts THEN 'stale_retryable_lease'
       WHEN last_error_code IS NULL
        AND last_error_message IS NULL
        AND NOT canonical_raw_write_recorded
         THEN 'stale_interrupted_final_claim_rescue'
       ELSE 'stale_final_claim_requires_review'
     END AS drain_state
   FROM running_inventory
   ORDER BY lease_expires_at, id;

   WITH running_inventory AS (
     SELECT
       job.*,
       EXISTS (
         SELECT 1
         FROM session_ingest_revision AS revision
         JOIN ingest_processing_ledger AS ledger
           ON ledger.organization_id = revision.organization_id
          AND ledger.session_id = revision.session_id
          AND ledger.filtered_content_sha256 = revision.content_sha256
         JOIN ingest_processing_target_receipt AS receipt
           ON receipt.ledger_id = ledger.id
          AND receipt.target = CASE job.source
            WHEN 'claude_code' THEN 'rudel.claude_sessions'
            ELSE 'rudel.codex_sessions'
          END
         WHERE revision.organization_id = job.organization_id
           AND revision.session_id = job.session_id
           AND revision.operation_id = 'r2:' || job.id
       ) AS canonical_raw_write_recorded,
       clock_timestamp() AS database_now
     FROM ingest_job AS job
     WHERE job.status = 'running'
   )
   SELECT
     count(*) FILTER (
       WHERE lease_expires_at > database_now
     ) AS active_running_jobs,
     count(*) FILTER (
       WHERE lease_expires_at <= database_now
         AND attempts < max_attempts
     ) AS stale_retryable_jobs,
     count(*) FILTER (
       WHERE lease_expires_at <= database_now
         AND attempts >= max_attempts
         AND last_error_code IS NULL
         AND last_error_message IS NULL
         AND NOT canonical_raw_write_recorded
     ) AS stale_interrupted_final_claim_rescues,
     count(*) FILTER (
       WHERE lease_expires_at <= database_now
         AND attempts >= max_attempts
         AND (
           last_error_code IS NOT NULL
           OR last_error_message IS NOT NULL
           OR canonical_raw_write_recorded
         )
     ) AS stale_final_claims_requiring_review,
     count(*) AS every_running_job
   FROM running_inventory;
   ```

   `active_running_jobs` and `stale_final_claims_requiring_review` must both be
   zero. Preserve every stale ID and its evidence for repair after resume. A
   `stale_interrupted_final_claim_rescue` is accepted only because the F16
   recovery code reuses the consumed final attempt once without incrementing
   beyond `max_attempts`; it writes
   `R2_INGEST_INTERRUPTED_FINAL_CLAIM_RESCUE` while that rescue is active. A
   processing failure or a second interruption is therefore terminal and
   cannot loop. The application refuses this rescue while
   `SESSION_INGEST_QUIESCED=true`, including operator-token commits: preserve the
   job and its objects throughout the barrier, and let repair rescue it only
   after section 7 lifts quiescence. If canonical-write evidence or any prior
   outcome marker exists, stop for owner review rather than treating the row as
   the cutover rescue. An expired lease alone is not evidence of an active
   writer.

6. Classify **every** processing-ledger row by the exact advisory-lock identity
   used by the application. Run this on a dedicated PostgreSQL connection and
   always reach `ROLLBACK`, which releases the diagnostic transaction locks:

   ```sql
   BEGIN;

   CREATE TEMP TABLE f16_processing_drain_evidence ON COMMIT DROP AS
   SELECT
     id,
     organization_id,
     session_id,
     filtered_content_sha256,
     filter_version,
     created_at,
     updated_at,
     pg_try_advisory_xact_lock(
       hashtextextended(
         concat(
           '[',
           to_json(organization_id)::text, ',',
           to_json(session_id)::text, ',',
           to_json(filtered_content_sha256)::text, ',',
           filter_version::text,
           ']'
         ),
         0
       )
     ) AS lock_was_available
   FROM ingest_processing_ledger
   WHERE status = 'processing';

   SELECT
     *,
     CASE
       WHEN lock_was_available THEN 'stale_no_lock_holder'
       ELSE 'active_lock_holder'
     END AS drain_state
   FROM f16_processing_drain_evidence
   ORDER BY created_at, id;

   SELECT
     count(*) FILTER (WHERE NOT lock_was_available) AS active_processing,
     count(*) FILTER (WHERE lock_was_available) AS stale_processing,
     count(*) AS every_processing_row
   FROM f16_processing_drain_evidence;

   ROLLBACK;
   ```

   `active_processing` must be zero. The JSON construction intentionally has no
   spaces and matches `JSON.stringify([organizationId, sessionId,
   filteredHash, filterVersion])`. Stale rows may remain for retry; after the
   Fly stop and Vercel wait they cannot be active writers.

Do not begin ClickHouse DDL unless steps 3 through 6 all pass.

## 2. Historical revision preflight

Confirm backup names do not exist. Record physical counts for all four source
tables. Then run the executable future-clock/max-revision gate below. It covers
both raw tables and all analytics backup history, which is a conservative
superset of analytics-only and raw-present/MV-filtered history. `future_rows`
must be zero in every scope.

```sql
WITH history AS
(
  SELECT 'claude_raw' AS scope, ingested_at
  FROM rudel.claude_sessions
  UNION ALL
  SELECT 'codex_raw' AS scope, ingested_at
  FROM rudel.codex_sessions
  UNION ALL
  SELECT 'analytics_history' AS scope, ingested_at
  FROM rudel.session_analytics
)
SELECT
  scope,
  countIf(ingested_at > now64(3)) AS future_rows,
  max(ingested_at) AS maximum_ingested_at,
  toString(max(
    bitShiftLeft(toUInt64(toUnixTimestamp64Milli(ingested_at)), 16) + 65535
  )) AS conservative_maximum_revision
FROM history
GROUP BY scope
ORDER BY scope;
```

The current PostgreSQL allocator floor must also exceed the reported global
maximum. This uses the database clock, which is the clock used by the F16
allocator:

```sql
SELECT
  (FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::numeric * 65536)
    AS postgres_revision_floor;
```

Stop if the PostgreSQL floor is not greater than every conservative maximum.
The head-seeding step below is still mandatory; this clock gate does not prove
that a restored or pre-existing head is high enough.

Verify raw tie capacity. Results must be at most 32,768 (even Claude suffixes
and odd Codex suffixes share the 16-bit space):

```sql
SELECT source, max(rows_per_session_millisecond) AS maximum
FROM
(
  SELECT 'claude_code' AS source, count() AS rows_per_session_millisecond
  FROM rudel.claude_sessions
  GROUP BY organization_id, session_id, toUnixTimestamp64Milli(ingested_at)
  UNION ALL
  SELECT 'codex' AS source, count() AS rows_per_session_millisecond
  FROM rudel.codex_sessions
  GROUP BY organization_id, session_id, toUnixTimestamp64Milli(ingested_at)
)
GROUP BY source;
```

Analytics-only history must have at most 65,536 rows per immutable identity and
millisecond:

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

## 3. Apply PostgreSQL

From the reviewed production operator environment:

```bash
bun run --cwd packages/sql-schema migrate
```

Verify `session_ownership.revision_head`,
`session_ownership.last_revision`, `session_ingest_revision`, and
`session_ingest_revision_created_at_idx` exist. The receipt table must be empty
while ingest remains quiesced. These changes are additive; do not roll them
back during an application rollback.

## 4. Apply ClickHouse manually

Review both checked-in migrations immediately before execution. They must keep
all of these properties:

- both analytics MVs are dropped before any source or target rename;
- every propagation boundary uses `SELECT sleepEachRow(1) FROM numbers(8) SETTINGS max_block_size = 1 FORMAT Null` (a single `sleep()` call is capped at three seconds by ClickHouse);
- all canonical tables are created before materialized views;
- raw and analytics use `ReplacingMergeTree(revision)`;
- language signals use `ReplacingMergeTree(signal_version)`, where
  `signal_version` orders by raw revision before scan recency/version;
- every `INSERT ... SELECT` has explicit source/target columns and
  `SETTINGS async_insert=0`;
- neither MV AS-clause contains `--` comments;
- old tables are renamed, never dropped.

Apply from `packages/ch-schema` with production credentials:

```bash
bun run ch:status
bun run ch:migrate
bun run ch:status
```

Do not run `OPTIMIZE FINAL`. If execution fails after a rename, do not rerun
blindly. Keep ingest quiesced, inspect the migration journal and exact table
names, and choose forward completion or rollback.

The backfill uses the fixed staging table
`rudel.session_analytics_f16_rebuilt_identities_20260826`. A failed statement
can leave it behind. In the failure-handling session, first record its exact
metadata and contents:

Run the `system.tables` query first. If it returns no row, record that absence,
skip the stage-content queries, and use the migration journal and canonical or
backup table names to locate the failed boundary.

```sql
SELECT
  database,
  name,
  engine,
  sorting_key,
  total_rows,
  total_bytes,
  metadata_modification_time,
  create_table_query
FROM system.tables
WHERE database = 'rudel'
  AND name = 'session_analytics_f16_rebuilt_identities_20260826';

SELECT
  count() AS physical_rows,
  uniqExact(tuple(source, organization_id, user_id, session_id))
    AS unique_identities
FROM rudel.session_analytics_f16_rebuilt_identities_20260826;

WITH raw_emitted_identities AS
(
  SELECT 'claude_code' AS source, organization_id, user_id, session_id
  FROM rudel.claude_sessions
  WHERE length(content) > 120000000
    OR countSubstrings(content, '\n') > 8000
    OR arrayExists(
      line -> JSONExtractString(line, 'type') IN ('user', 'assistant')
        AND JSONHas(line, 'timestamp'),
      splitByChar('\n', content)
    )
  GROUP BY source, organization_id, user_id, session_id

  UNION DISTINCT

  SELECT 'codex' AS source, organization_id, user_id, session_id
  FROM rudel.codex_sessions
  WHERE length(content) > 120000000
    OR countSubstrings(content, '\n') > 8000
    OR arrayExists(line -> JSONHas(line, 'timestamp'), splitByChar('\n', content))
  GROUP BY source, organization_id, user_id, session_id
)
SELECT 'raw_identity_missing_from_stage' AS failure, count() AS failures
FROM raw_emitted_identities AS raw
LEFT ANTI JOIN rudel.session_analytics_f16_rebuilt_identities_20260826 AS stage
  USING (source, organization_id, user_id, session_id)

UNION ALL

SELECT 'unexpected_identity_in_stage' AS failure, count() AS failures
FROM rudel.session_analytics_f16_rebuilt_identities_20260826 AS stage
LEFT ANTI JOIN raw_emitted_identities AS raw
  USING (source, organization_id, user_id, session_id);
```

The table is reusable only when its schema and creation time match this
incident, `physical_rows = unique_identities`, and both failure counts are
zero. With that recorded proof, forward completion may reuse the stage for the
remaining historical-analytics insert, verify section 6, drop it with
`DROP TABLE rudel.session_analytics_f16_rebuilt_identities_20260826 SYNC`, and
continue with the language-signal insert. If any check fails, preserve the bad
table under an incident-specific evidence name and choose rollback or a
reviewed reconstruction from `raw_emitted_identities`; do not reuse it.

Before a controlled migration-command rerun, reconcile every previously
acknowledged insert, record the checks above, then execute and record:

```sql
DROP TABLE rudel.session_analytics_f16_rebuilt_identities_20260826 SYNC;

SELECT count() AS stage_table_present
FROM system.tables
WHERE database = 'rudel'
  AND name = 'session_analytics_f16_rebuilt_identities_20260826';
```

`stage_table_present` must be zero before the rerun. Never add or rely on a bare
`IF NOT EXISTS`: silently accepting an unverified stage can suppress historical
analytics from a different or partial run.

## 5. Seed and verify PostgreSQL revision heads

Before deploying F16, export the greatest historical revision for every
ownership identity from the rebuilt tables. The analytics table is included so
analytics-only history also raises the head:

```sql
SELECT
  organization_id,
  session_id,
  argMax(user_id, revision) AS user_id,
  toString(max(revision)) AS historical_max_revision
FROM
(
  SELECT organization_id, session_id, user_id, revision
  FROM rudel.claude_sessions
  UNION ALL
  SELECT organization_id, session_id, user_id, revision
  FROM rudel.codex_sessions
  UNION ALL
  SELECT organization_id, session_id, user_id, revision
  FROM rudel.session_analytics
)
GROUP BY organization_id, session_id
FORMAT TSV;
```

Save that output as a protected `f16_session_revision_heads.tsv`, then load it
on PostgreSQL. `\copy` is a `psql` command:

```sql
BEGIN;

CREATE TEMP TABLE f16_session_revision_heads
(
  organization_id text NOT NULL,
  session_id text NOT NULL,
  user_id text NOT NULL,
  historical_max_revision numeric(20, 0) NOT NULL
) ON COMMIT DROP;

\copy f16_session_revision_heads FROM 'f16_session_revision_heads.tsv' WITH (FORMAT text)

SELECT count(*) AS invalid_or_unseedable_heads
FROM f16_session_revision_heads AS seed
LEFT JOIN organization AS org ON org.id = seed.organization_id
LEFT JOIN "user" AS owner ON owner.id = seed.user_id
LEFT JOIN session_ownership AS existing
  ON existing.organization_id = seed.organization_id
  AND existing.session_id = seed.session_id
WHERE seed.historical_max_revision < 0
  OR seed.historical_max_revision >= 9223372036854775807
  OR org.id IS NULL
  OR owner.id IS NULL
  OR (existing.user_id IS NOT NULL AND existing.user_id <> seed.user_id);

-- Stop and ROLLBACK unless invalid_or_unseedable_heads = 0.
INSERT INTO session_ownership
  (organization_id, session_id, user_id, revision_head)
SELECT
  organization_id,
  session_id,
  user_id,
  (historical_max_revision + 1)::bigint
FROM f16_session_revision_heads
ON CONFLICT (organization_id, session_id) DO UPDATE
SET revision_head = GREATEST(
  session_ownership.revision_head,
  EXCLUDED.revision_head
)
WHERE session_ownership.user_id = EXCLUDED.user_id;

SELECT count(*) AS heads_not_above_history
FROM f16_session_revision_heads AS seed
LEFT JOIN session_ownership AS ownership
  ON ownership.organization_id = seed.organization_id
  AND ownership.session_id = seed.session_id
  AND ownership.user_id = seed.user_id
WHERE ownership.revision_head IS NULL
  OR ownership.revision_head::numeric <= seed.historical_max_revision;

-- Stop and ROLLBACK unless heads_not_above_history = 0.
COMMIT;
```

The live allocator uses PostgreSQL `clock_timestamp()` and
`GREATEST(revision_head + 1, database_clock_floor)`. The seed is the guarantee
that a first post-cutover allocation wins even if retained history is ahead of
the wall clock; JavaScript clocks are not used for revision allocation.

## 6. Verify the rebuilt tables

1. `SHOW CREATE TABLE` must show `ReplacingMergeTree(revision)` and
   `revision UInt64` for both raw tables and analytics. It must show
   `ReplacingMergeTree(signal_version)`, `raw_revision UInt64`, and
   `signal_version UInt128` for language signals. The three skill tables must
   use `extraction_seq UInt128`.

2. Verify logical raw cardinality by immutable identity. Run once for Claude
   and once with the two table names changed to Codex:

   ```sql
   SELECT
     (
       SELECT count()
       FROM
       (
         SELECT organization_id, user_id, session_id
         FROM rudel.claude_sessions
         GROUP BY organization_id, user_id, session_id
       )
     ) AS rebuilt_logical_sessions,
     (
       SELECT uniqExact(tuple(organization_id, user_id, session_id))
       FROM rudel.claude_sessions_f16_backup_20260826
     ) AS expected_logical_sessions;
   ```

   The values must match. This deliberately does not use `FINAL` and does not
   include mutable `session_date` in logical identity.

3. Check the suffix range and source parity separately. All four results must
   be zero:

   ```sql
   SELECT count() AS invalid_claude_suffixes
   FROM
   (
     SELECT
       toInt128(revision)
         - bitShiftLeft(toInt128(toUnixTimestamp64Milli(ingested_at)), 16)
         AS suffix
     FROM rudel.claude_sessions
   )
   WHERE suffix NOT BETWEEN 0 AND 65534 OR modulo(suffix, 2) != 0;

   SELECT count() AS invalid_codex_suffixes
   FROM
   (
     SELECT
       toInt128(revision)
         - bitShiftLeft(toInt128(toUnixTimestamp64Milli(ingested_at)), 16)
         AS suffix
     FROM rudel.codex_sessions
   )
   WHERE suffix NOT BETWEEN 1 AND 65535 OR modulo(suffix, 2) != 1;

   WITH raw_revisions AS
   (
     SELECT
       'claude_code' AS source,
       organization_id,
       user_id,
       session_id,
       revision
     FROM rudel.claude_sessions
     UNION ALL
     SELECT
       'codex' AS source,
       organization_id,
       user_id,
       session_id,
       revision
     FROM rudel.codex_sessions
   )
   SELECT count() AS invalid_analytics_only_suffixes
   FROM
   (
     SELECT
       toInt128(analytics.revision)
         - bitShiftLeft(
           toInt128(toUnixTimestamp64Milli(analytics.ingested_at)), 16
         ) AS suffix
     FROM rudel.session_analytics AS analytics
     LEFT ANTI JOIN raw_revisions AS raw
       USING (source, organization_id, user_id, session_id, revision)
   )
   WHERE suffix NOT BETWEEN 0 AND 65535;

   SELECT count() AS duplicate_session_revisions
   FROM
   (
     SELECT source, organization_id, user_id, session_id, revision, count() copies
     FROM
     (
       SELECT 'claude_code' source, organization_id, user_id, session_id, revision
       FROM rudel.claude_sessions
       UNION ALL
       SELECT 'codex' source, organization_id, user_id, session_id, revision
       FROM rudel.codex_sessions
     )
     GROUP BY source, organization_id, user_id, session_id, revision
     HAVING copies > 1
   );
   ```

4. Run bidirectional analytics completeness. The expected side combines every
   historical analytics identity with every raw identity that the current MV
   predicate can actually emit. This catches both a missing raw-derived row and
   a raw-present/MV-filtered historical identity lost by a bad anti-join.

   ```sql
   WITH
   raw_emitted AS
   (
     SELECT
       'claude_code' AS source,
       organization_id,
       user_id,
       session_id,
       revision
     FROM rudel.claude_sessions
     WHERE length(content) > 120000000
       OR countSubstrings(content, '\n') > 8000
       OR arrayExists(
         line -> JSONExtractString(line, 'type') IN ('user', 'assistant')
           AND JSONHas(line, 'timestamp'),
         splitByChar('\n', content)
       )

     UNION ALL

     SELECT
       'codex' AS source,
       organization_id,
       user_id,
       session_id,
       revision
     FROM rudel.codex_sessions
     WHERE length(content) > 120000000
       OR countSubstrings(content, '\n') > 8000
       OR arrayExists(line -> JSONHas(line, 'timestamp'), splitByChar('\n', content))
   ),
   raw_emitted_winners AS
   (
     SELECT source, organization_id, user_id, session_id, max(revision) revision
     FROM raw_emitted
     GROUP BY source, organization_id, user_id, session_id
   ),
   expected_identities AS
   (
     SELECT source, organization_id, user_id, session_id
     FROM rudel.session_analytics_f16_backup_20260826
     UNION DISTINCT
     SELECT source, organization_id, user_id, session_id
     FROM raw_emitted_winners
   ),
   actual_winners AS
   (
     SELECT source, organization_id, user_id, session_id, max(revision) revision
     FROM rudel.session_analytics
     GROUP BY source, organization_id, user_id, session_id
   )
   SELECT 'expected_missing_from_rebuilt' AS failure, count() AS failures
   FROM expected_identities AS expected
   LEFT ANTI JOIN actual_winners AS actual
     USING (source, organization_id, user_id, session_id)

   UNION ALL

   SELECT 'unexpected_rebuilt_identity' AS failure, count() AS failures
   FROM actual_winners AS actual
   LEFT ANTI JOIN expected_identities AS expected
     USING (source, organization_id, user_id, session_id)

   UNION ALL

   SELECT 'raw_emitted_revision_mismatch' AS failure, count() AS failures
   FROM raw_emitted_winners AS raw
   LEFT ANTI JOIN actual_winners AS actual
     USING (source, organization_id, user_id, session_id, revision);
   ```

   Every `failures` value must be zero. Inspect representative Claude, Codex,
   analytics-only, MV-filtered-with-history, and same-millisecond identities
   with `argMax(tuple(...), revision)`.

5. Repeat the future/max query from section 2 against the rebuilt tables and
   verify PostgreSQL heads remain strictly above each per-session historical
   maximum. Confirm product and reconciliation queries use one composite
   language-signal state weighted by `signal_version`, never independent
   `scanned_at` aggregates.

## 7. Record cutover watermarks, smoke, and resume

Before the first operator smoke request, record a watermark for **all three**
revision-bearing tables. Save the exact decimal strings in the incident
artifact; rollback uses them as replay boundaries.

```sql
SELECT 'claude_sessions' AS table_name, toString(maxOrDefault(revision)) watermark
FROM rudel.claude_sessions
UNION ALL
SELECT 'codex_sessions', toString(maxOrDefault(revision))
FROM rudel.codex_sessions
UNION ALL
SELECT 'session_analytics', toString(maxOrDefault(revision))
FROM rudel.session_analytics;
```

1. Deploy the F16 application to flagged Fly and Vercel runtimes. Keep
   `SESSION_INGEST_QUIESCED=true` globally.
2. Use an authenticated operator request with
   `x-rudel-session-ingest-operator-token: <SESSION_INGEST_OPERATOR_TOKEN>`.
   Smoke one Claude and one Codex session through Fly legacy ingest. Smoke the
   Vercel R2 route by sending the header on both `/rpc/ingest/init` and
   `/rpc/ingest/commit`. Ordinary requests remain closed throughout.
3. For every smoke session verify one receipt, identical raw/analytics
   revision, exact-retry revision reuse, a larger revision for a distinct
   operation, revision-first language signals, and session detail at the
   greatest decimal revision.
4. Before quiescence lifts, extend every pending/running R2 job by the actual
   elapsed barrier interval. Normally
   `<EXPIRY_EXTENSION_CHECKPOINT_AT>` is the recorded
   `<BARRIER_STARTED_AT_UTC>`. If the section-1 expiry rescue already committed
   an extension, use that extension's recorded database timestamp as the new
   checkpoint so every elapsed interval is applied exactly once and the sum of
   the intervals equals the full barrier duration.

   Run this as one PostgreSQL transaction and attach every returned row:

   ```sql
   BEGIN;

   WITH extension_clock AS MATERIALIZED (
     SELECT clock_timestamp() AS extended_at
   ), extended AS (
     UPDATE ingest_job AS job
     SET
       expires_at = job.expires_at + (
         extension_clock.extended_at
         - timestamptz '<EXPIRY_EXTENSION_CHECKPOINT_AT>'
       ),
       updated_at = extension_clock.extended_at
     FROM extension_clock
     WHERE job.status IN ('pending', 'running')
     RETURNING
       job.id,
       job.status,
       job.attempts,
       job.max_attempts,
       job.expires_at,
       extension_clock.extended_at AS expiry_extension_checkpoint_at
   )
   SELECT * FROM extended ORDER BY expires_at, id;

   COMMIT;
   ```

   Immediately verify the new lease-safe margin:

   ```sql
   SELECT
     count(*) AS nonterminal_jobs,
     min(expires_at) AS earliest_expires_at,
     min(expires_at - clock_timestamp()) AS minimum_expiry_margin,
     count(*) FILTER (
       WHERE expires_at <= clock_timestamp() + interval '30 minutes'
     ) AS jobs_without_full_lease_margin
   FROM ingest_job
   WHERE status IN ('pending', 'running');
   ```

   `jobs_without_full_lease_margin` must be zero. Record the committed
   `expiry_extension_checkpoint_at`. If deployment or review delays lifting
   quiescence, repeat this step once for the new interval using that checkpoint;
   never rerun an already recorded interval. The application helper
   `extendNonterminalR2IngestJobExpiries` performs the same bounded update for
   operator tooling and integration verification.
5. Set `SESSION_INGEST_QUIESCED=false`, remove
   `SESSION_INGEST_OPERATOR_TOKEN`, deploy/promote both platforms, and monitor
   allocation latency, ClickHouse failures, receipt cleanup, stale R2 repair,
   and language-signal reconciliation lag.
6. Keep all four backup tables and the three watermarks until the owner approves
   cleanup after the observation window.

## Rollback posture

If only the application fails, re-enable quiescence, repeat the full platform
drain in section 1, deploy the previous application, and leave the additive
PostgreSQL changes and F16 ClickHouse schema in place.

### Full rollback without replay

**Hard precondition:** attach recorded evidence that the section-2 global
PostgreSQL clock floor was strictly above every reported historical maximum and
that the section-5 `heads_not_above_history` result was zero for the protected
head export used in this cutover. If either gate was waived, failed, or cannot
be proven from the incident artifact, stop and produce a reviewed full-history
reconstruction plan. Watermark replay is invalid without both gates: a new raw
row can be above its raw watermark but below an analytics-only historical
watermark, so raw replay restores it while analytics replay omits its MV-derived
analytics row with the old MVs still absent.

This is permitted **only before the first operator smoke request and before
global resume**. Prove no accepted write crossed any watermark:

```sql
SELECT
  (SELECT count() FROM rudel.claude_sessions
   WHERE revision > toUInt64('<CLAUDE_WATERMARK>')) AS claude_post_cutover,
  (SELECT count() FROM rudel.codex_sessions
   WHERE revision > toUInt64('<CODEX_WATERMARK>')) AS codex_post_cutover,
  (SELECT count() FROM rudel.session_analytics
   WHERE revision > toUInt64('<ANALYTICS_WATERMARK>')) AS analytics_post_cutover;
```

All three values must be zero. Then drop the new MVs, wait eight seconds,
rename all four canonical tables to unique `*_f16_failed_<timestamp>` names,
restore all four backups, wait eight seconds, and recreate the captured pre-F16
MVs. Never use this shortcut after smoke or resume.

### Full rollback after any accepted post-watermark write

**Hard precondition:** attach recorded evidence that the section-2 global
PostgreSQL clock floor was strictly above every reported historical maximum and
that the section-5 `heads_not_above_history` result was zero for the protected
head export used in this cutover. If either gate was waived, failed, or cannot
be proven from the incident artifact, do not run the replay below; produce a
reviewed replay boundary or full-history reconstruction plan instead. Watermark
replay is invalid without both gates: a new raw row can be above its raw
watermark but below an analytics-only historical watermark, causing raw replay
to restore it while analytics replay omits its MV-derived analytics row with
the old MVs deliberately absent.

1. Set quiescence and repeat the complete Fly/Vercel/job/ledger drain from
   section 1.
2. Drop both F16 MVs with `SYNC`; wait eight seconds.
3. Rename all four canonical tables to unique `*_f16_failed_<timestamp>` names.
4. Restore all four `*_f16_backup_20260826` tables to canonical names. Do **not**
   recreate the old MVs yet; raw replay must not generate duplicate analytics.
5. Replay every row above its table watermark with explicit columns and
   synchronous inserts. Replace the failed-table suffix and watermark strings
   below with the recorded values.

   ```sql
   INSERT INTO rudel.claude_sessions
   (
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, content,
     filter_version, ingested_at, user_id, git_branch, git_sha, tag, subagents
   )
   SETTINGS async_insert=0
   SELECT
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, content,
     filter_version, ingested_at, user_id, git_branch, git_sha, tag, subagents
   FROM rudel.claude_sessions_f16_failed_<timestamp>
   WHERE revision > toUInt64('<CLAUDE_WATERMARK>');

   INSERT INTO rudel.codex_sessions
   (
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, content,
     filter_version, ingested_at, user_id, git_branch, git_sha, tag
   )
   SETTINGS async_insert=0
   SELECT
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, content,
     filter_version, ingested_at, user_id, git_branch, git_sha, tag
   FROM rudel.codex_sessions_f16_failed_<timestamp>
   WHERE revision > toUInt64('<CODEX_WATERMARK>');

   INSERT INTO rudel.session_analytics
   (
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, filter_version,
     ingested_at, user_id, git_branch, git_sha, tag, source, skills,
     slash_commands, subagent_types, input_tokens, output_tokens,
     cache_read_input_tokens, cache_creation_input_tokens, total_tokens,
     total_interactions, actual_duration_min, avg_period_sec, median_period_sec,
     quick_responses, normal_responses, long_pauses, error_count, error_pattern,
     model_used, has_commit, session_archetype, success_score, used_plan_mode,
     inference_duration_sec, human_duration_sec
   )
   SETTINGS async_insert=0
   SELECT
     session_date, last_interaction_date, session_id, organization_id,
     project_path, git_remote, package_name, package_type, filter_version,
     ingested_at, user_id, git_branch, git_sha, tag, source, skills,
     slash_commands, subagent_types, input_tokens, output_tokens,
     cache_read_input_tokens, cache_creation_input_tokens, total_tokens,
     total_interactions, actual_duration_min, avg_period_sec, median_period_sec,
     quick_responses, normal_responses, long_pauses, error_count, error_pattern,
     model_used, has_commit, session_archetype, success_score, used_plan_mode,
     inference_duration_sec, human_duration_sec
   FROM rudel.session_analytics_f16_failed_<timestamp>
   WHERE revision > toUInt64('<ANALYTICS_WATERMARK>');
   ```

6. Replay derived language-signal rows whose raw revision crossed the matching
   raw-table watermark. The restored pre-F16 table has neither `raw_revision`
   nor `signal_version`, so omit both explicitly:

   ```sql
   INSERT INTO rudel.session_language_signals
   (
     organization_id, session_date, session_id, user_id, source,
     raw_ingested_at, scan_version, member_swears, member_apologies,
     member_positive, model_swears, model_apologies, model_positive, scanned_at
   )
   SETTINGS async_insert=0
   SELECT
     organization_id, session_date, session_id, user_id, source,
     raw_ingested_at, scan_version, member_swears, member_apologies,
     member_positive, model_swears, model_apologies, model_positive, scanned_at
   FROM rudel.session_language_signals_f16_failed_<timestamp>
   WHERE (source = 'claude_code'
       AND raw_revision > toUInt64('<CLAUDE_WATERMARK>'))
     OR (source = 'codex'
       AND raw_revision > toUInt64('<CODEX_WATERMARK>'));
   ```

7. Verify every post-watermark failed-table projection is present in the
   restored table. These are one-way replay-completeness checks because restored
   tables legitimately also contain pre-cutover history:

   ```sql
   SELECT count() AS missing_claude_replay
   FROM
   (
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, content,
       filter_version, ingested_at, user_id, git_branch, git_sha, tag, subagents
     FROM rudel.claude_sessions_f16_failed_<timestamp>
     WHERE revision > toUInt64('<CLAUDE_WATERMARK>')
     EXCEPT DISTINCT
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, content,
       filter_version, ingested_at, user_id, git_branch, git_sha, tag, subagents
     FROM rudel.claude_sessions
   );

   SELECT count() AS missing_codex_replay
   FROM
   (
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, content,
       filter_version, ingested_at, user_id, git_branch, git_sha, tag
     FROM rudel.codex_sessions_f16_failed_<timestamp>
     WHERE revision > toUInt64('<CODEX_WATERMARK>')
     EXCEPT DISTINCT
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, content,
       filter_version, ingested_at, user_id, git_branch, git_sha, tag
     FROM rudel.codex_sessions
   );

   SELECT count() AS missing_analytics_replay
   FROM
   (
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, filter_version,
       ingested_at, user_id, git_branch, git_sha, tag, source, skills,
       slash_commands, subagent_types, input_tokens, output_tokens,
       cache_read_input_tokens, cache_creation_input_tokens, total_tokens,
       total_interactions, actual_duration_min, avg_period_sec,
       median_period_sec, quick_responses, normal_responses, long_pauses,
       error_count, error_pattern, model_used, has_commit, session_archetype,
       success_score, used_plan_mode, inference_duration_sec, human_duration_sec
     FROM rudel.session_analytics_f16_failed_<timestamp>
     WHERE revision > toUInt64('<ANALYTICS_WATERMARK>')
     EXCEPT DISTINCT
     SELECT
       session_date, last_interaction_date, session_id, organization_id,
       project_path, git_remote, package_name, package_type, filter_version,
       ingested_at, user_id, git_branch, git_sha, tag, source, skills,
       slash_commands, subagent_types, input_tokens, output_tokens,
       cache_read_input_tokens, cache_creation_input_tokens, total_tokens,
       total_interactions, actual_duration_min, avg_period_sec,
       median_period_sec, quick_responses, normal_responses, long_pauses,
       error_count, error_pattern, model_used, has_commit, session_archetype,
       success_score, used_plan_mode, inference_duration_sec, human_duration_sec
     FROM rudel.session_analytics
   );
   ```

   All three counts must be zero. Also compare logical winner counts and inspect
   every smoke-session ID.

8. Recreate the two captured pre-F16 MVs only after replay verification. Deploy
   the previous application, run language-signal reconciliation, verify
   representative sessions, then resume.

Keep the failed tables until the owner separately approves deletion.
PostgreSQL heads and receipts are additive and must never be deleted during
emergency rollback. The daily bounded maintenance pass deletes receipts older
than 30 days during normal operation.
