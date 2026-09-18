# Agent runs dashboard rollout

This is product analytics over revisioned session summaries. One summary stores
all observed response cycles in that raw session revision; a subsequent upload
replaces it. Language signals keeps its original phrase-frequency semantics
and remains a separate tab.

## ClickHouse review

- **Official — additive schema:** `ADD COLUMN … DEFAULT []` changes metadata;
  old parts read the default without an immediate rewrite. The runner checks the
  journal checksum and the actual column type/default on both apply and rerun.
  See [ADD COLUMN](https://clickhouse.com/docs/sql-reference/statements/alter/column#add-column).
- **Official — revisioned writes:** per `insert-mutation-avoid-update`, reuse
  `SharedReplacingMergeTree(signal_version)` and read current summaries with
  `FINAL`. Never sum unmerged versions. No `ALTER UPDATE`, eager materialization,
  or forced `OPTIMIZE FINAL` backfill (`insert-optimize-avoid-final`).
- **Official — bounded keys and ingestion:** the organization-first sorting key
  and monthly/365-day retention stay unchanged. Filters precede joins; `ANY LEFT
  JOIN` prevents multiplication (`query-join-filter-before`, `query-join-use-any`).
  Existing small writes use `async_insert=1, wait_for_async_insert=1`
  (`insert-async-small-batches`).
- **Derived — typed facts:** timestamps remain UTC with millisecond precision,
  skill presence uses UInt8, duration preserves fractional seconds. A negative
  duration means unknown, distinct from measured zero (`schema-types-native-types`,
  `schema-types-avoid-nullable`). The tuple keeps model and feedback as String for
  compatibility with this revisioned summary contract; feedback is validated by
  the shared application union. Enum8 feedback and LowCardinality models are
  possible storage optimizations (`schema-types-enum`, `schema-types-lowcardinality`),
  deferred until cardinality/bytes are measured. This is an explicit tradeoff.
- **Derived — no incremental count MV:** replacing a summary can change a run's
  feedback from no reply to positive/negative. An insert-triggered aggregate would
  need correction/retraction handling. Expanding the latest summary avoids that
  extra pipeline. See [ReplacingMergeTree](https://clickhouse.com/docs/guides/replacing-merge-tree).

Production-scale backfill and query latency have not been benchmarked. A long
session may contribute runs after its opening date, so queries deliberately do
not restrict summary reads to sessions opened within the selected date range.
Organization filters and query read/time/result caps remain enforced.

The current web client sends its active metric with each request. The API still
returns all four headline totals, but expands detailed dimensions only for that
metric. Requests from older clients that omit the selector keep the original
all-details response during a staged rollout.

## Deploy in order

1. Production Vercel builds run
   `bun run --cwd packages/ch-schema ch:migrate:language-signals` before type
   checking or building. The command uses the ClickHouse credentials injected
   into the production build; preview builds skip it. A checksum or exact
   type/default validation failure fails the candidate before smoke testing and
   promotion. Rerunning the command is safe. CI's isolated migration invocation
   still validates fresh infrastructure; it does **not** migrate production.
2. Deploy the API/indexing worker, then the web app. For a non-Vercel environment,
   run the same migration command against that environment before deploying the
   API. Do not edit a deployed journal or replay historical migrations to make it
   pass.
3. Let the existing language-signal reconciliation worker rebuild stale summaries
   to scan version 6. It processes bounded batches (default 25, up to 20 batches,
   with the maintenance deadline). The dashboard keeps valid indexed runs visible
   and separately reports sessions that are still indexing. If the current raw
   revision is no longer retained, it reports the session as unavailable to
   index. The web app retries twice with backoff and then offers manual refresh;
   it does not poll indefinitely.
4. Observe reconciliation logs (`sessions_rescanned`, `sessions_failed`,
   `remaining_lag`, `deadline_stopped`), ClickHouse query latency/read bytes and
   part/merge pressure. Lower `LANGUAGE_SIGNAL_RECONCILE_BATCH_SIZE` if needed;
   keep concurrency at the existing worker level. Verify a known session/run,
   a no-reply run later receiving feedback, and an older session with a recent run.

Historical sessions whose raw transcripts have expired cannot be reconstructed
from summary counts alone. Keep them visibly unknown; do not fabricate zero runs.

## Bounded load measurement

Measure on a representative nonproduction clone before enabling a large
backfill. Local fixtures prove behavior but do not represent production part
counts, compression, storage latency, or merge pressure.

1. Export that clone's normal `CLICKHOUSE_*` variables. Run exactly one stale
   discovery/content scan/write plus the lag count, recording wall time:

   ```sh
   time (cd apps/api && bun --eval 'const { reconcileSessionLanguageSignalsOnce } = await import("./src/services/session-language-signal-reconciliation.service.ts"); console.log(await reconcileSessionLanguageSignalsOnce(1))')
   ```

2. Immediately read the finished stale-discovery queries from ClickHouse's query
   log. This command only prints timing/read/memory counters and is capped to the
   ten most recent rows. The representative clone must have `system.query_log`
   enabled; the isolated local test config does not create that table, so local
   runs can validate behavior and wall time but not these server counters:

   ```sh
   (cd apps/api && bun --eval 'const { getClickhouse } = await import("./src/clickhouse.ts"); const ch = getClickhouse(); await ch.execute({ query: "SYSTEM FLUSH LOGS" }); console.log(await ch.query({ query: `SELECT query_duration_ms, read_rows, read_bytes, memory_usage, result_rows FROM system.query_log WHERE event_time >= now() - INTERVAL 10 MINUTE AND type = {queryType:String} AND positionCaseInsensitive(query, {marker:String}) > 0 AND positionCaseInsensitive(query, {queryLog:String}) = 0 ORDER BY query_start_time_microseconds DESC LIMIT 10 SETTINGS max_execution_time = 10`, query_params: { queryType: "QueryFinish", marker: "raw_sessions AS", queryLog: "system.query_log" } })); await ch.close()')
   ```

3. On a disposable clone, repeat with batch sizes `5` and `25`. Compare discovery
   `read_rows`/`read_bytes` and wall time, plus write/merge pressure. Stop if the
   existing 30-second/10-GB discovery caps or the maintenance deadline are close.
   Batch size bounds rows rebuilt, but it does not bound the aggregate scan used
   to discover stale identities, so measure both discovery and content work.

Rollback: roll back the application and leave the additive column/data in place.
The old application ignores it. Dropping it would lose the newly indexed facts.
