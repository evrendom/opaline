# F16 session revision cutover

This runbook applies cross-instance revision ordering to session ingest. The
production ClickHouse portion is a destructive, owner-operated migration.
Never run the production protocol from CI or a release hook, or while either
Fly or Vercel can accept ordinary uploads. The repository CI workflow has a
separately gated disposable-database rehearsal described in section 4; it is
not a production approval mechanism.

The checked-in migration retains the old tables as
`*_f16_backup_20260826`. Raw session tables are intentionally version-history
tables after F16: their sorting key still contains mutable `session_date`.
Logical-session reads must group by immutable
`(organization_id, user_id, session_id)` identity and select the greatest
`revision`; `FINAL` is not a logical-session boundary.

## Artifacts and rollout order

- PostgreSQL: `packages/sql-schema/db/migrations/0029_tidy_human_fly.sql`
- ClickHouse preservation: `20260826090550_f16_preservation.sql`
- ClickHouse `skill_receipts` rebuild:
  `20260826090550_f16_skill_receipts_rebuild.sql`
- ClickHouse `skill_uses` rebuild:
  `20260826090550_f16_skill_uses_rebuild.sql`
- ClickHouse `skill_version_contents` rebuild:
  `20260826090550_f16_skill_version_contents_rebuild.sql`
- ClickHouse cutover DDL: `20260826090551_auto.sql`
- ClickHouse backfill: `20260826090600_f16_backfill.sql`
- ClickHouse cleanup: `20260826090610_f16_cleanup.sql`
- Controlled executor: `packages/ch-schema/scripts/migrate-f16.ts`
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

Confirm that every F16 operational name is unused before the first preservation
run. This count must be zero; after the first run, use the recovery matrix
instead of this preflight:

```sql
SELECT count() AS preexisting_f16_names
FROM system.tables
WHERE database = 'rudel'
  AND name IN (
    'claude_sessions_f16_backup_20260826',
    'codex_sessions_f16_backup_20260826',
    'session_analytics_f16_backup_20260826',
    'session_language_signals_f16_backup_20260826',
    'claude_sessions_f16_backfill_source_20260826',
    'codex_sessions_f16_backfill_source_20260826',
    'session_analytics_f16_backfill_source_20260826',
    'session_language_signals_f16_backfill_source_20260826',
    'skill_receipts_f16_uint64_backup_20260826',
    'skill_uses_f16_uint64_backup_20260826',
    'skill_version_contents_f16_uint64_backup_20260826',
    'f16_revision_cutover_lease_20260826',
    'f16_revision_cutover_control_20260826',
    'f16_revision_cutover_verification_20260826',
    'f16_revision_cutover_postbackfill_verification_20260826',
    'session_analytics_f16_rebuilt_identities_20260826',
    'session_analytics_f16_expected_rows_20260826'
  );
```

Record physical counts for all four source tables. Then run the executable
future-clock/max-revision gate below. It covers both raw tables and all
analytics backup history, which is a conservative superset of analytics-only
and raw-present/MV-filtered history. `future_rows` must be zero in every scope.

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

## 4. Apply ClickHouse in journaled phases

Review all seven checked-in phase files and the controlled executor immediately
before execution. Stock `bun run ch:migrate` is forbidden for F16. Installed
chkit `0.1.0-beta.16` exposes no client `request_timeout` or distributed-DDL
configuration and hard-codes the ClickHouse client's 30-second default. No
ClickHouse server setting can lengthen a timeout enforced by that client. Each
phase therefore checks `log_comment` and aborts unless it is run by
`bun run ch:migrate:f16`.

The controlled executor sends `wait_end_of_query=1`, `async_insert=0`,
`distributed_ddl_output_mode=throw`, and an explicit
`distributed_ddl_task_timeout`. It also fixes `max_memory_usage`, external-sort
and external-group-by spill thresholds, and the per-query temporary-disk cap.
It polls every configured production writer URL for each named `f16_poll_*`
catalog assertion. Canonical table and MV `CREATE` statements deliberately omit
`IF NOT EXISTS`, so stale metadata fails instead of silently accepting an old
object.

