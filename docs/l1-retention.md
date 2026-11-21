# L1 retention and deletion

Owner decision: raw transcripts, `transcript_records` (all columns, text included), `run_index` (all columns, free text included) and `session_lineage` (L1 lineage) are **kept until a deletion request**. They no longer expire after 365 days (raw, records, run index text) or 1,095 days (run index), and `session_lineage` no longer expires after 365 days. Deleting an account or a workspace is now the only way these tables shrink, so the deletion coverage below is part of the retention contract: a table that holds an owner and is missing from the purge keeps that owner's data forever.

Not changed: the GitHub links keep their own retention; the weekly totals (`weekly_totals`) are nightly snapshots rebuilt from the whole run index, so each one covers all its history and older snapshots expire after 14 days without losing anything; analyses and exact query results in Convex (ADR 0001), the ingest staging objects, purge-job rows and the other operational retention listed at the end.

## What expired before, and what replaces it

| Where | Before | Now |
| --- | --- | --- |
| `packages/ch-schema/src/db/schema/base-sessions.ts:48` (`claude_sessions`, `codex_sessions`) | table TTL `toDate(session_date) + toIntervalDay(365)` | no TTL |
| `packages/ch-schema/src/db/schema/transcript-records.ts:156` | same 365-day table TTL | no TTL |
| `packages/ch-schema/src/db/schema/session-lineage.ts:51` | table TTL `toDate(child_session_date) + toIntervalDay(365)` | no TTL |
| `packages/ch-schema/src/db/schema/run-index.ts:664` | table TTL from `RUN_INDEX_TTL` (1,095 days) | no TTL |
| `packages/ch-schema/src/run-index.ts:7,9,27,28` | `RUN_INDEX_RETENTION_DAYS = 1_095`, `RUN_INDEX_TEXT_RETENTION_DAYS = 365`, `RUN_INDEX_TTL`, `RUN_INDEX_TEXT_TTL` | constants removed; only `RUN_INDEX_TEXT_COLUMNS` stays (used by the retention runner and tests) |
| `chx/migrations/20260826090551_auto.sql:276,303` (current `claude_sessions`, `codex_sessions`; older copies in `20260311084657_auto.sql:34,58` and `20260518233052_auto.sql:40,64`), `20260930105809_transcript_records.sql:46`, `20260822140000_session_lineage.sql:45` and `20260913190000_product_launch.sql:43` (`session_lineage`), `20261010120000_run_index.sql:126` (table) and `:38,84,88,91,92,94,99,120` (eight column TTLs: `prompt_head`, `turn_error`, `hook_stop_reason`, `hook_errors`, `hook_runs`, `api_error`, `goal`, `title`) | the TTLs themselves; checked-in migrations are history and stay byte for byte | new forward migration `chx/migrations/20261011120000_l1_retention_removed.sql` removes all of them |
| `packages/ch-schema/chx/meta/snapshot.json:94,186,1647,2025,3983` | TTLs of the five tables | removed (the snapshot only keeps TTLs of `dependency_health_probes` and `session_language_signals`) |
| `packages/ch-schema/scripts/migrate-run-index.ts:45-48,218-230` | read-back required the table TTL and the eight column TTLs, so it would fail once they are removed | does not check TTLs or the nine reworded comments; the retention runner owns them |
| `apps/desktop/server/src/services/analysis/run-index-reader.ts:45-72,93` | `isRunIndexTextExpired`, `expireRunIndexText`, and an `if(... <= today(), NULL, col)` per text column on every read | removed; text is read as stored |
| `apps/desktop/server/src/services/l1-edges/run-index.service.ts:268-274` | nulled text of sessions older than 365 days before writing | removed |
| `apps/desktop/server/src/clickhouse.ts:128-131`, `docs/l1-literal-schema.md:9,165,175`, `docs/adr/0002-literal-l1-for-analysis.md:17`, `AGENTS.md` (run index and new L1 retention sections) | stated the expiry | state "kept until a deletion request" |

No scheduled job deletes these tables by age. The maintenance steps that delete rows (`retire:transcript-records`, the hourly session retirement, session revision receipts, expired purge jobs, expired ingest jobs) remove superseded generations or operational rows, never a session's data by age. The `l1-edge-census` and `run-index-census` steps look back 14 days only to find sessions to queue, not to expire anything.

