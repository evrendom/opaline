# Opaline

A platform for ingesting, storing, and analyzing Claude Code / Codex session transcripts. Users authenticate via the web app, use the CLI to upload `.jsonl` session transcripts, which are stored in ClickHouse for analytics.

**Stack**: Bun, Turborepo, Biome, TypeScript
**Deployment**: Bun server + Postgres (Neon) + ClickHouse
**Domain**: `opaline.so`

## Monorepo Structure

### Apps

| App | Package | Description |
|-----|---------|-------------|
| `apps/api` | `@rudel/api` | HTTP API server (Bun). Auth via `better-auth`, RPC via `@orpc/server`, session ingestion into ClickHouse. |
| `apps/cli` | `rudel` (npm) | CLI tool for authenticating and uploading Claude Code / Codex session transcripts. Commands: `login`, `logout`, `whoami`, `upload`. |
| `apps/web` | `@rudel/web` | React SPA (Vite + Tailwind + shadcn). Auth UI and CLI login portal. |

### Packages

| Package | Description |
|---------|-------------|
| `packages/api-routes` (`@rudel/api-routes`) | Shared RPC contract (`@orpc/contract` + Zod schemas). Single source of truth for the API interface. |
| `packages/ch-schema` (`@rudel/ch-schema`) | ClickHouse table schema (`rudel.claude_sessions`, `rudel.session_analytics`), generated TypeScript types, and ingest functions via `chkit`. The root entry point is full and pulls in `@chkit/core` and `@clickhouse/client`; `@rudel/ch-schema/generated` and `@rudel/ch-schema/connection` are lightweight. **Use the narrowest entry point** for runtime imports to avoid loading heavy ClickHouse dependencies. |
| `packages/sql-schema` (`@rudel/sql-schema`) | Drizzle ORM schema for Postgres auth tables (`user`, `session`, `account`, `verification`, `user_avatar`). |
| `packages/typescript-config` (`@rudel/typescript-config`) | Shared `tsconfig` base files (`base.json`, `node.json`, `react-library.json`). |

### Dependency Graph

