# L1 backfill runbook

How to bring existing production data up to the L1 stack ([spec](l1-literal-schema.md)): transcript records at the current parser, git observations, edges and the run index. Every script here runs from `apps/api` with the production `CLICKHOUSE_*` and `PG_CONNECTION_STRING` in the environment, is a preview unless given `--execute`, and (except the transcript backfill, which keeps its own flags) must name its scope: `--organization-id <id>`, or `--all-organizations` on purpose. A preview reads and writes nothing; `audit:l1` never writes, with or without flags.

| Script | Writes | Bounds and throttles |
|---|---|---|
| `backfill:transcript-records` | new transcript-records generations, then git observations; queues edges at backfill priority | `--execute --cutoff <printed by the preview>`, `--organization-id`, `--max-sessions` (census cap, default 10,000), `--batch-max-rows`, `--batch-max-bytes`, `--max-session-bytes`, `--max-rows`, `--session-timeout-ms` |
| `retire:transcript-records` | lightweight DELETEs of superseded generations past the 10-minute grace | `--max-sessions` (default 10,000; `hasMore` when more remain), `--page-size` (sessions per DELETE, default 25, max 100), `--pause-ms` (between DELETEs, default 500) |
| `backfill:l1-edges` | `l1_edge_scope` requests (priority 1) | `--max-sessions` per run (default 10,000, max 100,000), `--after <next>` to continue; repositories are queued by the first run only |
| `backfill:run-index` | `run_index` scope requests (priority 1) | `--max-sessions` per run (default 10,000, max 100,000), `--after <next>` to continue |
| `audit:l1` | nothing | `--json`, `--compare <before.json>`; every statement within the analysis bounds |

The worker only builds what is queued, live requests (priority 0) first, and only while `L1_EDGES_WORKER_ENABLED=true` (minute cron, 240-second budget). Requests stay queued while it is off.

## 1. Merge and deploy

Merge the stack in order, each deployed and healthy before the next: the edge tables and queue, the session and GitHub-side builds, parser 6 schema and parsers 6 to 8, git extractor 4, the edge reads (`find`), the run index schema and builder, then this branch (retirement drain, run index backfill, edge census, audit). A production deploy applies the Postgres migrations first (Vercel workflow) and the ClickHouse migrations in the build (`ch:migrate:production`, which includes `ch:migrate:l1-edges` and `ch:migrate:run-index`). Keep `L1_EDGES_WORKER_ENABLED` unset (off) through the merges. From this branch on, the daily maintenance also runs `l1-edge-census`; it only queues requests.

## 2. Audit before

```bash
bun run audit:l1 --organization-id $ORG --json > audit-$ORG-0-before.json
bun run audit:l1 --organization-id $ORG          # the same, as text
```

Keep every `--json` report. To see what a step changed, compare the newest report with the one before it:

```bash
bun run audit:l1 --organization-id $ORG --compare audit-$ORG-0-before.json
# or: diff <(jq -S . audit-$ORG-0-before.json) <(jq -S . audit-$ORG-1-transcripts.json)
```

`--compare` prints `path before -> after (delta)` for every number that changed (`--json` with it prints the changes as JSON). Breakdowns are keyed by value (`transcripts.committedByParser.claude_code.v8.sessions`), so paths stay stable between reports. A section that hits its bounds reports `error` and the others still run; narrow to one organization rather than raising bounds. `storage` is whole-table and lags deletes until ClickHouse merges the parts.

## 3. Transcript records: one organization

```bash
bun run backfill:transcript-records --organization-id $ORG                 # preview, prints cutoff
bun run backfill:transcript-records --organization-id $ORG --execute --cutoff <cutoff>
```

The execute run prints when the generations it superseded become retirable (10 minutes after it finishes). Then:

```bash
bun run retire:transcript-records --organization-id $ORG                   # preview
bun run retire:transcript-records --organization-id $ORG --execute
```

Repeat the execute run until it reports `sessionCount: 0` and `hasMore: false` (a session published in the last 10 minutes waits for the next run). Then audit and compare:

- `transcripts.committedByParser.*.v8.sessions` holds (almost) every session; older versions are left only for skipped sessions.
- `transcripts.totals.supersededGenerations` back near 0.
- `transcriptFacts.rowsByParser.*.v8.agentVersionShare` high (it is per row, so prompts without a version lower it; compare organizations, not to 100%).
- `gitObservations.bySource.*.current` up, `staleTranscript` near 0. If `staleTranscript` or `staleExtractor` stays high, run `backfill:git-observations` (preview, then `--execute --cutoff`).