Code that treats a missing transcript as "expired" (`frozenReason: "transcript generation expired; edges kept"`, `"transcript expired; run index kept"`, the `frozen` link status) is unchanged: the strings are stored in Postgres and tests. With no TTL the condition now only arises when a generation is gone for another reason (a deleted session or a failed backfill), and the stored edges and runs are still kept.

### Production step

To run it by hand, `bun run --cwd packages/ch-schema ch:migrate:l1-retention` with the production `CLICKHOUSE_URL`.

- `ALTER TABLE ... REMOVE TTL` is a metadata change: no mutation, no rewrite of parts, and fast on large tables.
- `REMOVE TTL` fails on a table or column without a TTL. The runner therefore reads the endpoint it executes against and runs only the statements that still apply, so an interrupted run is finished, not failed.
- The journal entry is written only after the read-back sees, on every replica, the five tables (`claude_sessions`, `codex_sessions`, `transcript_records`, `run_index`, `session_lineage`) without a table TTL, the eight run index text columns without a column TTL, and the reworded run index comments. It re-verifies on every deploy and fails the build if a TTL comes back.
- It cannot restore data. Rows that a TTL merge already deleted before the migration ran are gone. Until the migration runs, ClickHouse keeps deleting expired parts, so run it as soon as the stack is merged.

## Deletion paths

There is no per-session or per-member deletion. A deletion request is carried out as one of these, all of which enqueue the same durable ClickHouse purge (`enqueueClickHousePurge` in `clickhouse-purge.service.ts`, plan in `getClickHouseSessionPurgePlans` in `org-session.service.ts`):

| Path | Entry point | Purge target |
| --- | --- | --- |
| Account deletion (self) | `profile.deleteMine` (`handlers/profile.ts`) -> `deleteUserPostgresData` | `account` by `user_id`, plus `organization` for every workspace left without another member |
| Account deletion (admin) | `admin.deleteUser` (`handlers/admin/delete-user.ts`) -> `deleteUserPostgresData` | same |
| Workspace deletion | `deleteOrganization` (`router.ts`) -> `deleteOrganizationPostgresData`; Better Auth's own `/api/auth/organization/delete` is blocked | `organization` by `organization_id` (`workspace_id` for GitHub tables) |

Each purge runs inline, is retried by the purge worker, and runs a second pass about 15 minutes later for writes that raced it. Each statement is a lightweight `DELETE` followed by a read-back that fails the job if a row remains. A workspace purge removes everything in the workspace, whoever owns it; an account purge removes the user's rows in every workspace they belonged to.

## Coverage: table by deletion path

`yes` means the purge plan deletes the table (ClickHouse) or the row is removed by the same transaction or a cascade (Postgres). The ClickHouse rows are enforced by `apps/desktop/server/src/__tests__/l1-deletion-coverage.test.ts`, which reads the schema snapshot and fails when a table with an owner column is not in the plan.