```
@rudel/typescript-config ← (devDep) all packages and apps
@rudel/api-routes        ← @rudel/api, @rudel/web, rudel CLI
@rudel/sql-schema        ← @rudel/api
@rudel/ch-schema         ← @rudel/api
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PG_CONNECTION_STRING` | Yes | Postgres connection string (e.g. `postgres://postgres:postgres@localhost:5432/rudel`) |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (generate with `openssl rand -base64 32`) |
| `CLICKHOUSE_URL` | Yes | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USERNAME` | Remote only | ClickHouse username; local endpoints may use `default` |
| `CLICKHOUSE_PASSWORD` | No | ClickHouse password |
| `CLICKHOUSE_DB` | No | ClickHouse database name |
| `R2_ACCOUNT_ID` | No | Cloudflare account ID for the EU-jurisdiction `opaline-ingest-prod` bucket. Direct-to-R2 ingest is disabled unless all three R2 variables are set. |
| `R2_ACCESS_KEY_ID` | No | Bucket-scoped R2 S3 access key ID. |
| `R2_SECRET_ACCESS_KEY` | No | Bucket-scoped R2 S3 secret access key. |
| `REPOSITORY_EVIDENCE_CAPTURE_ENABLED` | No | Server-controlled repository-evidence capture off switch. Only the exact value `false` disables `repositoryEvidence.init` and `commit`; missing and other values keep capture enabled. Transcript ingest is unaffected. |
| `REPOSITORY_EVIDENCE_CAPTURE_PAUSE_SECONDS` | No | CLI pause duration returned when repository-evidence capture is disabled (default: 86,400 seconds; clamped to 3,600–604,800). Missing or non-finite values use the default. |
| `GITHUB_EVIDENCE_UI_ENABLED` | No | Dark-launch switch for the user-facing GitHub evidence UI: the dashboard's Merged PRs metric (with its CI-errors-per-PR companion) and the workspace settings GitHub section. The server decides visibility (`availableMetrics` on the dashboard payload, `visibility` on `githubRepositoryEvidence.status`). Collection, persistence, cron, and webhooks run regardless. Only the exact value `true` enables it; missing and invalid values fail closed to hidden (default: off, including local dev). |
| `CLICKHOUSE_PURGE_POLL_INTERVAL_MS` | No | Crash-recovery ceiling for durable ClickHouse purge jobs; enqueue paths and scheduled retries wake the in-process worker sooner (default: 3,600,000 / 60 min) |
| `CLICKHOUSE_PURGE_FOLLOWUP_DELAY_MS` | No | Delay before the second purge pass that re-deletes ClickHouse rows, multipart intents and R2 keys written by requests that were already in flight when an account or workspace was deleted; must exceed the longest bounded evidence write (default: 900,000 / 15 min) |
| `CH_MIGRATE_SKIP_CONFIRMED_SHA` | No | Outage-only operator override for production builds: the full commit SHA that may deploy without its ClickHouse forward migrations while ClickHouse is unreachable. Set it only after confirming that commit changes no ClickHouse schema (`packages/ch-schema`), and remove it after the deploy. The deploy workflow passes `CH_DEPLOY_SHA`. |
| `APP_URL` | No | API base URL (default: `http://localhost:4010`) |
| `ALLOWED_ORIGIN` | No | CORS origin (default: `http://localhost:4011`) |
| `TRUSTED_PROXY_HOPS` | No | Number of trusted reverse proxies in front of the API (or in front of Fly Proxy); used to resolve client IPs from right to left in `X-Forwarded-For` (default: 0) |
| `MAX_REQUEST_BODY_BYTES` | No | Positive integer HTTP request-body ceiling in bytes (default: 160 MiB) |
| `SESSION_DETAIL_DERIVATION_CACHE_MAX_BYTES` | No | Per-process byte budget for revision-keyed session-detail derivations (default: 512 MiB) |
| `SESSION_DETAIL_DERIVATION_CACHE_MAX_ENTRY_BYTES` | No | Maximum logical bytes retained for one session-detail derivation (default: 192 MiB) |
| `USAGE_EVENT_EXTRACTION_ENABLED` | No | Usage-event extraction kill switch. Set `false` to keep raw ingest available while bypassing extraction (default: `true`). |
| `USAGE_EVENT_ANALYTICS_CUTOVER_MODE` | No | Request-level analytics routing: `off`, `canary`, or `all`. Missing and invalid values fail closed to `off`. |
| `USAGE_EVENT_ANALYTICS_CANARY_ORG_IDS` | No | Comma-separated organization IDs routed to request-level analytics in `canary` mode. An empty list keeps the cutover off. |
| `USAGE_EXTRACTION_QUEUE_GLOBAL_MAX_BYTES` | No | Maximum active-plus-queued extraction bytes per API process (default: 256 MiB). |
| `USAGE_EXTRACTION_QUEUE_GLOBAL_MAX_JOBS` | No | Maximum active-plus-queued extraction jobs per API process (default: 8). |
| `USAGE_EXTRACTION_QUEUE_PER_USER_MAX_BYTES` | No | Maximum active-plus-queued extraction bytes for one authenticated user (default: 128 MiB). |
| `USAGE_EXTRACTION_QUEUE_PER_USER_MAX_JOBS` | No | Maximum active-plus-queued extraction jobs for one authenticated user (default: 5). |
| `USAGE_EXTRACTION_QUEUE_TIMEOUT_MS` | No | Extraction worker timeout in milliseconds (default: 30,000). |
| `SKILL_EXTRACTION_ENABLED` | No | Ingest-time persistent skill extraction kill switch (default: `true`). The shared extraction worker is also bypassed when both usage and skill extraction are disabled. |
| `SKILL_ANALYTICS_CUTOVER_MODE` | No | Persistent skill-read routing: `off`, `canary`, or `all`. Missing and invalid values fail closed to the temporary legacy reader. |
| `SKILL_ANALYTICS_CANARY_ORG_IDS` | No | Comma-separated organization IDs routed to persistent skill reads in `canary` mode. An empty list keeps the cutover off. |
| `SKILL_BACKFILL_MAX_SESSIONS` | No | Hard raw-session census bound for the skill backfill (default: 10,000). |
| `SKILL_BACKFILL_MAX_SESSION_BYTES` | No | Maximum raw transcript bytes processed per skill-backfill session (default: 512 MiB). |
| `SKILL_BACKFILL_BATCH_MAX_ROWS` | No | Maximum raw sessions returned in one skill-backfill batch (default: 64). |
| `SKILL_BACKFILL_BATCH_MAX_BYTES` | No | Target raw transcript bytes per skill-backfill batch (default: 128 MiB). |
| `TRANSCRIPT_RECORDS_EXTRACTION_ENABLED` | No | Kill switch for ingest-time `rudel.transcript_records` extraction. Set `false` to keep raw ingest available while skipping record extraction (default: `true`). Extraction is best-effort and never fails an upload. |
| `TRANSCRIPT_RECORDS_TEXT_MAX_CHARS` | No | Cap on the decoded `text` stored per transcript record; `head`, `tail`, `text_chars`, `byte_start`, and `byte_len` stay exact (default: 65,536). |
| `TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS` | No | Total head, tail, and text characters stored for one session across all streams; later records keep structure and a short head only (default: 32 Mi). |
| `TRANSCRIPT_RECORDS_BACKFILL_MAX_SESSIONS` | No | Hard raw-session census bound for the transcript-records backfill (default: 10,000). |
| `TRANSCRIPT_RECORDS_BACKFILL_MAX_SESSION_BYTES` | No | Maximum raw transcript bytes processed per transcript-records-backfill session (default: 512 MiB). |
| `TRANSCRIPT_RECORDS_BACKFILL_BATCH_MAX_ROWS` | No | Maximum raw sessions returned in one transcript-records-backfill batch (default: 64). |
| `TRANSCRIPT_RECORDS_BACKFILL_BATCH_MAX_BYTES` | No | Target raw transcript bytes per transcript-records-backfill batch (default: 128 MiB). |
| `LANGUAGE_SIGNAL_RECONCILE_INTERVAL_MS` | No | Delay between per-process language-signal reconciliation passes in milliseconds (default: 60,000). |
| `LANGUAGE_SIGNAL_RECONCILE_BATCH_SIZE` | No | Maximum stale or missing sessions scanned per language-signal reconciliation batch (default: 25). |
| `RATE_LIMIT_INGEST_REQUESTS_MAX` | No | Positive integer per-user Postgres-backed ingest request cap shared by all of the user's API keys (default: 15,000) |
| `RATE_LIMIT_INGEST_REQUESTS_WINDOW` | No | Per-user fixed ingest request window in seconds; minimum 60 (default: 3,600) |
| `RATE_LIMIT_INGEST_BYTES_MAX` | No | Positive integer per-user Postgres-backed ingest byte cap shared by all of the user's API keys (default: 10 GiB) |
| `RATE_LIMIT_INGEST_BYTES_WINDOW` | No | Per-user fixed ingest byte window in seconds; minimum 60 (default: 3,600) |
| `GITHUB_REPOSITORY_APP_WEBHOOK_SECRET` | No | GitHub App webhook secret (32+ characters). Enables the signed `/api/webhooks/github` endpoint that schedules near-real-time PR and CI evidence refreshes; unset keeps the daily cron as the only refresh path. |
| `MCP_PLUGIN_PUBLIC` | No | Dark-launch switch for the Opaline ChatGPT/Codex plugin (`/api/mcp` and its consent page). Only the exact value `true` opens it to every account; otherwise only members of `VITE_ADMIN_ORGANIZATION_ID` can connect and call tools, and nobody can when that is unset (default: team only, including local dev). |
| `OPENAI_APPS_CHALLENGE_TOKEN` | No | Domain-verification token from the OpenAI plugin dashboard, served as plain text at `/.well-known/openai-apps-challenge`; unset returns 404. |
| `RESEND_API_KEY` | No | Resend API key for email integration |
| `RESEND_AUDIENCE_ID` | No | Resend audience ID for signup contact sync |
| `VITE_ADMIN_ORGANIZATION_ID` | No | Organization ID whose members have admin panel access |

