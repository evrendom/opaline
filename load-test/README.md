# Opaline R2 ingest load-test harness

This opt-in harness generates deterministic synthetic Claude Code or Codex
JSONL and exercises the complete R2 ingest protocol:

`ingest.init` → presigned multipart PUTs → `ingest.commit` → `ingest.status`

It lives in the top-level `load-test/` directory so it does not touch or share
ownership with `apps/api`. It imports no API implementation code and uses no
new runtime dependency. It is intentionally outside the root workspace list,
has no root script, and is not invoked by CI.

## Safety boundary

- The default API target is `http://127.0.0.1:4010`.
- Any non-loopback API or ClickHouse target must use HTTPS, opt in with
  `--allow-remote`, and repeat the exact origin through `--confirm-target` or
  `--confirm-clickhouse-target`.
- API keys and ClickHouse passwords are read from files, not command-line
  values. Keep those files outside the repository with mode `0600`.
- Never point this harness at production. A real Fly-with-flag or Vercel test
  deployment is a deliberate, human-gated pre-cutover step Evren performs.
- The harness does not deploy, change DNS, configure infrastructure, or clean
  up server data. Use an isolated test organization and disposable deployment.

The generated timestamp is never based on wall-clock time. Pass an explicit
`--timestamp-start` that is within the API's accepted window (no more than 366
days old and no more than 15 minutes in the future). Reusing the same seed and
arguments produces byte-identical objects and SHA-256 values.

## Commands

From the repository root:

```bash
bun load-test/src/cli.ts generate --help
bun load-test/src/cli.ts run --help
bun run --cwd load-test verify
```

Generation creates a new directory containing `main.jsonl`, optional subagent
files, and `manifest.json`. The requested size is the exact aggregate byte size
across all objects and is capped at the protocol limit of 128 MiB. Entropy can
be `low`, `medium`, or `high`; `high` uses a seeded 93-character printable
alphabet and is covered by a gzip-resistance test.

Before every run, the driver rechecks every file's length and SHA-256. During a
run it records every RPC and R2 PUT wall time without logging presigned URLs or
credentials. It prints a readable table and writes the full structured result
to `--summary-json` (default `/tmp/opaline-r2-load-test-summary.json`).

For local RSS measurement, pass `--processing-pid` once for each API or worker
PID whose resident memory should be included. The monitor samples and sums the
listed processes. Remote runs use platform memory metrics instead and should
omit the RSS assertion flag from the command.

The `nonTerminalJobs` metric counts jobs for which multipart state was created
but the harness did not observe a terminal `completed` or `failed` status. The
pre-cutover threshold is always zero non-terminal jobs.

This metric does **not** verify R2 object cleanup. The status API does not expose
`objects_deleted_at`, so a completed job can pass this harness even if R2 abort
or delete keeps failing. An operator must verify cleanup after each run against
the isolated deployment: record the bucket object count/listing before the run,
then confirm that no `ingest/<job-id>/` objects from the run remain after the
cleanup worker has settled. As a database-side check, query the real
`ingest_job` fields `id`, `organization_id`, `session_id`, `status`,
`created_at`, and `objects_deleted_at`; scope rows to the test organization,
the manifest session-ID prefix, and the run time window, and require zero rows
with `objects_deleted_at IS NULL`. Preserve the bucket comparison or query
output with the JSON summary. The database marker is useful operational
evidence; a bucket listing is the direct physical-object check.

```sql
SELECT id, organization_id, session_id, status, created_at, objects_deleted_at
FROM ingest_job
WHERE organization_id = '<test-organization-id>'
  AND session_id LIKE '<manifest-session-id>%'
  AND created_at >= TIMESTAMPTZ '<run-start>'
  AND created_at <= TIMESTAMPTZ '<cleanup-check-time>'
  AND objects_deleted_at IS NULL;
```

After the cleanup worker settles, this query must return zero rows for the run.

## A. Single 128 MiB, high entropy, maximum subagents

Validates exact-limit admission, 513-object initialization, presigning and R2
PUT fan-out, one-job materialization, filtering, ClickHouse writes, extraction,
and terminal status. Verify cleanup separately using the operator check above.
Run it once with `--source claude_code`, then generate a second corpus with
`--source codex` to cover both adapters.

