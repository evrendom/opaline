# A pinned transcript generation is read as a constant key set pruned by revision

Every read of a session's transcript records names its committed generation (session, revision, parser version) as a constant key set, `(session_id, revision, parser_version) IN arrayZip(...)`, next to `revision IN` and `parser_version IN` sets of the same values. The generations module emits this form; no reader writes its own. ClickHouse uses the plain sets to seek to the generation inside `transcript_records`' primary key, and the tuple set keeps the exact pairing.

We chose this because the form decides how many superseded generations a read scans, and that number grows with every change to a live session. The tuple set alone does not prune by revision, so run-index builds read every stored generation of a live session (4.4M rows for 75k needed on one session). An IN subquery prunes, but ClickHouse re-runs it at every CTE reference in the build statements, which made #406 move to the constant form. Measured on a local workspace on 2026-11-16, the constant form with the plain sets read about 40% fewer rows, bytes and memory than the subquery form at equal or lower time, with identical rows.

## Considered Options

- Tuple set alone: rejected; it cannot prune by revision.
- IN subquery over the same tuples: rejected; prunes, but is evaluated at every reference and read 1.6× the rows.
- Revision outside the key so a session has one living generation: deferred to the append-only import, which changes what a generation is.

## Consequences

- `transcript-generations.integration.ts` fails if a pinned read touches more granules than its generation needs, and the run-index statement test checks both plain sets.
- A new store keyed by generation gets its filter from the generations module rather than writing one.