| Data | Holds | Account deletion (self or admin) | Workspace deletion |
| --- | --- | --- | --- |
| ClickHouse `claude_sessions`, `codex_sessions` | raw transcripts | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `transcript_records` | every record, with text | yes | yes |
| ClickHouse `run_index` | runs and receipts, with free text | yes | yes |
| ClickHouse `run_requests` | each run's requests (calls, time, usage) and the head of their last assistant text; kept until a deletion request like the run index | yes | yes |
| ClickHouse `call_facts` | each call of a run index build, every stream: tool, command text and identity, files read and changed, error line and outcome (not the output text); kept until a deletion request like the run index | yes | yes |
| ClickHouse `run_setup` | each run's received setup: the setup file versions it had (setup file, content hash, recorded path, whether uncommitted), kept until a deletion request like the run index | yes | yes |
| ClickHouse `setup_texts` | received setup texts (instruction files, skill bodies, MCP instructions, system prompts), each distinct text once per member; texts an upload stored while the first pass ran are removed by the second | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `weekly_totals` | sums of the run index per member, agent and week (nightly snapshots); a refresh that was already running when the purge deleted the run index is removed by the second pass | yes | yes |
| ClickHouse `run_question_answers` | run question answers: probability of yes per question wording, run revision and provider, with the model version and which input it read (no transcript text) | yes, by `user_id` (the session's owner); answers a job stored while the first pass ran are removed by the second | yes |
| ClickHouse `l1_edges`, `l1_edges_by_target`, `l1_edge_resolutions` | edges and evidence from sessions (the copy ordered by target is purged separately) | yes, by `user_id`; GitHub-side edges with an empty user are not the user's | yes |
| ClickHouse `transcript_chunks`, `transcript_chunk_hits` | transcript search: chunk text (after the secret filter) with 8-bit vectors, stored once per member and month, and where each chunk appeared, by run | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `session_git_observations` | git commands and outcomes read from transcripts | yes | yes |
| ClickHouse `usage_events` | per-request usage | yes | yes |
| ClickHouse `session_analytics` | per-session analytics (view target of the raw tables) | yes | yes |
| ClickHouse `session_language_signals` | matched phrases from transcript text | yes | yes |
| ClickHouse `session_lineage` | parent and child session ids, models, working directories | **was missing; added in this change** | **was missing; added in this change** |
| ClickHouse `skill_receipts`, `skill_uses`, `skill_version_contents` | skills read from transcripts | yes | yes |
| ClickHouse `repository_session_evidence_index` | repository evidence per session | yes | yes |
| ClickHouse `session_saved_outputs` | saved outputs of a session (background task outputs, large tool outputs) as its evidence captures listed them; the text stays in the evidence objects, purged with them; a publication in flight is removed by the second pass | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `session_images` | images of a session (screenshots, pasted images) as its evidence captures listed them, one row per image and transcript record; the bytes are evidence objects (`image`), purged with them; a publication in flight is removed by the second pass | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `wrapped_user_archetype_snapshots_v1` | per-user snapshot | yes | yes |
| ClickHouse `github_pull_requests`, `_details`, `_commits`, `github_ci_runs`, `_run_pull_requests`, `github_ci_jobs` | GitHub facts (no transcript data) | not applicable (workspace-scoped) | yes, by `workspace_id` |
| ClickHouse `wrapped_user_archetype_runs_v1`, `dependency_health_probes` | no owner column | not applicable | not applicable |
| Postgres `session_ownership`, `session_ingest_revision` | session identity, content hashes, upload shape | yes (cascade from `user`) | yes (cascade from `organization`) |
| Postgres `ingest_job` | upload jobs and R2 object manifests | yes (cascade) | yes (cascade); see the residual risk below |
| Postgres `l1_edge_scope`, `l1_edge_scope_dependency` | edge and run index build queue and watermarks | yes (cascade) | yes (cascade) |
| Postgres `ingest_processing_ledger` and its receipts | hash and session id of processed uploads | not removed for a user who leaves a shared workspace (no user column); removed with the account's sole-member workspaces | yes (cascade) |
| Convex (or, self-hosted, Postgres `analysis_log_*`) analyses and query results | analyses with a result that returned text from the sessions (any tool), or a finding citing their runs, and results that only counted them (numbers and ids) | yes (`purgeAnalysisLogs`, `deletion:removeOwnerEvidence`): the account's analyses, those with a result that returned text from its sessions and those with a finding on a result naming one of its sessions are deleted; results that only counted its sessions are removed (no output, arguments kept except those that may carry transcript text) and their analyses stay | yes |
| Postgres `analysis_sql_result` | stored `sql` results: title, SQL, result rows (with excerpts such as `prompt_head`), the members whose sessions the query could read and the sessions it names | yes: the account's own results (cascade from `user`) and every result among whose `owner_ids` it is whose shown rows returned text (not `counts`) are deleted; every other result among them is removed by the purge in both passes: no output, the account dropped from `owner_ids`, the title kept and the SQL kept unless it carries a literal, quoted name or comment (`query_carries_text`, then emptied) (`removed_at`) | yes (cascade from `organization`, and the purge) |
| ClickHouse `analysis_finding_runs` | each saved finding's cited runs with their recorded cost, tokens and active time, the finding's text and the members whose deletion deletes its analysis | yes: rows of the account's runs (`user_id`, purge plan), of its analyses (`author_id`) and of every analysis its deletion deletes (`quoted_owners`, `purgeFindingImpact`) | yes |
| ClickHouse `mcp_tool_calls` | one row per MCP tool call: the tool, the purpose and model the agent stated, time, error code and output size; `agent_feedback` calls also keep the feedback; expires after 365 days (month partitions) | yes, by `user_id` | yes, by `organization_id` |
| ClickHouse `session_inventory` | the sessions each member's CLI reports on their machine under their upload settings (session ids, agent, line counts, byte sizes, start and modification times, CLI version; no content), one report per member; rows the CLI stops refreshing expire 90 days after its last report | yes, by `user_id` | yes, by `organization_id` |
| Postgres `analysis_visibility_sync` | pending syncs of finding impact rows with an analysis's visibility (analysis and workspace ids only) | not applicable (no user column) | yes (cascade) |
| Postgres `transcript_embedding_quota` | per-workspace OpenAI tokens embedded (no session data) | not applicable (no user column) | yes (cascade) |
| Postgres `analysis_sql_quota` | per-workspace query count (no session data) | not applicable (no user column) | yes (cascade) |
| Postgres `run_question_job` | run question answering jobs: provider, question ids, the runs (session ids, revisions and owners) to answer, and the provider usage and cost | yes: the account's own jobs (cascade from `user`) and every job naming its sessions (`owner_ids`, deleted by the purge in both passes) | yes (cascade from `organization`, and the purge) |
| Postgres `run_question_quota` | per-workspace answer count (no session data) | not applicable (no user column) | yes (cascade) |
| Postgres `run_question` | the run question catalogue (wordings set by Opaline; no workspace or member data) | not applicable | not applicable |
| R2 repository evidence objects | repository files | yes (snapshotted keys, two passes) | yes |

### Gaps fixed

- `session_lineage` was in the API's ClickHouse allow-list but not in the purge plan. Its 365-day TTL was the only cleanup, so a deleted account's lineage rows (session ids, child model, working directory) lived up to a year; without the TTL they would have lived forever. It is now purged by account and by workspace (`org-session.service.ts`), with a case in `delete-sessions.integration.ts`.

### Gaps not fixed

- Staged upload objects of ingest jobs that are still in flight when the account or workspace is deleted. `ingest_job` cascades away, so its object manifest cannot clean them. They are removed by the `ingest/` bucket lifecycle rule (seven days, set on the hosted bucket); this rule must exist in production. This existed before this change.
- A user removed from a workspace (or leaving it) keeps their sessions in it until the workspace or account is deleted. Nothing deletes one session or one member's sessions without deleting the whole account. The DPA says the customer may delete sessions; with no expiry, a session-level deletion request has no path.
- `ingest_processing_ledger` has no user column (see the table).

## Operational considerations

- Storage grows without a ceiling. The raw and record tables are partitioned by month and stored on the `s3` policy; before this change they plateaued around a year of data, now they grow with every session. `transcript_records` (one row per record, with text) is the large one; `run_index` is small.
- Account purges scan more as the tables grow. `PRIVACY_DELETE_SCAN_SETTINGS` in `org-session.service.ts` caps a purge statement at 10,000,000 rows, 2 GiB and 90 seconds. Statements filtered by `user_id` on tables ordered by `organization_id` first can approach those caps as data accumulates. A purge that hits a cap fails closed: it retries and then sends the purge failure alert, but the data stays until it succeeds. Watch failed purge jobs and raise the caps (or add a per-organization purge) when they appear.
- Backfills, reparses and `find` scans work on a corpus that no longer shrinks; `find` already caps its scope (10,000 sessions) and scans.

## Retention that is unchanged

Convex query results 90 days (a year when shared or pinned) and drafts 7 days (ADR 0001, the hosted service's Convex retention job); stored `sql` results (`analysis_sql_result`) 90 days (the daily `sql-results` maintenance step); ingest staging objects seven days (hosted bucket lifecycle rule); succeeded purge jobs 30 days (`clickhouse-purge.service.ts:41`); session revision receipts 30 days (`session-revision-receipt-cleanup.service.ts:3`); GitHub webhook deliveries 30 days; `dependency_health_probes` one day; `session_language_signals` keeps its 365-day TTL (`src/db/schema/session-language-signals.ts:81`): it holds derived phrase matches and counts, not L1 data, so the owner decision does not cover it; it is the only L1-adjacent TTL left, and it is purged by account and workspace deletion; the 365-day window of `list_workspaces` (`sessionsLast365Days`) is a count window, not retention.