```bash
bun load-test/src/cli.ts generate \
  --output /tmp/opaline-load-a-claude \
  --seed phase-c-single-claude-v1 \
  --size-mib 128 \
  --source claude_code \
  --entropy high \
  --subagents 512 \
  --timestamp-lines 4096 \
  --timestamp-start 2026-08-25T12:00:00.000Z

bun load-test/src/cli.ts run \
  --manifest /tmp/opaline-load-a-claude/manifest.json \
  --api-key-file /tmp/opaline-load-test-api-key.secret \
  --organization-id '<test-organization-id>' \
  --scenario-name single-128m-claude \
  --processing-pid '<api-pid>' \
  --max-failures 0 \
  --max-non-terminal-jobs 0 \
  --max-first-commit-p95-ms 180000 \
  --max-e2e-p95-ms 240000 \
  --max-peak-rss-mib 1536 \
  --summary-json /tmp/opaline-load-a-claude-summary.json
```

PASS: 100% completes, zero non-terminal jobs, commit ≤180 seconds, end-to-end
≤240 seconds, and processing peak RSS ≤1.5 GiB. The memory limit preserves at
least 512 MiB of headroom on a 2 GiB process. R2 cleanup is a separate operator
check and is not part of this PASS result.

## B. Four concurrent 128 MiB worst-case uploads

Validates that the 128 MiB/one-active-job gate bounds materialized memory while
queue rejection and retry eventually drain all jobs. `--barrier-before-commit`
finishes all direct R2 uploads before releasing the four commit requests.

```bash
bun load-test/src/cli.ts generate \
  --output /tmp/opaline-load-b \
  --seed phase-c-four-worst-v1 \
  --size-mib 128 \
  --source claude_code \
  --entropy high \
  --subagents 512 \
  --timestamp-lines 4096 \
  --timestamp-start 2026-08-25T12:00:00.000Z

bun load-test/src/cli.ts run \
  --manifest /tmp/opaline-load-b/manifest.json \
  --api-key-file /tmp/opaline-load-test-api-key.secret \
  --organization-id '<test-organization-id>' \
  --scenario-name four-concurrent-worst \
  --uploads 4 \
  --concurrency 4 \
  --barrier-before-commit \
  --commit-attempts 20 \
  --status-wait-ms 120000 \
  --processing-pid '<api-pid>' \
  --max-failures 0 \
  --max-non-terminal-jobs 0 \
  --max-first-commit-p95-ms 240000 \
  --max-e2e-p95-ms 720000 \
  --max-peak-rss-mib 1536 \
  --summary-json /tmp/opaline-load-b-summary.json
```

PASS: all four complete with zero non-terminal jobs, p95 first-commit wall time
≤240 seconds, p95 end-to-end wall time ≤720 seconds, and peak RSS stays ≤1.5 GiB.
Transient gate-full/queue-timeout responses may appear in request measurements,
but none may remain as a final upload failure.

For the lower edge of the demanded range, repeat with `--uploads 2
--concurrency 2`.

## C. Same-session-hash contention burst

Validates cross-instance same-hash serialization and the bounded advisory-lock
path. All jobs use the identical transcript and session ID, all multipart PUTs
finish first, and 32 initial commits are released together. Retries allow jobs
that receive the expected `already processing` or gate-capacity response to
converge to terminal statuses. Verify that their objects were deleted using the
separate operator check above.

```bash
bun load-test/src/cli.ts generate \
  --output /tmp/opaline-load-c \
  --seed phase-c-same-hash-v1 \
  --size-mib 8 \
  --source claude_code \
  --entropy high \
  --subagents 8 \
  --timestamp-lines 512 \
  --timestamp-start 2026-08-25T12:00:00.000Z

bun load-test/src/cli.ts run \
  --manifest /tmp/opaline-load-c/manifest.json \
  --api-key-file /tmp/opaline-load-test-api-key.secret \
  --organization-id '<test-organization-id>' \
  --scenario-name same-hash-32 \
  --uploads 32 \
  --concurrency 32 \
  --same-session-hash \
  --commit-attempts 30 \
  --status-wait-ms 120000 \
  --processing-pid '<api-pid>' \
  --max-failures 0 \
  --max-non-terminal-jobs 0 \
  --max-first-commit-p95-ms 35000 \
  --max-e2e-p95-ms 180000 \
  --max-peak-rss-mib 1536 \
  --summary-json /tmp/opaline-load-c-summary.json
```

