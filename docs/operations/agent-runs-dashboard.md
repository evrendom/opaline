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

## Deploy in order

1. Against the intended ClickHouse environment, run:
   `bun run --cwd packages/ch-schema ch:migrate:language-signals`.
   Stop on checksum or schema validation failure. Do not edit a deployed journal
   or replay historical migrations to make it pass. Rerunning this command is safe.
2. Deploy the API/indexing worker, then the web app. The CI migration invocation
   exercises fresh test infrastructure; it does **not** migrate production.
3. Let the existing language-signal reconciliation worker rebuild stale summaries
   to scan version 6. It processes bounded batches (default 25, up to 20 batches,
   with the maintenance deadline). Missing/stale runs display “still being indexed”
   instead of zero; the dashboard polls while indexing.
4. Observe reconciliation logs (`sessions_rescanned`, `sessions_failed`,
   `remaining_lag`, `deadline_stopped`), ClickHouse query latency/read bytes and
   part/merge pressure. Lower `LANGUAGE_SIGNAL_RECONCILE_BATCH_SIZE` if needed;
   keep concurrency at the existing worker level. Verify a known session/run,
   a no-reply run later receiving feedback, and an older session with a recent run.

Historical sessions whose raw transcripts have expired cannot be reconstructed
from summary counts alone. Keep them visibly unknown; do not fabricate zero runs.

Rollback: roll back the application and leave the additive column/data in place.
The old application ignores it. Dropping it would lose the newly indexed facts.
