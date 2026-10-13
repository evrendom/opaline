# L1 backfill runbook

How to bring existing production data up to the L1 stack ([spec](l1-literal-schema.md)): transcript records at the current parser, git observations, edges and the run index. Every script here runs from `apps/api` with the production `CLICKHOUSE_*` and `PG_CONNECTION_STRING` in the environment, is a preview unless given `--execute`, and (except the transcript backfill, which keeps its own flags) must name its scope: `--organization-id <id>`, or `--all-organizations` on purpose. A preview reads and writes nothing; `audit:l1` never writes, with or without flags.

| Script | Writes | Bounds and throttles |
|---|---|---|
| `backfill:transcript-records` | new transcript-records generations, then git observations; queues edges at backfill priority | `--execute --cutoff <printed by the preview>`, `--organization-id`, `--max-sessions` (census cap, default 10,000), `--batch-max-rows`, `--batch-max-bytes`, `--max-session-bytes`, `--max-rows`, `--session-timeout-ms` |
| `retire:transcript-records` | lightweight DELETEs of superseded generations past the 10-minute grace | `--max-sessions` (default 10,000; `hasMore` when more remain), `--page-size` (sessions per DELETE, default 25, max 100), `--pause-ms` (between DELETEs, default 500) |
| `backfill:l1-edges` | `l1_edge_scope` requests (priority 1) | `--max-sessions` per run (default 10,000, max 100,000), `--after <next>` to continue; repositories are queued by the first run only |
| `backfill:run-index` | `run_index` scope requests (priority 1) | `--max-sessions` per run (default 10,000, max 100,000), `--after <next>` to continue |
| `backfill:transcript-search` | search chunks, hits and OpenAI embeddings of past sessions ([section 7b](#7b-transcript-search-history)) | `--max-sessions` (default 10,000, max 100,000), `--after <next>`, `--sessions-per-minute` (default 30), `--max-load` (pause while ClickHouse `LoadAverage1` is above it, default 12); stops at a workspace's OpenAI quota |
| `audit:l1` | nothing | `--json`, `--compare <before.json>`; every statement within the analysis bounds |

The worker only builds what is queued, live requests (priority 0) first, and only while `L1_EDGES_WORKER_ENABLED=true` (minute cron, 240-second budget). Requests stay queued while it is off.

## 1. Merge and deploy

### Parser 9 upgrade

Target versions: transcript parser **9**, usage extraction **5**, usage identity **1**, attestation **v3**, run index **2**. This branch's local verification never connects to production; the following operations are for an authorized operator only.

1. Leave the L1 worker off. Deploy the additive `20261010130000_parser_v9.sql` migration through `ch:migrate:production` (now includes `ch:migrate:parser-v9`). The runner checks nullable types on every replica before journaling. Do not change historical migration checksums or rewrite legacy numeric usage columns.
2. Preview one small organization with the existing bounded transcript backfill flags, inspect issues, then execute with its printed cutoff. Process parent/root sessions before known fork children when possible. Parent absence is not replay proof; do not use timestamps as a substitute. Run-index 2 rechecks explicit parent-call matches at build time, including children parsed before the parent's receipt existed. Rebuild affected run indexes if a parent arrives after an index was published.
3. Backfill usage extraction **before** enqueueing run-index builds. Use `backfill:usage-events`' existing preview/execute contract, one organization at a time; require complete v5 receipts with nullable recorded cache columns and v3 checksums. Keep identity version 1. Modern Codex response usage replaces, rather than adds to, token-count telemetry.
4. Audit parser-9 coverage, confirmed applied edits, cancellation-excluded denials and replay exclusion; inspect `facts_clipped`, `_more`, `facts_truncated`, oversized/unparseable lines. Codex usage whose response records no service tier is priced at the thread's configured tier and carries the `service_tier_configured` quality flag as its price basis: inspect that flagged usage (its cost rises for threads configured to Fast or Priority) rather than expecting it to be unpriced. Do not treat zero populations for unwitnessed counterpart proposals as supported writer absences.
5. Enqueue `backfill:run-index` for index version 2 only after usage and parent generations are ready. Enable the worker using the canary sequence below, then compare the before/after organization audit. Retire superseded derived generations only after the grace interval; raw transcripts remain until deletion requests.

The legacy sequence below describes the full-stack rollout; replace `.v8` audit keys with `.v9` for this upgrade. No migration/backfill command was executed against a database during implementation.

Merge the stack in order, each deployed and healthy before the next: the edge tables and queue, the session and GitHub-side builds, parser 6 schema and parsers 6 to 8, git extractor 4, the edge reads (`find`), the run index schema and builder, then this branch (retirement drain, run index backfill, edge census, audit). A production deploy applies the Postgres migrations first (Vercel workflow) and the ClickHouse migrations in the build (`ch:migrate:production`, which includes `ch:migrate:l1-edges`, `ch:migrate:run-index` and, last, `ch:migrate:l1-retention`, which removes the TTLs from the raw, record and run index tables: see [L1 retention](l1-retention.md); rows a TTL merge deleted before it ran are gone). Keep `L1_EDGES_WORKER_ENABLED` unset (off) through the merges. From this branch on, the daily maintenance also runs `l1-edge-census`; it only queues requests.

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

## 7b. Transcript search history

Uploads are indexed for search as they arrive; `backfill:transcript-search` indexes the sessions uploaded before, through the same pass (secret filter, chunking, deduplication per member, the workspace's OpenAI quota, purge fences). It only touches workspaces uploads are indexed for: a paid plan (`active` or `past_due`) or listed in `TRANSCRIPT_EMBEDDINGS_WORKSPACES`; any other workspace is reported as not indexed. Run it after step 3, since it reads the committed transcript-records generation.

```bash
bun run backfill:transcript-search --organization-id $ORG                  # preview: sessions, estimatedTokens, estimatedCostUsd
nohup bun run backfill:transcript-search --organization-id $ORG --execute > search-$ORG-1.json 2> search-$ORG-1.log &
bun run backfill:transcript-search --organization-id $ORG --execute --after <next>   # while it prints next
```

- It selects sessions whose search receipt is missing, of an older generation, or still counts chunks without a vector, newest first, and leaves sessions indexed at their current generation alone. A preview never calls OpenAI; its token estimate counts every record's text before deduplication (text-embedding-3-small at $0.02 per 1M tokens), so it is an upper bound, and `workspaces[].fitsQuota` says whether it fits what is left of the 30-day quota.
- `--execute` needs `OPENAI_API_KEY`. It starts at most `--sessions-per-minute` passes a minute (a large session the pass limits cut short gets further passes, each counted) and waits 30 seconds at a time while `LoadAverage1` is above `--max-load`; `loadPausedSeconds` says how long. Ctrl-C (or `kill -INT` on a detached run) stops it before the next session and still prints the summary.
- It stops with `stopped: "quota"` when a workspace has used its quota, and its message names the workspace and when the quota resets: continue with the printed `--after` after that, or raise `TRANSCRIPT_EMBEDDINGS_QUOTA_TOKENS` on purpose. `next` is left before the session that ran out, so continuing finishes it.
- Stop when it exits with code 2 (`failed > 0`, read `issues`), when `incomplete` grows (OpenAI errors or sessions that need more passes; a later run picks them up), or when it keeps pausing for load.

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