PASS: all 32 jobs converge to completed with zero non-terminal jobs, p95 initial
commit returns within 35 seconds (the 30-second bounded queue plus margin), p95
end-to-end is ≤180 seconds, and peak RSS is ≤1.5 GiB. HTTP 503 is acceptable only
on retryable intermediate requests; indefinite waits, connection failures, or
final failures are not.

## D. Sustained small-session / ClickHouse small-parts probe

Schedules 600 operation starts open-loop at fixed offsets from one epoch,
targeting 10 unique sessions/second regardless of when earlier operations
complete. Paced runs are bounded only by `--max-in-flight` (hard-capped at 512
simultaneous jobs so one remote confirmation cannot authorize an unbounded
concurrent blast); `--concurrency` applies to unpaced and commit-barrier runs,
not to this arrival schedule. `--rate-per-second` is rejected in combination
with `--barrier-before-commit` or `--same-session-hash`: barrier runs are
closed-loop and cannot honor an arrival schedule. Each
upload records its planned start offset, actual start offset, and schedule drift.
The summary divides starts by the interval from the epoch through one nominal
spacing after the last actual start, and fails if either arrival-rate or drift
thresholds are missed. The optional observer uses ClickHouse's HTTPS interface
with a read-only query against `system.parts`, an exact database/table filter,
`LIMIT 1`, and explicit scan/result/time caps.

Per `insert-batch-size`, synchronous one-row inserts are unsafe; per
`insert-async-small-batches`, frequent small inserts should be buffered with
`async_insert=1` and acknowledged with `wait_for_async_insert=1`. This scenario
measures the resulting active-part delta rather than assuming those settings
batch effectively.

```bash
bun load-test/src/cli.ts generate \
  --output /tmp/opaline-load-d \
  --seed phase-c-small-parts-v1 \
  --size-bytes 65536 \
  --source claude_code \
  --entropy medium \
  --subagents 0 \
  --timestamp-lines 8 \
  --timestamp-start 2026-08-25T12:00:00.000Z

bun load-test/src/cli.ts run \
  --manifest /tmp/opaline-load-d/manifest.json \
  --api-key-file /tmp/opaline-load-test-api-key.secret \
  --organization-id '<test-organization-id>' \
  --scenario-name sustained-small-10rps \
  --uploads 600 \
  --rate-per-second 10 \
  --max-in-flight 512 \
  --commit-attempts 10 \
  --clickhouse-url 'https://<test-clickhouse-origin>' \
  --clickhouse-user '<read-only-user>' \
  --clickhouse-password-file /tmp/opaline-load-test-clickhouse.secret \
  --allow-remote \
  --confirm-clickhouse-target 'https://<test-clickhouse-origin>' \
  --clickhouse-settle-ms 30000 \
  --processing-pid '<api-pid>' \
  --max-failures 0 \
  --max-non-terminal-jobs 0 \
  --min-achieved-start-rate 9.5 \
  --max-schedule-drift-ms 1000 \
  --max-first-commit-p95-ms 10000 \
  --max-e2e-p95-ms 15000 \
  --max-peak-rss-mib 1024 \
  --max-clickhouse-part-delta 20 \
  --summary-json /tmp/opaline-load-d-summary.json
```

PASS: 600/600 complete with zero non-terminal jobs, achieved start rate is at
least 9.5 starts/second, maximum schedule drift is ≤1 second, first-commit p95
is ≤10 seconds, end-to-end p95 is ≤15 seconds, peak RSS is ≤1 GiB, and the
active `rudel.session_language_signals` part count grows by no more than 20
after a 30-second merge/flush settling interval. Any `TOO_MANY_PARTS` response
is a failure even if later requests recover. R2 cleanup still requires the
separate operator verification documented above.

## Manual pre-cutover matrix

Evren runs A–D against each isolated deployment under test:

1. local/Fly-with-flag test instance, with `--processing-pid`;
2. Vercel test deployment, using `--allow-remote --confirm-target
   'https://<exact-test-origin>'` and platform memory telemetry.

Do not substitute a production origin. Preserve each JSON summary alongside the
deployment revision and platform memory graph. Cutover discussion starts only
after both hosts meet every scenario's thresholds.

For current runtime primitives used here, see Bun's official documentation for
[incremental file I/O](https://bun.sh/docs/runtime/file-io),
[hashing](https://bun.sh/docs/runtime/hashing), and
[streaming fetch](https://bun.sh/docs/runtime/networking/fetch).