Automated product emails use the fixed sender `Opaline <evren@opaline.so>`.

## Local chkit development

To test local chkit changes without publishing:

```bash
# Link to a local chkit checkout
CHKIT_PATH=/path/to/chkit bun run chkit:link

# Restore to published versions
bun run chkit:unlink
```

`chkit:link` rewrites the root `package.json` overrides to `file:` paths pointing at your local chkit checkout and runs `bun install`. It also installs a pre-commit hook that blocks commits with `file:` overrides active.

`chkit:unlink` restores overrides to the version declared in `packages/ch-schema/package.json` and runs `bun install`.

CI runs `scripts/check-overrides.ts` before `bun install` to catch any accidentally committed `file:` overrides.

## Local Development

### 1. Standalone (local infra)

Uses Docker containers for Postgres and ClickHouse. No hosted-service access or external accounts are required. Good for working on auth, UI, or API logic without needing hosted data.

**Prerequisites**: Docker (or [OrbStack](https://orbstack.dev)) must be installed and running.

```bash
bun install
bun run dev:local
```

This runs `scripts/dev-local.sh`, which:
1. Starts local Postgres + ClickHouse via Docker Compose (`docker compose up -d --wait`)
2. Runs Postgres migrations
3. Bootstraps an empty ClickHouse database, upgrades a checksum-verified journal prefix, or verifies a fully journaled installation
4. Launches the API (`:4010`) and web app (`:4011`) in parallel

Open **http://localhost:4011** in your browser. Sign up with email/password to create a local account. Social login (Google/GitHub) is not available in this mode since there are no OAuth client credentials.

Environment is hardcoded in the script: local Postgres (`postgres://postgres:postgres@localhost:5432/rudel`), local ClickHouse (`http://localhost:8123`, password: `clickhouse`), and a static auth secret.

Manage containers separately: `bun run infra:up` / `bun run infra:down`. To wipe all data and start fresh: `docker compose down -v`.

Hosted-service operations live in the core team's private ops repo.

## Profile avatars

Profile avatars persist to Postgres in the `user_avatar` sidecar table (one row per user, keyed by `user_id`, with a stable `public_id` UUID and the raw bytes in `image_data` bytea). `user.image` stores a relative URL `/api/avatar/<public_id>`; never absolutize it at write time so hosted shares don't capture localhost from local development.

- `GET /api/avatar/<publicId>` is public, no auth, served by Bun with `Cache-Control: public, max-age=300` and `ETag` for 304 revalidation. Re-uploading bytes keeps the same `public_id` so the URL stays stable.
- `POST /api/profile/avatar` accepts a single multipart `file` field (PNG, JPEG, or WEBP), enforces a 2 MB cap, sniffs magic bytes (rejects spoofed types), and atomically upserts the sidecar row + updates `user.image`.
- `profile.updateMine` (oRPC) accepts `name` + `image`. Image must be `null`, the caller's own `/api/avatar/<id>`, or HTTPS from a trusted OAuth host (`lh3.googleusercontent.com`, `avatars.githubusercontent.com`). Non-avatar images drop the sidecar bytes inside the same transaction.
- The OG PNG card (`x-card.png`) only embeds `data:` images, so uploaded avatars and Google avatars both render as initials there. Fix is a separate follow-up.

Shared avatar constants (size caps, MIME allowlist, regex patterns) live in `packages/api-routes/src/avatar.ts` and are imported on both API and web.

## Self-Hosting

See [docs/self-hosting.md](docs/self-hosting.md) for deploying with ObsessionDB + Neon + Fly.io.

## ClickHouse Schema Management (chkit)

Schema definitions live in `packages/ch-schema/src/db/schema/*.ts`. The toolkit `chkit` generates SQL migrations, applies them, and produces TypeScript codegen.

**Important**: chkit must run with `bun --bun` (not plain `bun`) because the `.exe` spawns Node.js which cannot load `.ts` config files. All scripts below already handle this.

**Important**: chkit needs to connect to `default` first when it may need to run `CREATE DATABASE`. The migration and status scripts set `CLICKHOUSE_DB=default` for that connection. The generate and codegen scripts do not need the override because they do not connect to ClickHouse or only read schema files.

### Workflow

Run `bun run ch:bootstrap` before starting API writers. For a fresh installation it replays the original migration files, uses the controlled F16 runner, and adds the `subagent_count` prerequisite before the September 11 view recreation. For an existing local installation, it applies only the missing suffix when the journal is an ordered, checksum-verified prefix of checked-in history, using the controlled F16 runner, existing forward scripts, or stock chkit restricted to each pending migration. As with fresh replay, this offline local path permits checked-in destructive DDL; it must not run against production. Historical SQL and checksums remain unchanged. Bootstrap refuses unjournaled tables, non-prefix or mismatched history, and partial F16 state; use the controlled recovery procedure for interrupted F16 migrations. A fully journaled installation is a checksum-verified no-op. Production continues to use the controlled forward scripts, not bootstrap. Local ClickHouse needs the `s3` storage-policy alias mounted by Docker Compose and CI.

Bootstrap includes `20260930120000_repository_evidence_index.sql`: fresh installs replay its original DDL, while verified-prefix upgrades use `migrate-repository-evidence-index.ts` with the local `ReplacingMergeTree` engine. CI runs only bootstrap, without a second repository-index migration step. Production runs the language-signals, transcript-records, and repository-evidence-index forward scripts in that order; the repository-index script retains its `SharedReplacingMergeTree` default there.

All commands run from `packages/ch-schema`:

```bash
# 1. Edit schema in src/db/schema/*.ts

# 2. Preview what migration will be generated (no files written)
bun run ch:generate:dryrun

# 3. Generate migration SQL + update snapshot/journal
bun run ch:generate

# 4. Apply pending migrations to the configured ClickHouse instance
bun run ch:migrate

# 5. Regenerate TypeScript types from schema
bun run ch:codegen

# 6. Check migration status
bun run ch:status

# 7. Check schema drift (snapshot vs live ClickHouse)
bun run ch:drift
```

### Ad-hoc ClickHouse queries (chcli)

`chcli` is the preferred tool for ad-hoc queries. It supports `-q` (inline SQL), `-f` (SQL file), and various output formats (`-F json`, `-F pretty`, `-F csv`, etc.).

```bash
# Inline metadata query against the configured ClickHouse instance
bun run chcli -- -q "SELECT database, name, engine FROM system.tables ORDER BY database, name LIMIT 100" -F json

# Run a SQL file
bun run chcli -- -f scripts/example.sql -v
```

### Resetting from scratch

To drop everything and recreate:

1. Drop the database with the `chcli` wrapper
2. Delete `chx/migrations/`, reset `chx/meta/journal.json` to `{"version":1,"applied":[]}`, reset `chx/meta/snapshot.json` to `{"version":1,"generatedAt":"","definitions":[]}`
3. Run `bun run ch:generate` to create a fresh migration from current schema (codegen plugin may fail — ignore, migration file is still created)
4. **Manually reorder** the migration SQL: database -> tables -> materialized views (see known issues below)
5. Wait ~8s after dropping (ClickHouse Cloud propagation delay), then run `bun run ch:migrate`

### Known issues and blockers

**chkit generates operations in wrong order.** Materialized views are emitted before the tables they depend on. After `ch:generate`, always manually reorder the migration file so CREATE TABLE statements come before CREATE MATERIALIZED VIEW. This is a chkit bug.

**No SQL `--` comments inside MV `as` clauses.** chkit flattens the multi-line MV query into a single line. SQL `--` comments become inline on that line and comment out everything after them, breaking the query. Never use `--` comments inside the `as:` template string in `materializedView()` definitions. Use TypeScript comments (`//`) outside the template string if needed.

**`primaryKey: []` is required** by chkit's `TableDefinition` type, even though ClickHouse defaults the primary key to ORDER BY columns. chkit emits `PRIMARY KEY ()` in the DDL. This is safe to leave or remove from the migration file — it's cosmetic.

**ClickHouse Cloud propagation delay.** After DROP DATABASE, the database may still appear in SHOW DATABASES for several seconds. Similarly, after CREATE TABLE, the table may not be immediately available for CREATE MATERIALIZED VIEW. Wait ~8s between DROP and re-apply.

**Codegen plugin failure.** `bun run ch:generate` may fail with `Plugin "codegen" failed in generate integration with exit code 1`. The migration file and snapshot are still created despite this error. Run `bun run ch:codegen` separately if needed.

**`CLICKHOUSE_DB=default` override.** When the application database does not exist yet (for example, during an initial migration), chkit cannot connect to it. The migration and status scripts override the connection database with `CLICKHOUSE_DB=default`.

**ClickHouse Cloud silent INSERT behavior.** `INSERT ... SELECT` via the HTTP interface may silently return 200 with 0 rows written. Use `SETTINGS async_insert=0` as a workaround. Additionally, `INSERT INTO table_x SELECT ... FROM table_x` (same source and target table) silently writes 0 rows even with `async_insert=0` — you must read from a different source table. The API uses `client.command()` with `FORMAT JSONEachRow` and `async_insert=0` (see `apps/api/src/clickhouse.ts`).

**Codegen EPERM on Windows.** `bun run ch:codegen` may fail with `EPERM: operation not permitted, rename .tmp -> chkit-types.ts` when VSCode has the file open. Workaround: close the file in the editor, or manually copy the `.tmp` file content over `chkit-types.ts` and delete the `.tmp` files.

**INSERT INTO with SELECT * column mismatch.** When backfilling `session_analytics` from `claude_sessions`, ClickHouse matches INSERT columns by position, not name. Since the MV computes columns in a different order than the table definition, always use an explicit column list in the INSERT INTO clause.

**`bun run` resolves binaries from local `node_modules/.bin/`, not global PATH.** When running package.json scripts, `bun run` looks for binaries in `node_modules/.bin/` first. If a tool like `chcli` is only installed globally, `bun run` won't find it. Fix: add the tool as a local devDependency (e.g., `@obsessiondb/chcli` in `packages/ch-schema`). Bun also rewrites `npx` to `bun x` in scripts, which has the same local-first resolution behavior.

**chcli connection mapping.** The wrapper in `scripts/chcli-connect.ts` parses `CLICKHOUSE_URL`, maps its hostname, protocol, and port to the variables expected by chcli, maps the resolved `CLICKHOUSE_USERNAME` to `CLICKHOUSE_USER`, and forwards arguments without shell interpolation. Like the API and chkit, it refuses to assume `default` for a remote endpoint or to choose between conflicting username variables.

**`CLICKHOUSE_SECURE` must be the string `true`, not `1`.** chcli does not recognize `1` or other truthy values for `CLICKHOUSE_SECURE`. Always use `CLICKHOUSE_SECURE=true`.

**Broken global npm `bun` shim on Windows.** If `npm install -g bun` was run previously, it creates a broken shim at `$APPDATA/npm/bun` that shadows the real bun at `~/.bun/bin/bun`. This breaks any globally installed tool that uses `#!/usr/bin/env bun`. Fix: delete the broken shims (`rm "$APPDATA/npm/bun" "$APPDATA/npm/bun.cmd"`).

**`WITH expr AS alias` columns are NOT included in `SELECT *`.** ClickHouse's column-level WITH aliases (used for intermediate computations in the MV like `_timestamps`, `_prompt_periods_sec`, etc.) are not expanded by `SELECT *`. This is by design and is what allows the MV to use `SELECT *` for source columns while computing additional columns explicitly.

**`organization_id` in ClickHouse is NOT a real organization ID — it is the user's personal ID (`user.id`).** The API sets `organizationId: context.user.id` (see `apps/api/src/router.ts`), so each user's uploaded sessions are stored under their own user ID in the `organization_id` column. This is a legacy naming issue. When querying or deleting ClickHouse data, understand that filtering by `organization_id` targets a single user's data, not an entire organization's data. A Postgres `organization` has a separate ID (found in the `organization` table) and is linked to users via the `member` table. To find all sessions for an actual organization, you must first look up its member user IDs in Postgres, then query ClickHouse for each.

**Stale generated types after schema changes.** After modifying `src/db/schema/*.ts`, the generated `chkit-types.ts` will be out of sync. Always run `bun run ch:codegen` (or manually copy the `.tmp` file if EPERM). The old types may have columns that no longer exist or be missing new columns — this won't cause build errors if nothing imports them yet, but will cause runtime issues when consumed.

**`@rudel/ch-schema` barrel import pulls in `@clickhouse/client`.** The root entry point (`@rudel/ch-schema`) re-exports schema definitions that import `@chkit/core`, which transitively loads `@clickhouse/client` (a native Node.js client). This causes `SyntaxError: Export named '...' not found` failures on Linux Bun in CI. Always use `@rudel/ch-schema/generated` for runtime imports that only need types and ingest functions.

### Backfilling session_analytics

To backfill `session_analytics` from existing `claude_sessions` data (e.g., after recreating the table), use the `@chkit/plugin-backfill` plugin.

The plugin uses `session_date` for time windowing, configured via `defaults.timeColumn` in the `backfill()` plugin config in `clickhouse.config.ts`. The `--time-column` CLI flag can also override this explicitly.

```bash
# From packages/ch-schema

# Preview what the backfill will do
bun run ch:backfill:plan -- --target rudel.session_analytics --from 2025-01-01 --to 2026-03-01

# Run the backfill
bun run ch:backfill:run -- --plan-id <plan-id>

# Check backfill status
bun run ch:backfill:status -- --plan-id <plan-id>
```

### Codegen (TypeScript types)

After schema changes, regenerate TypeScript types:

```bash
bun run ch:codegen
```

This updates `src/generated/chkit-types.ts` (interfaces + Zod schemas) and `src/generated/chkit-ingest.ts` (typed ingest functions). If codegen fails, check for stale `.tmp` files in `src/generated/` and clean them up.

The generated `RudelSessionAnalyticsRow` type includes both source columns (from `SELECT *` on `claude_sessions`) and computed columns (from the MV). The `RudelClaudeSessionsRow` type covers only the source table columns.

## Transcript records index

`rudel.transcript_records` indexes every JSONL record of a session (Claude Code and Codex, main and subagent transcripts) so an agent can drill into parts of a transcript without loading it. Everything in it is deterministic: observed tool calls, exit codes, file paths, and transcript text. No generated summaries.

- **Schema**: `packages/ch-schema/src/db/schema/transcript-records.ts`; migration `20260930105809_transcript_records.sql`. Apply it with `bun run --cwd packages/ch-schema ch:migrate:transcript-records` (same pattern as the other additive migrations; chkit cannot express the `text` column's `CODEC(ZSTD(3))`, so the migration file adds it by hand).
- **Identity**: `(organization_id, user_id, session_id, revision, parser_version, agent_id, record_idx, block_idx)`; `(revision, parser_version)` is the extraction generation and is part of the `ReplacingMergeTree` key on purpose, so merges only ever collapse retries of one generation and an incomplete newer generation can never replace the committed one. `record_idx` is the 1-based JSONL line in the stream for `agent_id` (`''` is the main transcript); `block_idx` > 0 marks content blocks or file changes derived from the same line. `byte_start`/`byte_len` are the exact UTF-8 range of the raw line, always exact even when `text` is capped.
- **Kinds**: `user_prompt` (genuine human prompts, or a parent's delegated task in a subagent with subtype `delegation`; Conductor `<system_instruction>`, `<system-reminder>`, slash-command and local-command wrappers, task notifications, `isMeta`, compaction summaries, and Codex environment/AGENTS.md injections are `injected_context`/`compaction`/`meta`), `assistant_text`, `reasoning`, `tool_call`, `tool_result`, `file_change` (native edits, `apply_patch` files, and explicit shell writes), `meta`, `oversized`, and one `receipt` row per generation written last. Turn 0 holds records before the first prompt. `file_change` rows with `file_op` `write`/`edit`/`delete` are unconditional commands or native edits; shell commands in conditional branches (`a || rm x`, `test -f x && rm x; ...`) or that only touch the git index (`git rm --cached`) are stored as `inferred_*` operations and never counted as file changes; everything inside `if`/`for`/`while`/`case` bodies, `{ }` groups, and `( )` subshells is treated the same way because their control flow is not modelled. Exit codes come only from transport framing (JSON envelope metadata or the output preamble), never from text inside the application output.
- **Delegated turns (parser version 4)**: Codex child streams are recognized by explicit stream attribution, `session_meta.payload.thread_source = 'subagent'`, a `source.subagent` variant, or a non-self `parent_thread_id` (including `source.subagent.thread_spawn`). `originator = 'codex_exec'` alone is not a child signal. Incoming `response_item.agent_message` tasks become `user_prompt/delegation`; outgoing messages, other recipients, and event mirrors remain meta. Claude Task/Agent transcripts start with a user-role task: explicit subagent streams and standalone `isSidechain` + `agentId` transcripts use the same delegation subtype and turn rules. An identical re-upload or the bounded backfill replaces version-3 receipts with version 4.
- **Receipts**: the committed generation of a session is its newest receipt by `(revision, parser_version)`. Readers resolve it once per operation and bind it into every query, so a crashed extraction is invisible and a concurrent publication cannot mix generations into one response. After publishing, a writer deletes crashed attempts at once and a superseded committed generation only after a 10 minute grace (`TRANSCRIPT_RECORDS_RETIRE_GRACE_MS`, measured from the receipt that superseded it). Every reader enforces a 60 second whole-operation deadline (`TRANSCRIPT_READ_DEADLINE_MS`), and the grace must stay longer than it. A generation deleted on purpose (a confirmed deletion fence) is rebuilt under a fresh insert-deduplication namespace (each write attempt has its own id), because ClickHouse remembers insert tokens after the rows are gone; a transient fence lookup failure never deletes anything. The next identical upload or the backfill repairs a missing receipt.
- **Ingest**: extraction runs in its own worker (`transcript-records.worker.ts`), separate from usage and skill extraction, streaming bounded batches to the API with backpressure. Admission is bounded per process (`TRANSCRIPT_RECORDS_QUEUE_MAX_JOBS`; `TRANSCRIPT_RECORDS_QUEUE_MAX_BYTES` is reserved for running and queued jobs alike, and cancelled or expired waiters leave the queue at once), one session may expand to at most `TRANSCRIPT_RECORDS_MAX_ROWS` records and runs under `TRANSCRIPT_RECORDS_TIMEOUT_MS`. It is best-effort (`TRANSCRIPT_RECORDS_EXTRACTION_ENABLED=false` skips it; failures, timeouts, and a full queue are logged and never fail an upload or the required extraction). Splitter: `packages/api-routes/src/session-transcript/transcript-records/` (import from `@rudel/api-routes/transcript-records`). Bump `TRANSCRIPT_RECORDS_PARSER_VERSION` when splitter output changes.
- **Deletion**: the table is part of the account and organization ClickHouse purge (`apps/api/src/services/org-session.service.ts`). Writers (ingest and backfill) call the deletion fence `assertNoClickHousePurgeTombstone` before every insert and remove their own rows when it throws, and every successful purge schedules one follow-up pass (`CLICKHOUSE_PURGE_FOLLOWUP_DELAY_MS`) that deletes again, and the job (the tombstone) is never expired while that follow-up is outstanding, its retention being measured from the last completed pass; the pattern is documented at the fence helper in `clickhouse-purge.service.ts`.
- **Backfill**: `bun run --cwd apps/api backfill:transcript-records` previews; add `--execute --cutoff <printed cutoff>` to write. It needs `PG_CONNECTION_STRING` for the deletion fence, is bounded (`TRANSCRIPT_RECORDS_BACKFILL_*`), and is resumable: sessions whose newest receipt already matches the newest raw revision and parser version are skipped. Sessions whose account or organization is being deleted are skipped and counted as `fencedCount`. Backfill applies ingest's bounds (`TRANSCRIPT_RECORDS_MAX_ROWS`, `TRANSCRIPT_RECORDS_TIMEOUT_MS`, or `--max-rows` / `--session-timeout-ms`): one absolute session deadline covers splitting, fence waits, data INSERTs, and receipt publication, with cancellation forwarded to ClickHouse. A session that expands or runs past its bounds is reported as a bounded skip (`skippedCount`), not a failure. Bound failures never delete shared generations: partial rows without a receipt are invisible and remain for retirement or TTL, preserving any concurrent ingest publication of that same generation.
- **Retirement**: daily API maintenance independently sweeps quiet sessions with superseded committed generations after the 10-minute retirement grace (longer than the enforced 60-second reader deadline). Receipts are the durable work census, so no new upload or in-memory timer is required; each pass processes at most 10 sessions and 100 generations per session, with scan caps and a shared 10-second maintenance deadline. Failed or unfinished sweeps resume from the remaining receipts on the next cron; no schema migration is needed.
- **Readers**: `apps/api/src/services/transcript-records-reader.service.ts` (`readSessionFacts`, `readSessionMap`, `readTurn`, `readRecord`), tenant-scoped by `organization_id` + `user_id`, parameterized, pinned to one generation per call, validating every result row against a zod schema, and never reading `text` for facts or maps. `readTurn` charges every emitted string (actions, targets, paths, prompt, failures) against one `maxChars` budget. Raw views reserve an ordered representation of each non-meta record before sharing the remaining budget; full kind and numeric record/block identities survive, while text and optional metadata are cut explicitly (`[cut]`, or `…` for very short metadata fields). Stored heads are used when extraction exhausted its text budget. Only the row limit or a budget too small for the minimal representations omits an ordered suffix, with `truncated = true`.

## Releasing

The CLI (`rudel` on npm) uses Release Please for automated versioning and changelogs, with automated npm publishing via OIDC trusted publishing (no OTP).

**How it works:**

1. PRs must have conventional commit titles (`feat:`, `fix:`, `chore:`, etc.) — enforced by `.github/workflows/pr-title.yml`
2. When PRs merge to `main`, Release Please creates/updates a Release PR that accumulates changelog entries and version bumps
3. Merging the Release PR creates a GitHub Release + tag, and bumps the `package.json` version (`apps/cli/src/app.ts` reads the version from `package.json` at build time)
4. The release workflow (`.github/workflows/release.yml`) then publishes to npm automatically with `npm publish --provenance` (OIDC `id-token: write`, no manual OTP step)

**Configuration files:**

- `release-please-config.json` — Release Please manifest config (only `apps/cli` is releasable)
- `.release-please-manifest.json` — tracks current version

**Manual release script:** `scripts/release-cli.ts` can also be used for releases outside the Release Please flow.

## Pre-Push Checklist

Before pushing and creating a pull request, always run:

```bash
bun run verify
```

This runs type checking, linting, and tests across the monorepo. Do not push or create a PR if `bun run verify` fails.

## Pull Request Titles

PR titles **must** use conventional commit format — this is enforced by CI (`pr-title.yml`). Use one of these prefixes:

`feat:` | `fix:` | `docs:` | `style:` | `refactor:` | `perf:` | `test:` | `build:` | `ci:` | `chore:` | `revert:`

Examples: `feat: add user dashboard`, `fix: resolve login redirect loop`
