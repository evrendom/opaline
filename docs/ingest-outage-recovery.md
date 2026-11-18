# R2 ingest outage recovery

Known transient dependency failures (including ClickHouse HTTP 502/503/504,
refused/reset connections, timeouts, `no available server`, and the analytics
readiness gate) leave accepted jobs **pending** with
`R2_INGEST_DEPENDENCY_UNAVAILABLE`. The claimed attempt is refunded; unknown
failures still use the existing five-attempt budget, and validation, ownership,
shrink and other permanent rejections still fail immediately.

Retries use persisted decorrelated jitter (1 second minimum, 5 minute cap).
`available_at` and leases never extend past the original `expires_at`. Expiry,
including a failure during processing, records `R2_INGEST_JOB_EXPIRED`. A retry
is allowed even inside the final 30-minute lease window. No schema migration is
needed.

Cleanup excludes unexpired failed jobs carrying a transient error code, both
in its repair selection and before touching R2. Requeue only selects unexpired
transient-failed jobs without a deletion receipt, so the selections are disjoint
even if cleanup loses its transaction. Pending/running jobs are never deleted.

## Workers and CLI

- The resident worker wakes at `available_at`; budget-refunded jobs remain in
  its work census even with zero normal attempts.
- Daily `/api/cron/repair` continues using the same recovery pass. A separate,
  authenticated `/api/cron/r2-ingest` now runs every minute on Vercel, with the
  existing bounded R2 maintenance loop. It needs a Vercel plan permitting
  minute-level crons (Pro/Enterprise), and the existing `CRON_SECRET`.
- Recovery does not depend on client traffic, an in-memory timer, or an inline
  `waitUntil` continuation. There are no existing R2 `waitUntil` entry points.
- Commit reports `SERVICE_UNAVAILABLE` with `R2_INGEST_JOB_RETRY_LATER` after a
  recorded transient failure. The real CLI recognizes that reason and switches
  from its three RPC attempts (500 ms / 1 second sleeps) to status polling.
  Status remains `pending`/`running`, never `failed` for an unexpired transient
  failure. The CLI polls up to 300 times at 1 second intervals and then reports
  a **retryable local timeout**, not successful ingest. Server recovery continues
  independently for multi-hour outages; CLI retry/timeout limits are unchanged.

## Requeue incident jobs

Requires `PG_CONNECTION_STRING`; no working ClickHouse connection is needed.

Preview (read-only, bounded to 100 jobs by default):

```sh
bun apps/api/src/scripts/requeue-failed-ingest-jobs.ts \
  --from 2026-10-01T08:18:59Z --to 2026-10-01T12:00:00Z
```

Inspect the job list and copy the printed cutoff for execution:

```sh
bun apps/api/src/scripts/requeue-failed-ingest-jobs.ts \
  --from 2026-10-01T08:18:59Z --to 2026-10-01T12:00:00Z \
  --execute --cutoff <printed-cutoff>
```

Only failed jobs in the half-open failure-time window, unchanged since the
cutoff, with `objects_deleted_at IS NULL` and an unexpired TTL are eligible.
Execution resets attempts, clears the failure/lease, and marks the job pending
and immediately worker-recoverable, preserving its identity, manifest and TTL.
Repeat bounded runs with `--limit` (1–1000) as needed. Execute rechecks eligibility
under lock; deleted, expired, changed or permanent-error jobs are excluded.
Optionally scope both preview and execution with `--workspace <workspace-id>`
and/or `--user <user-id>`. Each preview job includes both owner IDs.

Legacy `R2_INGEST_TRANSIENT_FAILURE` records discarded the underlying error and
cannot prove that ClickHouse was the cause. They are excluded unless
`--include-legacy` is passed in both preview and execution; preview counts these
unclassified operational failures for review against incident logs. Known
service-unavailable/gateway-timeout codes are also eligible. Already deleted
objects and expired jobs cannot be recovered by this script.
