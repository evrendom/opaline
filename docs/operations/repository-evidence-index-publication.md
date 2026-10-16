# Repository evidence index publication

The evidence commit transaction stores the prepared ClickHouse index JSON on
`repository_evidence_capture`. `index_published_at` remains null until an insert
is acknowledged. Existing captures without prepared JSON are not replayed.

After the durable commit and purge fence, the API attempts publication with a
three-second abort signal. Publication errors do not change the CLI response or
GitHub collection enqueue. There is no per-request continuation; the minute cron
below publishes whatever is still pending.

The minute `/api/cron/r2-ingest` cron (after its R2 ingest retries) and daily
maintenance each run one publisher pass, including when R2 ingest is disabled. A
pass selects up to 500 due captures, oldest first, and publishes them with one
ClickHouse insert under a 60-second budget, so slow inserts do not limit
throughput. A failed insert sets `index_next_attempt_at` one minute ahead for the
whole batch, without marking it published.

Every publication checks account and workspace purge tombstones. Fenced rows
drop their prepared JSON; capture deletion cascades remove publication state.
The existing purge follow-up removes bounded writes already in flight when a
tombstone appears. No new queue or service is required.

Retries reuse the stored row and its original `index_version`. Lost acknowledgments
and overlapping passes can insert duplicates; the existing ReplacingMergeTree
identity makes them safe. Async inserts still wait for their flush acknowledgment
(per `insert-async-small-batches`); no durability settings or ClickHouse schema
change.

Regression coverage lives in
`apps/api/src/__tests__/repository-evidence-fence.integration.ts` and uses real
Postgres and ClickHouse with the existing R2 fixture and a slow executor.

## Setup columns

Since `20261016180000_evidence_setup_snapshot.sql` the prepared row also copies
the capture's setup from its manifest (`capture_reason`, `context_roots`,
`setup_files`, `setup_settings`, `runtime_versions`; see
`apps/api/src/services/repository-evidence-setup.ts`), which the
`setup_snapshots` SQL view reads. Rows prepared before it parse with empty
defaults and publish unchanged. `bun run --cwd apps/api backfill:evidence-setup
--organization-id <id>` (a preview without `--execute`) re-reads those
captures' manifests from R2, adds their setup to the prepared row under a newer
`index_version` and clears `index_published_at`, so the next publisher pass
replaces each capture's index row. It never touches a capture whose prepared
row a purge cleared.