## 4. Enable the worker

Set `L1_EDGES_WORKER_ENABLED=true` on the Vercel API project. Before any backfill, watch a day of live traffic: `edgeScopes.due.session.priority0.oldestSeconds` stays in minutes, `failing` and `parked` stay rare.

## 5. Edges

```bash
bun run backfill:l1-edges --organization-id $ORG                           # preview
bun run backfill:l1-edges --organization-id $ORG --execute
bun run backfill:l1-edges --organization-id $ORG --execute --after <next>  # while it prints next
```

Wait for the queue to drain (`edgeScopes.due.*.priority1.scopes` falls to 0), then audit: `edgeScopes.byState.session.built.v2` up, `edges.byRelation` populated, `resolutions` mostly `linked`, `unbound` or `no_repository`.

## 6. Run index

```bash
bun run backfill:run-index --organization-id $ORG                          # preview
bun run backfill:run-index --organization-id $ORG --execute
bun run backfill:run-index --organization-id $ORG --execute --after <next> # while it prints next
```

It queues every session whose committed transcript has no current run index, edges or not; sessions already waiting are left alone. After the queue drains: `runIndex.missing` and `runIndex.stale` near 0 (frozen sessions over 200,000 records stay missing by design), `usageIncomplete` small.

## 7. Audit after

```bash
bun run audit:l1 --organization-id $ORG --json > audit-$ORG-9-after.json
bun run audit:l1 --organization-id $ORG --compare audit-$ORG-0-before.json
```

## 8. Roll out per organization

Repeat steps 2, 3, 5, 6 and 7 one organization at a time, smallest first, then the largest ones alone. Use `--all-organizations` only for the tail of small workspaces, and only once a run per organization has been clean.

Throttles, in order of reach:

- Smaller runs: `--max-sessions` (and `--after`) for the queueing backfills; `--batch-max-rows`, `--batch-max-bytes` for the transcript backfill; `--page-size` and a longer `--pause-ms` for retirement.
- `L1_EDGES_WORKER_ENABLED=false`: stops all builds, live included; requests stay queued and resume when it is back.
- `L1_EDGES_ENQUEUE_ENABLED=false`: no new edge requests from ingest, extraction or the censuses (live sessions then rely on the census once it is back on).
- `L1_EDGES_FIND_READ=false`: `find` ignores the edges and links at query time, if edge output looks wrong.
- `GIT_OBSERVATION_EXTRACTION_ENABLED=false`, `TRANSCRIPT_RECORDS_EXTRACTION_ENABLED=false`: stop the derived writes of ingest (uploads stay accepted).

## Stop when

- The transcript backfill exits with code 2 (`failedCount > 0`), or `skippedCount` is more than 1% of `candidateCount`: read `issues` before going on.
- `retire:transcript-records` keeps reporting `sessionsHeld > 0` for the same sessions on runs more than 10 minutes apart (unreadable receipts), or a DELETE fails.
- `edgeScopes.due.*.priority0.oldestSeconds` passes 15 minutes: live builds are falling behind. Stop queueing; turn the worker off if it keeps growing.
- `failing` plus `parked` exceed 1% of a kind's scopes, or grow between two audits: read `last_error` in `l1_edge_scope` before queueing more.
- `edgeScopes.truncatedSessionBuilds` grows by more than a few sessions: builds hit their evidence caps.
- `runIndex.usageIncomplete` or `usageUnreceipted` rises after the run index backfill: usage extraction is incomplete for those sessions.
- Any audit section returns `error` that it did not return before, ClickHouse reports memory or row-limit errors for API reads, or `find` errors or latency rise.

## Daily maintenance afterwards

The daily maintenance keeps it current without operators: `transcript-records` and `run-index` retire superseded generations (ten sessions each a day; a backfill needs `retire:transcript-records`), `run-index-census` queues run index builds for sessions ingested in the last 14 days, and `l1-edge-census` re-queues edge builds of sessions with observations or captures from the last 14 days whose scope is missing, unbuilt or stale (generation or resolver version), and repository scopes missing for active bindings. Older sessions are the backfills'.