Before topology discovery, journal access, or migration SQL, the executor
creates the fixed table
`rudel.f16_revision_cutover_lease_20260826` without `IF NOT EXISTS`. Its comment
and single data row contain the owner run UUID and acquisition timestamp. The
table remains after a process crash, so another runner fails closed. While
holding the lease, a Cloud run validates the configured replica count with
[`clusterAllReplicas`](https://clickhouse.com/docs/sql-reference/table-functions/cluster)
over `system.one`, then searches
`clusterAllReplicas(<cluster>, system.processes)` for both `query_id` and
`initial_query_id` from older `rudel-f16-*` runs with
`skip_unavailable_shards=0`. If cluster functions are unavailable or any
expected replica is missing, a `cloud-multi-node` run stops. Only the explicitly
local `single-node` mode uses local system tables; ClickHouse documents
[`system.processes`](https://clickhouse.com/docs/operations/system-tables/processes)
as local to one Cloud node. After that wait and before
honoring a preservation approval, the executor recomputes physical and
equal-key/version counts from all four live snapshot tables and compares them
with the durable receipt. A late `TRUNCATE` therefore invalidates the approval
instead of turning an empty snapshot into an accepted baseline.

### 4.1 Size and configure the executor

Measure the longest preservation/backfill `INSERT ... SELECT` on a current
production-volume rehearsal clone. Record every duration and set
`F16_MIGRATION_REQUEST_TIMEOUT_MS` to at least twice the longest measured
statement, and at least 60 seconds greater than the distributed-DDL timeout.
The executor rejects a missing, nonnumeric, or undersized value. Do not choose a
timeout from CI fixture timings.

List every independently routed production writer endpoint in
`F16_CLICKHOUSE_WRITER_URLS` as a comma-separated list. For a remote endpoint the
executor refuses to start without this list. If the service exposes one
load-balanced writer URL, list that URL and retain the provider's
`distributed_ddl_output_mode=throw` acknowledgement as the all-active-host DDL
proof.

```bash
cd packages/ch-schema

export F16_MIGRATION_REQUEST_TIMEOUT_MS='<2x_LONGEST_REHEARSAL_MS>'
export F16_DDL_TASK_TIMEOUT_SECONDS='900'
export F16_CATALOG_BARRIER_TIMEOUT_MS='120000'
export F16_CLICKHOUSE_WRITER_URLS='<WRITER_URL_1>,<WRITER_URL_2>'
export F16_CLICKHOUSE_TOPOLOGY='cloud-multi-node'
export F16_CLUSTER_NAME='default'
export F16_EXPECTED_REPLICA_COUNT='<REVIEWED_ACTIVE_REPLICA_COUNT>'
export F16_MAX_MEMORY_USAGE_BYTES='2147483648'
export F16_MAX_BYTES_BEFORE_EXTERNAL_SORT='268435456'
export F16_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY='268435456'
export F16_MAX_TEMPORARY_DATA_ON_DISK_BYTES='4294967296'
export F16_BACKFILL_BUCKET_COUNT='1'

bun run ch:status
```

`ch:status` must show every earlier migration applied and only the seven named
F16 phase files pending. Stop if any unrelated or prerequisite migration is
pending; the controlled executor intentionally applies only these seven files.

The request timeout is an absolute client deadline. Abort the cutover plan if a
rehearsed statement cannot fit inside a reviewed bounded deadline. The checked-in
fallback is `F16_BACKFILL_BUCKET_COUNT=N`, with `N` from 1 through 4096. The
executor expands B12, B13, B16, and B18 into buckets selected by
`cityHash64(organization_id, session_id) % N`; every row in an immutable-session
tie partition stays in one bucket. `N=1` is the default current behavior. Choose
and rehearse one `N`, record it in the incident artifact, and keep that value on
every retry. A failed backfill reruns from B05-B11 and clears all partial bucket
output before replay. Do not improvise a source split, make the deadline
infinite, or run `OPTIMIZE FINAL`.

The memory and spill settings above are query limits, not capacity promises.
Size them from a production-width rehearsal and verify the service has enough
temporary disk. ClickHouse documents `max_memory_usage`,
`max_bytes_before_external_sort`, `max_bytes_before_external_group_by`, and
`max_temporary_data_on_disk_size_for_query` as
[bounded query controls](https://clickhouse.com/docs/operations/settings/query-complexity).
An unsupported setting is an HTTP error and stops the executor.

### 4.1.1 Stale lease takeover

On a normal return, including a human-checkpoint pause, the owner-verified lease
is dropped in `finally`. If a crash leaves it behind, do not drop it merely
because it is old. Preserve this inventory:

```sql
SELECT name, comment, metadata_modification_time, create_table_query
FROM system.tables
WHERE database = 'rudel'
  AND name = 'f16_revision_cutover_lease_20260826';

SELECT owner_run_id, acquired_at
FROM rudel.f16_revision_cutover_lease_20260826;

SELECT hostName() AS host_name
FROM clusterAllReplicas('<F16_CLUSTER_NAME>', system.one)
SETTINGS skip_unavailable_shards=0;

SELECT hostName(), query_id, initial_query_id, elapsed, query
FROM clusterAllReplicas('<F16_CLUSTER_NAME>', system.processes)
WHERE startsWith(query_id, 'rudel-f16-')
   OR startsWith(initial_query_id, 'rudel-f16-')
SETTINGS skip_unavailable_shards=0;
```

The topology query must return exactly `F16_EXPECTED_REPLICA_COUNT` rows and
distinct hosts; the process query must return no old F16 query. Also prove the
run UUID in the lease comment has no live operator, ingest remains quiesced,
and the journal/state inventories in section 4.4 agree. Attach all evidence to
the incident artifact and obtain a second owner approval. Only then execute:

```sql
DROP TABLE rudel.f16_revision_cutover_lease_20260826 SYNC;
```

Rerun the controlled executor; it reacquires a new lease and repeats the census
and live snapshot validation. There is no automatic TTL or force-takeover flag.

### 4.1.2 Disposable CI protocol

The integration job is the only automated exception to the production
operator protocol. It first runs `ch:migrate:f16:ci-prerequisites`, which applies
and journals every migration strictly before F16 without masking failures. That
script requires the exact literal
`F16_NONPROD_APPLY_PREREQUISITES=ci-only`, `CI=true`, and a local endpoint. It
then runs the normal controlled executor with local single-node topology and
`F16_NONPROD_AUTO_APPROVE_CHECKPOINTS=ci-only`. Each CI checkpoint is created
only after the same live preservation or post-backfill verification used by an
operator succeeds, and its evidence string is explicitly CI-only.

Never set either `F16_NONPROD_*` variable in production, staging against
production data, a release hook, or an operator shell. The executor additionally
rejects auto-approval unless `CI=true`, the endpoint is local, and topology is
`single-node`; these checks are defense in depth, not authorization to relax
this prohibition.

### 4.2 Preservation phase and first checkpoint

Run the controlled executor once:

```bash
bun run ch:migrate:f16
```

The expected result is:

1. `20260826090550_f16_preservation.sql` succeeds and is journaled.
2. The three skill-table rebuild files copy every visible pre-F16 row, verify
   physical and versioned-identity counts, atomically exchange each UInt128
   replacement with its UInt64 source, and are journaled.
3. `20260826090551_auto.sql` aborts at F16-C02 because
   `preservation_verified` is absent.
4. No canonical session table has been renamed. The three UInt64 skill backups
   remain until independently approved cleanup.

The preservation file creates plain `MergeTree` copies at
`*_f16_backfill_source_20260826`, resets each copy before its synchronous
explicit-column copy, and records source/snapshot physical counts plus
equal-complete-key/equal-version group counts in
`f16_revision_cutover_verification_20260826`. It aborts before journaling unless
all four copies contain at least the source rows and tie groups still visible
when verification runs. A larger copy count is retained and owner-reviewed: it
can mean a source background merge completed after the copy started.

Save these exact queries and all rows in the incident artifact:

```sql
SELECT *
FROM rudel.f16_revision_cutover_verification_20260826 FINAL
WHERE phase = 'preservation'
ORDER BY table_name;

SELECT name, applied_at, checksum
FROM _chkit_migrations
WHERE name IN (
  '20260826090550_f16_preservation.sql',
  '20260826090550_f16_skill_receipts_rebuild.sql',
  '20260826090550_f16_skill_uses_rebuild.sql',
  '20260826090550_f16_skill_version_contents_rebuild.sql',
  '20260826090551_auto.sql',
  '20260826090600_f16_backfill.sql',
  '20260826090610_f16_cleanup.sql'
)
ORDER BY name;
```

There is an unavoidable historical limitation: an equal-full-key/equal-version
row already discarded by a pre-snapshot `ReplacingMergeTree` background merge
is physically unrecoverable. The directional source/snapshot check proves that
the preservation copy lost nothing still visible when verification ran; it
cannot reconstruct or even count a row already removed before its copy started.
If a source merge completes after copying, the snapshot can correctly contain
more physical rows or tie groups than the later source count; never discard
those extra preserved rows to force equality. `SYSTEM STOP MERGES` is used only
in the single-node CI rehearsal to prove separate parts coexist and is not
claimed as a service-wide ClickHouse Cloud barrier. The owner must explicitly
accept this limitation in the incident artifact. Do not state that F16
deterministically reconstructs discarded rows.

Only after the directional no-loss counts, any snapshot-greater-than-source
differences, the historical limitation, restore identifiers, and quiescence
evidence are owner-approved, insert exactly this checkpoint with real values:

```sql
INSERT INTO rudel.f16_revision_cutover_control_20260826
  (checkpoint, approved, approved_by, approved_at, evidence_reference)
VALUES
  ('preservation_verified', 1, '<OWNER>', now64(3), '<INCIDENT_ARTIFACT>');
```

The checkpoint is valid only when its `approved_at` is later than every current
preservation receipt row. If an unjournaled preservation phase replays, its new
receipt automatically makes the old approval stale and C02 pauses again.
Every runner restart also rereads the live snapshot tables and rejects a receipt
whose stored snapshot counts no longer match them.

### 4.3 Cutover and restart-safe backfill

Run the same command again:

```bash
bun run ch:migrate:f16
```

The expected result is:

1. preservation is skipped from the journal;
2. the three skill rebuilds are skipped from the journal;
3. cutover DDL completes and is journaled;
4. backfill resets all four new canonical targets, replays all four preservation
   copies, verifies physical counts, and is journaled;
5. cleanup aborts at F16-X02 because `post_backfill_verified` is absent;
6. all four preservation copies, all four rollback backups, and all three UInt64
   skill backups still exist.

The target resets are safe only while the complete section-1 ingest barrier is
still active. Never resume writers between the cutover and cleanup checkpoints.
The post-backfill durable count receipt is
`rudel.f16_revision_cutover_postbackfill_verification_20260826`.

### 4.4 Exact failure/recovery and journal reconciliation

Every statement has an `F16-<phase><number>` marker in the SQL. Record the last
marker reported by the executor, the error, and these inventories before a
rerun:

```sql
SELECT name, engine, sorting_key, metadata_modification_time, create_table_query
FROM system.tables
WHERE database = 'rudel'
  AND (
    name IN (
      'claude_sessions', 'codex_sessions', 'session_analytics',
      'session_language_signals', 'session_analytics_mv',
      'codex_session_analytics_mv',
      'f16_revision_cutover_control_20260826',
      'f16_revision_cutover_verification_20260826',
      'f16_revision_cutover_postbackfill_verification_20260826'
    )
    OR name LIKE '%_f16_backup_20260826'
    OR name LIKE '%_f16_backfill_source_20260826'
    OR name LIKE '%_f16_%_20260826'
  )
ORDER BY name;

SELECT name, applied_at, checksum
FROM _chkit_migrations
WHERE name LIKE '2026082609%'
ORDER BY name;
```

Use this exact matrix. “Rerun” always means rerun `bun run ch:migrate:f16`
with the original reviewed environment and with ingest still quiesced. Its
exclusive lease, topology census, and cluster-wide orphan-query barrier must
pass; never issue manual recovery DDL while a `rudel-f16-*` query is still
active. If the barrier times out, preserve the inventory, wait for
cancellation/completion, and rerun the executor. Before C02/C03 is accepted,
the executor re-derives counts from the live preservation tables rather than
trusting the durable receipt alone.

#### Preservation statements

| Statement | If the client failed after server commit | Recovery |
| --- | --- | --- |
| P01 controlled-executor guard | No object changed. | Set the reviewed executor environment and rerun. |
| P02 pre-cutover-state guard | No object changed. | If any backup exists, stop and use cutover recovery; otherwise rerun. |
| P03 create control table | The compatible control table may exist. | Rerun; `IF NOT EXISTS` accepts only the table created by this phase. |
| P04 create preservation receipt | The compatible receipt table may exist. | Rerun; `IF NOT EXISTS` accepts only the table created by this phase. |
| P05 create Claude copy | The empty Claude copy may exist. | Rerun; P06 validates it before P07 changes data. |
| P06 poll Claude copy | A writer has stale metadata. | Repair routing/convergence and rerun; never bypass the poll. |
| P07 truncate Claude copy | The Claude copy is empty. | Rerun; P08 repopulates it. |
| P08 copy Claude rows | The copy may contain partial or complete parts. | Rerun; P07 clears them before a synchronous recopy. |
| P09 create Codex copy | The empty Codex copy may exist. | Rerun; P10 validates it before P11 changes data. |
| P10 poll Codex copy | A writer has stale metadata. | Repair routing/convergence and rerun. |
| P11 truncate Codex copy | The Codex copy is empty. | Rerun; P12 repopulates it. |
| P12 copy Codex rows | The copy may contain partial or complete parts. | Rerun; P11 clears them first. |
| P13 create analytics copy | The empty analytics copy may exist. | Rerun; P14 validates it before P15 changes data. |
| P14 poll analytics copy | A writer has stale metadata. | Repair routing/convergence and rerun. |
| P15 truncate analytics copy | The analytics copy is empty. | Rerun; P16 repopulates it. |
| P16 copy analytics rows | The copy may contain partial or complete parts. | Rerun; P15 clears them first. |
| P17 create signal copy | The empty signal copy may exist. | Rerun; P18 validates it before P19 changes data. |
| P18 poll signal copy | A writer has stale metadata. | Repair routing/convergence and rerun. |
| P19 truncate signal copy | The signal copy is empty. | Rerun; P20 repopulates it. |
| P20 copy signal rows | The copy may contain partial or complete parts. | Rerun; P19 clears them first. |
| P21 truncate preservation receipt | The receipt is empty. | Rerun; P22 recreates all four rows. |
| P22 write preservation receipt | The receipt may contain partial or complete parts. | Rerun; P21 clears it first. |
| P23 no-loss guard | All copies and receipt rows exist, but a source count or tie-group count exceeds its snapshot count. | Do not approve preservation. Diagnose the loss; rerun rebuilds all copies and the receipt. A larger snapshot is preserved for owner review and is not a failure. |

#### Skill-table rebuild statements

The three files use the same SR/SU/SV suffixes below. They deliberately avoid
`ALTER ... MODIFY COLUMN`: `skill_uses.extraction_seq` is both an ordering-key
column and the `ReplacingMergeTree` version, and a non-empty Shared engine is
the unverified production case. Each file recreates the exact
`20260820170352_auto.sql` engine, primary key, sorting key, settings, and comment
plus the subsequent `20260825093133_auto.sql`
`non_replicated_deduplication_window = 1000` setting, with only
`extraction_seq` widened to `UInt128`.

ClickHouse's [ALTER COLUMN rules](https://clickhouse.com/docs/reference/statements/alter/column)
require data conversion when types are not binary compatible. The rebuild uses
an explicit-column synchronous copy and pre/post identity checks instead. The
[EXCHANGE statement](https://clickhouse.com/docs/reference/statements/exchange)
atomically swaps one pair of names on both Atomic and Shared database engines;
the migration uses exactly one pair per statement. This also avoids the
documented non-atomic behavior of a multi-entity
[RENAME](https://clickhouse.com/docs/reference/statements/rename).
This implements the ClickHouse review rules `schema-pk-plan-before-creation`,
`schema-types-minimize-bitwidth`, and `insert-mutation-avoid-update`: plan a key
transition explicitly, retain the required width, and rebuild rather than
mutating a production key in place.

| Statement suffix | If the client failed after server commit | Recovery |
| --- | --- | --- |
| 01 controlled-executor guard | No object changed. | Set the reviewed executor environment and rerun. |
| 02 exact UInt64 source guard | No object changed. | Reconcile the canonical/backup definitions; do not copy from an unexpected engine, key, or type. |
| 03 drop incomplete replacement | A pre-exchange UInt128 copy is absent. | Rerun; only the incomplete pre-exchange copy can be dropped on this path. |
| 04 create UInt128 replacement | The exact empty replacement may exist. | Rerun; 03 resets it first and 04 has no `IF NOT EXISTS`. |
| 05 explicit synchronous copy | The replacement may contain partial or complete parts. | Rerun; 03 clears it before a new copy. |
| 06 count and versioned-identity guard | No names changed. | Diagnose any mismatch; do not exchange. |
| 07 pairwise atomic exchange | Either the names are unchanged or canonical is UInt128 and backup is UInt64. | Rerun; the executor inspects both column types and resumes after `F16-SKILL-REBUILD-AFTER-EXCHANGE` only for the exact exchanged pair. |
| 08 exchange visibility poll | One writer has not observed the exact pair. | Repair convergence and rerun; do not drop the UInt64 backup. |
| 09 post-exchange identity guard | Both tables remain. | Reconcile the count/identity mismatch before continuing. |

#### Rename, recreate, and MV statements

| Statement | If the client failed after server commit | Recovery |
| --- | --- | --- |
| C01 controlled-executor guard | No object changed. | Set the reviewed executor environment and rerun. |
| C02 preservation checkpoint guard | No object changed. | Complete section 4.2 and append owner approval newer than the current receipt, then rerun. An unjournaled preservation replay makes any older approval stale. |
| C03 preservation receipt guard | No object changed. | Correct the preservation mismatch; approval cannot override it. |
| C04 initial-state guard | No object changed. | Zero backups means restore the four-canonical state; four backups means the executor must use the recovery suffix; one to three is a hard stop. |
| C05 drop old Codex MV | The Codex MV may be absent. | Rerun; C05 is `IF EXISTS`. |
| C06 drop old Claude MV | Both old MVs may be absent. | Rerun; C05-C06 are `IF EXISTS`. |
| C07 poll old-MV absence | A writer still sees an old MV. | Repair convergence and rerun; C05-C06 remain replay-safe. |
| C08 four-table rename | The multi-entity statement may stop after a partial rename. | With zero backups rerun from C01. With four backups rerun: the executor resumes after `F16-CUTOVER-AFTER-RENAME`. One to three backups is a documented hard stop for owner reconciliation because ClickHouse multi-entity `RENAME` is non-atomic. |
| C09 poll safe rename recovery | Four backups exist; a writer is stale, a visible canonical is not an F16 target, an F16 target has active data parts, or the post-backfill receipt table proves B04 was reached. | Repair convergence and rerun. C10-C15 cannot run until this passes. Any evidence that backfill started means journal/state reconciliation, never automatic deletion. |
| C10 drop partial Codex MV | The MV is absent. | Rerun; the recovery drop is `IF EXISTS`. |
| C11 drop partial Claude MV | Both MVs are absent. | Rerun; the recovery drop is `IF EXISTS`. |
| C12 drop partial Claude target | The empty F16 Claude target is absent. | Rerun; C09 already proved it was not the old source. |
| C13 drop partial Codex target | The empty F16 Codex target is absent. | Rerun; the recovery drop is `IF EXISTS`. |
| C14 drop partial analytics target | The empty F16 analytics target is absent. | Rerun; the recovery drop is `IF EXISTS`. |
| C15 drop partial signal target | All canonical names are absent. | Rerun; the recovery drop is `IF EXISTS`. |
| C16 poll rename visibility | Some writer has not converged to four backups and no canonicals/MVs. | Repair convergence and rerun. No canonical CREATE can run until this passes. |
| C20 create Claude target | The empty F16 Claude target may exist. | Rerun; C09 validates it, C12 removes it, and C20 recreates without `IF NOT EXISTS`. |
| C21 create Codex target | Empty F16 Claude/Codex targets may exist. | Rerun; C09-C15 validate and clear all partial targets. |
| C22 create analytics target | Three empty F16 targets may exist. | Rerun; C09-C15 validate and clear all partial targets. |
| C23 create signal target | Four empty F16 targets may exist. | Rerun; C09-C15 validate and clear all partial targets. |
| C24 poll canonical definitions | A writer lacks an exact F16 engine definition. | Repair convergence and rerun; partial targets are safely reconstructed. |
| C25 create Codex MV | The new Codex MV may exist. | Rerun; C09 accepts only F16 canonicals and C10 clears the partial MV before recreation. |
| C26 create Claude MV | Both new MVs may exist. | Rerun; C10-C11 clear and recreate both without `IF NOT EXISTS`. |
| C27 poll MV definitions | A writer lacks an expected MV/dependency. | Repair convergence and rerun. Backfill cannot start and cutover cannot journal until this passes. |

#### Backfill statements

| Statement | If the client failed after server commit | Recovery |
| --- | --- | --- |
| B01 controlled-executor guard | No object changed. | Set the reviewed executor environment and rerun. |
| B02 preservation checkpoint guard | No object changed. | Restore the approved checkpoint; do not backfill without it. |
| B03 target/backup/MV poll | A writer has incomplete target, backup, or MV metadata. | Repair convergence and rerun; no target data has been reset. |
| B04 create post-backfill receipt | The compatible empty receipt table may exist. | Rerun; `IF NOT EXISTS` accepts the phase-created table. |
| B05 truncate post-backfill receipt | The receipt is empty. | Rerun; B20 recreates all four rows. |
| B06 truncate Claude target | Claude is empty; earlier targets are not applicable. | Rerun; B06-B09 reset all targets before DML. |
| B07 truncate Codex target | Claude and Codex are empty. | Rerun; B06-B09 reset all targets. |
| B08 truncate analytics target | Both raw targets and analytics are empty. | Rerun; B06-B09 reset all targets. |
| B09 truncate signal target | All four targets are empty. | Rerun; the full replay starts from preservation copies. |
| B10 drop rebuilt-identity stage | That stage is absent. | Rerun; the drop is `IF EXISTS`. |
| B11 drop expected-count stage | Both stages are absent. | Rerun; the drop is `IF EXISTS`. |
| B12 insert Claude history | Claude and its MV-derived analytics may be partial or complete. | Rerun; B06-B09 clear both targets before replay. |
| B13 insert Codex history | Both raw targets and MV-derived analytics may be partial or complete. | Rerun; B06-B09 clear them before replay. |
| B14 create rebuilt-identity stage | The stage may exist or be partially populated. | Rerun; B10 drops it before recreation. |
| B15 create expected-count stage | Either stage may exist or be partial. | Rerun; B10-B11 drop both before recreation. |
| B16 insert historical analytics | Analytics may contain a partial or complete anti-join replay. | Rerun; B08 clears analytics, raw replay rebuilds MV rows, and both stages are recreated. |
| B17 analytics logical-count guard | Analytics identities do not equal the frozen union. | Do not continue. Diagnose; rerun reconstructs targets and stages from preservation copies. |
| B18 insert historical signals | Signals may be partial or complete. | Rerun; B09 clears signals before deterministic replay. |
| B19 all-target logical-count guard | At least one canonical sorting-key identity is missing or unexpected. | Do not continue. Diagnose; rerun reconstructs every target. Physical row counts may legitimately shrink under background merges and are not equality gates. |
| B20 write post-backfill receipt | The receipt may contain partial or complete parts. | Rerun; B05 clears it before rebuilding all four rows. |
| B21 post-backfill receipt guard | Four durable logical-count rows are not present and equal. | Do not approve cleanup. Diagnose; rerun rebuilds targets and the receipt. |
| B22 drop rebuilt-identity stage | That stage may be absent. | Rerun; the terminal drop is `IF EXISTS`. |
| B23 drop expected-count stage | Both stages may be absent. | Rerun; the terminal drop is `IF EXISTS`; preservation copies remain. |

#### Cleanup statements

| Statement | If the client failed after server commit | Recovery |
| --- | --- | --- |
| X01 controlled-executor guard | No copy changed. | Set the reviewed executor environment and rerun. |
| X02 post-backfill checkpoint guard | No copy changed. | Complete section 6 and append owner approval newer than the current post-backfill receipt, then rerun. An unjournaled backfill replay makes any older approval stale. |
| X03 preservation receipt guard | No copy changed. | Correct the preservation receipt mismatch; approval cannot override it. |
| X04 post-backfill receipt guard | No copy changed. | Correct the logical-count mismatch; approval cannot override it. |
| X05 drop Claude copy | The Claude copy may be absent. | Rerun; X05 is `IF EXISTS`. |
| X06 drop Codex copy | Claude/Codex copies may be absent. | Rerun; X05-X06 are `IF EXISTS`. |
| X07 drop analytics copy | Three copies may be absent. | Rerun; X05-X07 are `IF EXISTS`. |
| X08 drop signal copy | All four copies may be absent. | Rerun; every drop is `IF EXISTS`. |
| X08A drop `skill_receipts` UInt64 backup | The backup may be absent. | Rerun; the drop is `IF EXISTS`. |
| X08B drop `skill_uses` UInt64 backup | Two skill backups may be absent. | Rerun; the drops are `IF EXISTS`. |
| X08C drop `skill_version_contents` UInt64 backup | All three skill backups may be absent. | Rerun; the drops are `IF EXISTS`. |
| X09 poll cleanup visibility | A writer still sees one or more preservation or skill-backup names. | Repair convergence and rerun until every configured writer observes absence. |

The stock chkit journal records a file only after its last statement succeeds;
it has no statement journal. Never manually insert, update, or delete an
`_chkit_migrations` row. The controlled executor supplies the missing recovery
semantics: preservation and backfill reset their mutable outputs, cutover has a
single recovery marker with strict zero-or-four-backup validation, each skill
rebuild has a type-validated post-EXCHANGE marker, and cleanup uses guarded
idempotent drops. It appends the normal chkit checksum only after a phase
completes. The executor rejects an applied later F16 phase after an unapplied
earlier phase. A journal row with a different checksum, an out-of-order phase,
or a migration state outside the matrix is a hard stop for owner review. After
any unjournaled preservation or backfill replay, discard the old approval
operationally: the SQL rejects it by timestamp, and the owner must review the
new receipt and append a newer checkpoint.

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

6. Verify both durable receipts before authorizing evidence cleanup. Save these
   results in the incident artifact:

   ```sql
   SELECT *
   FROM rudel.f16_revision_cutover_verification_20260826 FINAL
   WHERE phase = 'preservation'
     AND (
       source_physical_rows > snapshot_physical_rows
       OR source_equal_key_version_groups > snapshot_equal_key_version_groups
     )
   ORDER BY table_name;

   SELECT *
   FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL
   WHERE expected_logical_rows != canonical_logical_rows
   ORDER BY table_name;
   ```

   Both mismatch queries must return zero rows. Query each table again without
   the mismatch predicate and confirm exactly four receipt rows exist. The
   post-backfill receipt also records `canonical_physical_rows` for diagnosis,
   but does not compare it for equality: background `ReplacingMergeTree`
   merges can validly collapse historical physical versions while this check
   runs.

7. Only after steps 1-6 pass and the owner approves the recorded evidence,
   append the cleanup checkpoint:

   ```sql
   INSERT INTO rudel.f16_revision_cutover_control_20260826
     (checkpoint, approved, approved_by, approved_at, evidence_reference)
   VALUES
     ('post_backfill_verified', 1, '<OWNER>', now64(3), '<INCIDENT_ARTIFACT>');
   ```

   X02 requires this checkpoint timestamp to be later than every current
   post-backfill receipt row. A replayed backfill always requires fresh review.

   Run `bun run ch:migrate:f16` a third time. Only cleanup should run; it drops
   the four preservation copies and three UInt64 skill backups, polls every
   configured writer for their absence, and then journals cleanup. The durable
   receipts, control table, and four session rollback backups remain. Finish
   with `bun run ch:status` and attach its output.

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

All three values must be zero. Then drop the new MVs and poll `system.tables`
through every configured writer URL until both names are absent. Rename all
four canonical tables to unique `*_f16_failed_<timestamp>` names, restore all
four backups, and poll every writer until all canonical names resolve to the
captured pre-F16 engine and sorting-key definitions. Only then recreate the
captured pre-F16 MVs and poll their `create_table_query` and dependencies.
Apply the same bounded one-second retry and overall barrier timeout from
section 4.1; a timeout aborts rollback. Never use this shortcut after smoke or
resume.

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
2. Drop both F16 MVs with `SYNC`, then poll `system.tables` through every
   configured writer URL until both names are absent. Use the bounded barrier
   from section 4.1 and abort rollback on timeout.
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
