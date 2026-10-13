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
| `apps/cli` | `rudel` (private, not published) | **Test harness only.** CI uses it for the `cli-smoke` job, the version-skew tests, and the CLI → API → ClickHouse integration tests. The published CLI (npm `rudel` and `opaline`) lives in [opalinehq/cli](https://github.com/opalinehq/cli). Put CLI fixes and features there, not here. |
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
| `PASSWORD_AUTH_EMAILS` | No | Comma-separated, case-insensitive exact emails allowed to sign in or sign up with a password; `*` allows everyone (set by `dev-local.sh` and CI). Missing or empty allows nobody: everyone else uses email codes or social login. The API rejects `/sign-in/email` and `/sign-up/email` for other emails with the wrong-password error, and the login forms show the password field only after `POST /api/auth/password-sign-in/available` confirms the typed email. `DEMO_ACCOUNT_EMAIL` is always allowed. |
| `CLICKHOUSE_URL` | Yes | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USERNAME` | Remote only | ClickHouse username; local endpoints may use `default` |
| `CLICKHOUSE_PASSWORD` | No | ClickHouse password |
| `CLICKHOUSE_DB` | No | ClickHouse database name |
| `R2_ACCOUNT_ID` | No | Cloudflare account ID for the EU-jurisdiction `opaline-ingest-prod` bucket. Direct-to-R2 ingest is disabled unless all three R2 variables are set. |
| `R2_ACCESS_KEY_ID` | No | Bucket-scoped R2 S3 access key ID. |
| `R2_SECRET_ACCESS_KEY` | No | Bucket-scoped R2 S3 secret access key. |
| `R2_LARGE_INGEST_WORKER` | Large-ingest project only | Set to exactly `true` only on the separate large-ingest Vercel project (`deploy/large-ingest`, Function CPU Performance, 4 GB). Its cron then claims and materializes R2 sessions above 48 MiB (`LARGE_INGEST_MIN_BYTES`), one per process. The worker refuses to run with any other value or below 3,500 MB of function memory. The main project never runs the large path, even if this is set there (fail closed). Resident Bun servers (self-hosted, local) materialize large sessions without it. |
| `REPOSITORY_EVIDENCE_CAPTURE_ENABLED` | No | Server-controlled repository-evidence capture off switch. Only the exact value `false` disables `repositoryEvidence.init` and `commit`; missing and other values keep capture enabled. Transcript ingest is unaffected. |
| `REPOSITORY_EVIDENCE_CAPTURE_PAUSE_SECONDS` | No | CLI pause duration returned when repository-evidence capture is disabled (default: 86,400 seconds; clamped to 3,600–604,800). Missing or non-finite values use the default. |
| `GITHUB_EVIDENCE_UI_ENABLED` | No | Global kill switch for Merged PRs, CI runs, CI failures / PR and the GitHub settings page and onboarding step. Dashboard visibility also requires per-organization readiness or an explicit forced preview; forced organizations (`GITHUB_EVIDENCE_UI_FORCE_ORG_IDS`) see all of it without this flag. Collection, persistence, cron, and webhooks run regardless. Only the exact value `true` enables it; missing and invalid values fail closed (default: off, including local dev). |
| `GITHUB_EVIDENCE_UI_FORCE_ORG_IDS` | No | Comma-separated organization IDs allowed to preview GitHub outcomes before readiness. Enables GitHub settings, admin onboarding and the dashboard's GitHub metrics (as a preview until readiness) for these organizations even with the global UI flag off. Ready organizations retain visibility until disconnection. |
| `GITHUB_SWEEP_ENABLED` | No | GitHub repository-wide PR/CI sweep worker kill switch. On unless exactly `false`. Independent of `GITHUB_EVIDENCE_UI_ENABLED`; disabling the sweep stops historical API requests, not live session refreshes or webhook persistence. Progress resumes after re-enabling. |
| `GIT_OBSERVATION_EXTRACTION_ENABLED` | No | Best-effort server git observations after transcript-records receipt publication. Only exact `false` disables extraction and execution backfill; uploads remain accepted. Default on. |
| `L1_EDGES_ENQUEUE_ENABLED` | No | Queue a session's L1 edge rebuild after its git observations are written (ADR 0003). Only exact `false` disables it. Default on. |
| `L1_EDGES_WORKER_ENABLED` | No | Build queued L1 edges (the `/api/cron/l1-edges` minute cron). Default off; requests stay queued until it is on. |
| `L1_EDGES_FIND_READ` | No | `find source=git` links events from the stored L1 edges where they are current and at query time elsewhere (each event's `edges` says which), and answers `pullRequest`. Only exact `false` turns edge reads off: every event is linked at query time and `pullRequest` answers unknown. Default on. |
| `L1_EDGES_FIND_SHADOW_RATE` | No | Share (0 to 1) of `find source=git` pages whose edge-linked events are also linked at query time and compared; differences are logged by class, expected ones prefixed `expected:`. Default 0. |
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
| `SKILL_EXTRACTION_ENABLED` | No | Ingest-time persistent skill extraction kill switch (default: `true`). Extraction reads the main transcript and every bundled Claude subagent transcript; skill receipts hash all streams (unchanged for sessions without subagents, so only sessions with subagents re-extract). The shared extraction worker is also bypassed when both usage and skill extraction are disabled. |
| `SKILL_ANALYTICS_CUTOVER_MODE` | No | Persistent skill-read routing: `off`, `canary`, or `all`. Missing and invalid values fail closed to the temporary legacy reader. |
| `SKILL_ANALYTICS_CANARY_ORG_IDS` | No | Comma-separated organization IDs routed to persistent skill reads in `canary` mode. An empty list keeps the cutover off. |
| `SKILL_BACKFILL_MAX_SESSIONS` | No | Hard raw-session census bound for the skill backfill (default: 10,000). |
| `SKILL_BACKFILL_MAX_SESSION_BYTES` | No | Maximum raw transcript bytes processed per skill-backfill session (default: 512 MiB). |
| `SKILL_BACKFILL_BATCH_MAX_ROWS` | No | Maximum raw sessions returned in one skill-backfill batch (default: 64). |
| `SKILL_BACKFILL_BATCH_MAX_BYTES` | No | Target raw transcript bytes per skill-backfill batch (default: 128 MiB). |
| `TRANSCRIPT_RECORDS_EXTRACTION_ENABLED` | No | Kill switch for ingest-time `rudel.transcript_records` extraction. Set `false` to keep raw ingest available while skipping record extraction (default: `true`). Extraction is best-effort and never fails an upload. |
| `TRANSCRIPT_RECORDS_TEXT_MAX_CHARS` | No | Cap on the decoded `text` stored per transcript record; `head`, `tail`, `text_chars`, `byte_start`, and `byte_len` stay exact (default: 65,536). |
| `TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS` | No | Total head, tail, and text characters stored for one session across all streams (default: 32 Mi). The budget is paced over the session's raw bytes, main transcript then subagents: by the end of any line, spending may not exceed the budget's share of the bytes read so far (unspent share carries forward), so early output cannot starve later turns or subagent transcripts. A record over its allowance keeps its head and tail excerpts and a shorter text; with nothing left, a short head, plus a 512-character tail for tool results and errors. `read(depth=record)` falls back to the raw line for the rest. |
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
| `LIVE_SESSIONS_ENABLED` | No | Live sessions kill switch. Only the exact value `false` turns them off: `cli.authStatus` stops advertising `liveSessions` and `liveSession.state`/`append` answer `LIVE_SESSIONS_DISABLED` (scope `global`, CLIs pause for an hour). Session ingest at session end is unaffected. Default on. |
| `LIVE_SESSIONS_WORKSPACES` | No | Workspaces whose CLIs may stream live sessions: comma-separated workspace (organization) ids, or `*`. Unset or empty: every workspace. An unlisted workspace gets `LIVE_SESSIONS_DISABLED` (scope `workspace`); `*` mixed with ids is logged and lists nobody. |
| `RATE_LIMIT_LIVE_SESSION_REQUESTS_MAX` / `RATE_LIMIT_LIVE_SESSION_BYTES_MAX` | No | Per-user Postgres-backed live session budget (`liveSession.state` and `append`), separate from the ingest budget: requests and line bytes per window (default: 60,000 and 4 GiB). Read per request; an invalid value fails live updates only. |
| `RATE_LIMIT_LIVE_SESSION_REQUESTS_WINDOW` / `RATE_LIMIT_LIVE_SESSION_BYTES_WINDOW` | No | Fixed windows of the live session budget in seconds; minimum 60 (default: 3,600). |
| `GITHUB_REPOSITORY_APP_WEBHOOK_SECRET` | No | GitHub App webhook secret (32+ characters). Enables the signed `/api/webhooks/github` endpoint that schedules near-real-time PR and CI evidence refreshes; unset keeps the five-minute `/api/cron/github-evidence` cron as the only refresh path. |
| `TRENDS_MIN_RUNS` | No | Runs a model needs in the period before the public `GET /api/trends/usage` aggregate lists it (default: 100) |
| `TRENDS_MIN_DEVELOPERS` | No | Distinct developers a model needs before `/api/trends/usage` lists it (default: 3) |
| `TRENDS_MIN_WORKSPACES` | No | Distinct workspaces a model needs before `/api/trends/usage` lists it (default: 2) |
| `TRENDS_EXCLUDED_USER_IDS` | No | Comma-separated user IDs (operator and test accounts) left out of every `/api/trends/usage` figure |
| `MCP_PLUGIN_PUBLIC` | No | Dark-launch switch for the Opaline plugin (ChatGPT, Codex and Claude Code) (`/api/mcp` and its consent page). Only the exact value `true` opens it to every account; otherwise only members of `VITE_ADMIN_ORGANIZATION_ID` can connect and call tools, and nobody can when that is unset (default: team only, including local dev). |
| `OPENAI_APPS_CHALLENGE_TOKEN` | No | Domain-verification token from the OpenAI plugin dashboard, served as plain text at `/.well-known/openai-apps-challenge`; unset returns 404. |
| `TRANSCRIPT_EMBEDDINGS_WORKSPACES` | No | Workspaces indexed for transcript search: comma-separated workspace (organization) ids, or `*` for every workspace, whatever their plan. By default only these are indexed; with `TRANSCRIPT_EMBEDDINGS_PAID_PLANS=true`, paid workspaces are too. Any other workspace is not, and search says so. Indexing: after transcript records are written (and again on a duplicate upload), the session text is cut into overlapping chunks stored once per member and month in `rudel.transcript_chunks` with a hit per place in `rudel.transcript_chunk_hits`, and embedded with OpenAI `text-embedding-3-small` at 512 dimensions, 8-bit, when `OPENAI_API_KEY` is set. New uploads are indexed as they arrive and history by `backfill:transcript-search` ([runbook](docs/l1-backfill-runbook.md)); a workspace that stops paying keeps what was indexed until deletion. Empty or missing lists nobody; `*` mixed with ids is logged and lists nobody. |
| `TRANSCRIPT_EMBEDDINGS_PAID_PLANS` | No | Only the exact value `true` also indexes for search the workspaces whose `billing_subscription.status` is `active` or `past_due`, without listing them (checked at upload and by `backfill:transcript-search`, cached for a minute); search then tells other workspaces it is available on paid plans. Off by default: only `TRANSCRIPT_EMBEDDINGS_WORKSPACES` is indexed. |
| `TRANSCRIPT_EMBEDDINGS_QUOTA_TOKENS` | No | OpenAI tokens each workspace may embed per 30-day window, session chunks and search queries together (default: 1,000,000,000, about $20, enough for a paying team: measured text is 110K to 370K tokens per session before deduplication). Over it, uploads are still chunked and found by exact string, nothing more is embedded until the window resets, and search says so. Usage is in Postgres `transcript_embedding_quota`, deleted with the workspace. |
| `ANALYSIS_LOG_STORE` | No | Analysis log store: `memory` keeps analyses in process; `convex` uses Convex (ADR 0001). Unset disables the log (find/read still work, without trace ids). |
| `RETRO_TOOLS_WORKSPACES` | No | Workspaces that may call the retro tools (`schema`, `sql`, `search`, `run`, `estimate_questions`, `run_questions`, as MCP tools and as the oRPC procedures behind them): comma-separated workspace (organization) ids, or `*` for every workspace. Unset or empty: only `VITE_ADMIN_ORGANIZATION_ID`. Any other workspace is refused with "The retro tools are not enabled for this workspace yet; use find and read." (fatal, not retried) and keeps `find`/`read`; saved answers, dashboards and workspace tools stay open to all. `*` mixed with ids is logged and lists nobody. |
| `RUN_QUESTIONS_PROVIDER` | No | Who answers run questions (precomputed answers, `estimate_questions`, `run_questions`, the `/admin/run-questions` form): comma-separated systemone-compatible providers `<preset>[:note\|:run]`; the first answers every run and agents, and the form can test with any to compare them. Presets: `subq` (SubQ Snap, reads each run's full text, the compact note when the run is too large) and `jev` (Typesafe, fallback, reads the note). Default `subq`. A provider without its key (and, for `jev`, its prices) is left out; with none, estimates still work, `run_questions` and form tests are refused, nothing is precomputed, the `/api/cron/run-questions` minute cron returns at once, and nothing is sent anywhere. Answers are precomputed: in a workspace allowed below, each run index build that commits (the L1 worker) queues every question that is on for the session's runs that lack an answer at their transcript revision (never twice; nothing beyond the workspace's answer quota), and the cron answers them. History: `backfill:run-questions` ([runbook](docs/l1-backfill-runbook.md)); questions from a file: `bun run run-questions:add --file <json> [--on]` in `apps/api`. |
| `SUBQ_API_KEY` | No | SubQ Snap API key (server-only secret). Unset (default): SubQ answers nothing. |
| `SUBQ_USD_PER_MILLION_INPUT_TOKENS` / `SUBQ_USD_PER_MILLION_OUTPUT_TOKENS` | No | SubQ prices for estimates and recorded cost (default `0.05` and `0`). |
| `TYPESAFE_API_KEY` | No | Jev API key (server-only secret), used only when `RUN_QUESTIONS_PROVIDER` lists `jev`. |
| `TYPESAFE_USD_PER_MILLION_INPUT_TOKENS` / `TYPESAFE_USD_PER_MILLION_OUTPUT_TOKENS` | With `jev` | Jev prices; Jev publishes none, so without both it is left out. |
| `RUN_QUESTIONS_INTERNAL_WORKSPACES` | No | Comma-separated workspace ids, besides `VITE_ADMIN_ORGANIZATION_ID`, whose runs may be sent to the run question provider (Opaline's own data workspaces). Every new run of these workspaces is answered for every question that is on. |
| `RUN_QUESTIONS_CUSTOMER_WORKSPACES` | No | Only the exact value `true` lets every workspace have run questions answered, every new run of every workspace included. Leave it off until the provider's data-retention and subprocessor terms are checked (default: off). |
| `ANALYSIS_LOG_WORKSPACES` | No | Comma-separated workspace (organization) ids whose find/read calls are captured and who may use analysis history, or `*` for every workspace. Empty or missing means nobody, even with a store configured (default: off). `*` mixed with ids is a configuration error: it is logged and nobody is captured. Where the log is off, the `analyses` MCP tool tells the agent to continue with find and read. Account and workspace purges clean every workspace regardless. |
| `ANALYSIS_LOG_RESTRICTED_WORKSPACES` | No | Comma-separated workspace (organization) ids, or `*` for every workspace, that restrict stored find/read results in shared analyses: a non-admin reads a result only when every session the query read is their own. Applies only to workspaces with the own-sessions-only option on (`organization.own_sessions_only`, ADR 0004), which is off for every workspace; elsewhere it restricts nothing. Empty or missing means nobody, so anyone who can see an analysis reads all its stored results (default: off); `*` mixed with ids is logged and restricts every workspace. Analysis visibility itself is unchanged. |
| `CONVEX_URL` | Convex only | Analysis-log deployment URL (`https://<deployment>.convex.cloud`). Account and workspace purges clean this deployment whenever it is set, whatever `ANALYSIS_LOG_STORE` says, and fail (to be retried) without a valid signing key. `ANALYSIS_LOG_STORE=convex` without this or the key logs an error and keeps capture off. Keep it set while the deployment holds analyses. |
| `ANALYSIS_LOG_PURGE_BACKENDS` | Convex only | Comma-separated backends that may hold analyses (only `convex` is valid). Purges fail, to be retried, while a declared backend lacks working configuration (`convex` without `CONVEX_URL` or a valid signing key), so losing configuration can never acknowledge a deletion without cleaning. `ANALYSIS_LOG_STORE=convex` captures only when `convex` is declared. Removing `convex` is the explicit decommission step in `convex/README.md`. |
| `ANALYSIS_LOG_SIGNING_KEY` | Convex only | The API's private ES256 JWK; it signs the short-lived tokens Convex accepts. Its public half is the Convex deployment's `ANALYSIS_LOG_JWKS`. Create both with `bun run --cwd apps/api analysis-log:keys` (see `convex/README.md`). Server-only. |
| `OPENAI_API_KEY` | No | Embeddings (`text-embedding-3-small`) for searching past analyses by meaning; only the question title and topics of a saved analysis are sent, when it is saved. Required by `ANALYSIS_LOG_STORE=convex` (capture stays off without it); the memory store falls back to local word vectors. Every stored vector records its model and searches compare only vectors of the current model. |
| `PRODUCT_ANALYTICS_EXCLUDED_ORG_IDS` | No | Comma-separated workspace (organization) IDs whose members the API never sends to PostHog: server events, signup events and the billing traits that the daily billing cron re-sends for every member of a paid workspace. Use it for test and seed workspaces. Empty or missing excludes nobody. A user who joins such a workspace after signing up still sends that signup event. |
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

Bootstrap includes `20260930120000_repository_evidence_index.sql` and `20261001120000_github_outcomes.sql`. The GitHub outcomes runner creates and validates six stage-1 tables, using local `ReplacingMergeTree(version)` without S3 settings for both fresh installs and prefix upgrades. CI runs only bootstrap. Production runs the language-signals, transcript-records, repository-evidence-index, and GitHub-outcomes forward scripts in that order; production retains `SharedReplacingMergeTree` and the S3 policy.

GitHub outcome facts live in ClickHouse (`github_pull_requests`, `github_pull_request_details`, `github_pull_request_commits`, `github_ci_runs`, `github_ci_run_pull_requests`, `github_ci_jobs`); installations, active bindings, sweep windows/cursors/readiness/retention and quota stay in Postgres. Provider timestamps supply replacing versions; memberships use collection time. Each sweep page publishes acknowledged async inserts before Postgres checkpoints its cursor; webhooks likewise wait for async inserts before delivery commit. Workspace deletion uses the durable purge and tombstone fence. Disconnect hides retained facts, and provider retention never deletes them. Initial PR history is independent of sessions and capped at two calendar years. Daily PR passes list all states by descending update time, stopping before the previous complete pass's start minus one hour; only PRs seen in that incremental pass have their commit maps fetched. Retained Actions history is still reconciled for old-run reruns. The per-repository CI floor never advances. Stage-2 attribution is not created here.

Pinned chkit beta.16 rejects expression sort keys and normalizes shared engines. When generating these tables, temporarily use `created_at` for the CI sort-key expression, then restore `toDate(created_at)` in the source, snapshot and SQL, and restore the production shared engine in SQL. The controlled runner validates the exact deployed key and engine from `engine_full`; codegen works from the restored source.

Sweeps resume at the next acknowledged page when the existing 20-second/100-request budget ends. Check-run identities and links use only GitHub's `started_at`; unstarted checks are deferred until a later sweep or webhook. Actions runs and statuses use their provider `created_at`. Live-work priority excludes superseded collection attempts using the maintenance worker's shared latest-attempt predicate. Free text removes NUL/control characters before secret filtering and the 512-character cap.

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

**Change a session analytics view in place.** Edit the view SQL in `src/mv-sql/`, then write a migration of `ALTER TABLE … MODIFY QUERY` statements generated from it (see `20261008120000_session_analytics_retired_writes.sql` and `scripts/migrate-session-analytics-retirement.ts`, which runs in `ch:migrate:production`). Never DROP and CREATE a live view: inserts between the two never reach `session_analytics`. Update the view's `as` in `chx/meta/snapshot.json` (whitespace-collapsed) to match.

**`WITH expr AS alias` columns are NOT included in `SELECT *`.** ClickHouse's column-level WITH aliases (used for intermediate computations in the MV like `_timestamps`, `_error_count`, etc.) are not expanded by `SELECT *`. This is by design and is what allows the MV to use `SELECT *` for source columns while computing additional columns explicitly.

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
- **Parser version 5**: Codex `event_msg` `item_completed` items are first-class: commands, MCP/app tools, patches and web searches that ran inside a code-mode `exec` script (no `function_call` of their own) become `tool_call`/`tool_result` (subtype `nested`) with their own exit codes, plus `file_change` rows for patch paths the script source did not already show. An item whose id is a recorded call id only lends its outcome to that call (meta `…_mirror`); repeated item ids and the `web_search_call` that follows a completed native search stay meta, so nothing counts twice. Injected context and compaction keep their text: instructions that arrive with a human prompt (Conductor system instructions, reminders, AGENTS.md) become an `injected_context` block after the prompt instead of being dropped; `injected_context` stores up to 16,384 characters, compaction summaries (Claude compact summaries, Codex `compacted` messages or replacement history) up to `TRANSCRIPT_RECORDS_TEXT_MAX_CHARS`, and meta records that carry content up to 4,096. Claude Code top-level attachments keep their content: `instructions`, `nested_memory` (with `file_path`), `mcp_instructions_delta`, `skill_listing` and `edited_text_file` are `injected_context`; a `queued_command` prompt the user typed while the agent worked is a genuine `user_prompt` with subtype `queued` (it starts a turn; a later user-message copy of it is meta `queued_prompt_mirror`); other attachments are meta `attachment:<type>` with their text. Non-compaction `system` records keep hook errors, added context, stop reasons, `preventedContinuation` (subtype suffix `:prevented`) and API errors as meta text with `is_error`; `isApiErrorMessage` assistant messages are meta `api_error_message` (error), not assistant text. A `tool_result` recorded while its process was still running (Codex `Process running with session ID`/`Script running` preamble without an exit code, a Claude background launch, an unfinished nested command) has subtype `running`; checks report it as `running`, never `pass`. Run `bun run --cwd apps/api backfill:transcript-records` to re-extract older generations. Version 5 also renders inline-image markers left by transcript slimming as `[screenshot <type> <size> sha256:<12 hex>]` (see Transcript slimming); both splitter changes ship in this one bump.
- **Receipts**: the committed generation of a session is its newest receipt by `(revision, parser_version)`. Readers resolve it once per operation and bind it into every query, so a crashed extraction is invisible and a concurrent publication cannot mix generations into one response. After publishing, a writer deletes crashed attempts at once and a superseded committed generation only after a 10 minute grace (`TRANSCRIPT_RECORDS_RETIRE_GRACE_MS`, measured from the receipt that superseded it). Every reader enforces a 60 second whole-operation deadline (`TRANSCRIPT_READ_DEADLINE_MS`), and the grace must stay longer than it. A generation deleted on purpose (a confirmed deletion fence) is rebuilt under a fresh insert-deduplication namespace (each write attempt has its own id), because ClickHouse remembers insert tokens after the rows are gone; a transient fence lookup failure never deletes anything. The next identical upload or the backfill repairs a missing receipt.
- **Ingest**: extraction runs in its own worker (`transcript-records.worker.ts`), separate from usage and skill extraction, streaming bounded batches to the API with backpressure. Admission is bounded per process (`TRANSCRIPT_RECORDS_QUEUE_MAX_JOBS`; `TRANSCRIPT_RECORDS_QUEUE_MAX_BYTES` is reserved for running and queued jobs alike, and cancelled or expired waiters leave the queue at once), one session may expand to at most `TRANSCRIPT_RECORDS_MAX_ROWS` records and runs under `TRANSCRIPT_RECORDS_TIMEOUT_MS`. It is best-effort (`TRANSCRIPT_RECORDS_EXTRACTION_ENABLED=false` skips it; failures, timeouts, and a full queue are logged and never fail an upload or the required extraction). Splitter: `packages/api-routes/src/session-transcript/transcript-records/` (import from `@rudel/api-routes/transcript-records`). Bump `TRANSCRIPT_RECORDS_PARSER_VERSION` when splitter output changes.
- **Deletion**: the table is part of the account and organization ClickHouse purge (`apps/api/src/services/org-session.service.ts`). Writers (ingest and backfill) call the deletion fence `assertNoClickHousePurgeTombstone` before every insert and remove their own rows when it throws, and every successful purge schedules one follow-up pass (`CLICKHOUSE_PURGE_FOLLOWUP_DELAY_MS`) that deletes again, and the job (the tombstone) is never expired while that follow-up is outstanding, its retention being measured from the last completed pass; the pattern is documented at the fence helper in `clickhouse-purge.service.ts`.
- **Backfill**: `bun run --cwd apps/api backfill:transcript-records` previews; add `--execute --cutoff <printed cutoff>` to write. It needs `PG_CONNECTION_STRING` for the deletion fence, is bounded (`TRANSCRIPT_RECORDS_BACKFILL_*`), and is resumable: sessions whose newest receipt already matches the newest raw revision and parser version are skipped. Sessions whose account or organization is being deleted are skipped and counted as `fencedCount`. Backfill applies ingest's bounds (`TRANSCRIPT_RECORDS_MAX_ROWS`, `TRANSCRIPT_RECORDS_TIMEOUT_MS`, or `--max-rows` / `--session-timeout-ms`): one absolute session deadline covers splitting, fence waits, data INSERTs, and receipt publication, with cancellation forwarded to ClickHouse. A session that expands or runs past its bounds is reported as a bounded skip (`skippedCount`), not a failure. Bound failures never delete shared generations: partial rows without a receipt are invisible and remain for retirement or TTL, preserving any concurrent ingest publication of that same generation.
- **Retirement**: daily API maintenance independently sweeps quiet sessions with superseded committed generations after the 10-minute retirement grace (longer than the enforced 60-second reader deadline). Receipts are the durable work census, so no new upload or in-memory timer is required; each pass processes at most 10 sessions and 100 generations per session, with scan caps and a shared 10-second maintenance deadline. Failed or unfinished sweeps resume from the remaining receipts on the next cron; no schema migration is needed.
- **Reconciliation**: daily API maintenance (`derived-records` step, 60-second budget) repairs extraction that ingest accepted but did not finish (`apps/api/src/services/derived-records-reconciliation.service.ts`): sessions ingested in the last 14 days (started at most 30 days before that) and quiet for 15 minutes whose newest raw revision has no transcript-records receipt are re-extracted from that exact raw revision through the ingest path (records, then git observations), and sessions whose committed records generation has no current git-observation receipt get git observations alone. Each run takes at most 200 candidates per source in a daily-rotating hash order (a session that keeps failing cannot block the rest), repairs at most 25 sessions, 64 MiB per session and 256 MiB in total, and checks the deletion fence before every write; larger or older sessions and parser upgrades are the backfills' job. A duplicate upload whose records receipt is current also repairs missing git observations, and a failed receipt lookup no longer counts as a current receipt (the upload is reprocessed; extraction stays best-effort). It runs only in the main project's daily maintenance (`/api/cron/repair`), never in the large-ingest worker; sessions above its per-session byte cap (64 MiB) are repaired by the backfills.
- **Readers**: `apps/api/src/services/transcript-records-reader.service.ts` (`readSessionFacts`, `readSessionMap`, `readTurn`, `readRecord`), tenant-scoped by `organization_id` + `user_id`, parameterized, pinned to one generation per call, validating every result row against a zod schema, and never reading `text` for facts or maps. `readTurn` charges every emitted string (actions, targets, paths, prompt, failures) against one `maxChars` budget. Raw views reserve an ordered representation of each non-meta record before sharing the remaining budget; full kind and numeric record/block identities survive, while text and optional metadata are cut explicitly (`[cut]`, or `…` for very short metadata fields). Stored heads are used when extraction exhausted its text budget. `readRecord` (and `read(depth=record)`) falls back to the record's exact raw line when storage kept fewer characters than the requested range: it reads `byte_start`/`byte_len` from the generation's own raw revision (`readRawTranscriptLine`), re-derives the line with `decodeTranscriptLine`, and uses the block only when its kind and character count match the stored row (`textFromRaw`); otherwise the capped text stands with `textTruncatedInStorage`. Only the row limit or a budget too small for the minimal representations omits an ordered suffix, with `truncated = true`.

## Live sessions

While a Claude Code or Codex session runs, a detached CLI follower (started by Claude Code's SessionStart hook, or registered by the Codex `notify` handler) streams new transcript lines (main transcript or rollout and every subagent or sub-agent thread) with `liveSession.append` (contract `packages/api-routes/src/live-session.ts`; opalinehq/cli vendors an identical copy). It is an additive view: session ingest at session end, `claude_sessions`, `transcript_records`, analytics and L1 are unchanged, and nothing reads live lines but the session pages.

- **Protocol**: per stream, `startLine` and the SHA-256 of the previous line (as sent) must continue the committed state; a lost response's retry is answered `already-committed`, anything else `out-of-sync` (the CLI resyncs with `liveSession.state`, or starts the stream over with `reset`, which moves it to a new generation).
- **Storage**: rows in Postgres (`live_session`, `live_session_stream`, `live_session_chunk`, migration 0063), keyed by workspace, source (`claude_code` or `codex`) and session id (a Codex thread id), so the two never collide; line bytes in R2 under `live/v1/<sha256(org)>/<source>/<sha256(session)>/<main|agent-<id>>/g<generation>/<start line>-<sha256 of the bytes, 32 hex>.jsonl`: an object is only ever written with the bytes its key names, so a write that lands late never replaces a committed chunk. Each line is slimmed (per record; Codex compaction dedupe is left to the CLI's stream slimmer) and secret-filtered like an upload before it is stored. An append writes its chunks to R2 first, without locks or a database connection, then in one transaction holding the session's row lock decides again and commits rows only for the objects written for that decision (deleting the rest); append transactions are gated below the live pool's 5 connections and fail fast with a retryable 503, so `state` never waits behind R2. A request carries at most 20,000 lines (`LIVE_SESSION_MAX_REQUEST_LINES`); NUL in stored text is a bad request.
- **Access**: the ingest API key, workspace membership, never another member's session (live or uploaded); appends neither claim session ownership nor count an agent run. Flags: `LIVE_SESSIONS_ENABLED`, `LIVE_SESSIONS_WORKSPACES`; `SESSION_INGEST_QUIESCED` and a missing R2 configuration pause it too. Budget: `RATE_LIMIT_LIVE_SESSION_*` (each line charges its bytes plus 256).
- **Web**: `analytics.sessions.liveList` and `liveTail`, readable like the session's detail (not served to the plugin app or the product demo). A tail response returns at most 3 MiB of lines (with subagents the main transcript leaves them 1 MiB; a subagent takes at most 512 KiB) and picks its chunks from their stored sizes before reading any, at most 256 objects; a cursor more than a tail (400 main / 100 subagent lines) behind gets the tail instead. Without a source, a tail reads the reader's own session before another member's with the same id. It says when the session's upload is stored (`uploaded`), which is when the page reads the detail again. The sessions page shows sessions active in the last 5 minutes above the list (polled every 5 seconds). The session page polls a live session's new lines every 2 seconds while it runs (updated in the last 5 minutes) and for 2 minutes after it ends, every 30 seconds while it is quiet without having ended or after a failed request: in place of the reader (without the session counter) until the session is uploaded, and above the reader while an uploaded session runs. A live-view failure only hides the live view.
- **Retention**: the hourly `/api/cron/live-sessions` deletes sessions 72 hours after their last activity, and the chunks of superseded generations, R2 objects first; a session it cannot clean is retried next run. It also lists up to 10,000 live objects from a random point and deletes those older than an hour without a chunk row (left by appends whose transaction failed). Account and workspace deletion snapshot the live objects into the purge (`clickhouse-purge.service.ts`); every pass of a workspace purge also deletes the workspace's objects by key prefix; the rows cascade. Live R2 calls share one client per process and time out after 10 seconds.

## Transcript slimming and inline images

Every upload is slimmed before secret filtering in the ingest filter worker (`apps/api/src/services/ingest-filter.worker.ts`, shared by direct ingest and R2 commit/repair), so released CLIs are covered. `slimTranscriptText` (`@rudel/api-routes/transcript-slim`) is a byte-for-byte port of the CLI's `apps/cli/src/lib/transcript-slim.ts` (`opalinehq/cli`): CLI-slimmed uploads pass through unchanged and every client stores one content hash. The shared parity fixtures `packages/api-routes/src/__fixtures__/transcript-slim/{input,expected}.jsonl` must stay identical in both repositories. Rules, per stream (main transcript and each subagent):

- Inline images become `opaline-image-omitted:v1;sha256=<hex of decoded bytes>;bytes=<decoded length>;type=<media type>`: any JSON string that is entirely a `data:image/...;base64,` URL (Codex `image_url`, `_meta["codex/toolSurface"].screenshot.url`, ...), Claude `source.data` (`media_type` kept), MCP `{type:"image", data, mimeType}` and Claude Read `toolUseResult.file.base64`, also inside JSON-encoded tool output. Payloads are found by parsing and replaced textually; data URLs inside longer text stay.
- Codex `CommandExecution` items and `exec_command_end` events keep `aggregated_output`; `stdout` is dropped only when equal to it and `formatted_output` only when equal to it or Codex's truncated rendering of it.
- A Codex `compacted` record drops `replacement_history`/`guardian_history` only when every item already appeared earlier in the stream (null and absent fields match).
- Structural edits apply only when re-serializing the record reproduces its bytes. Slimming is idempotent.

Sessions store `filter_version = SESSION_INGEST_FILTER_VERSION` (7: secret filter v6 after slimming v1; a test pins the combination). The secret filter's own `FILTER_VERSION` (6) is unchanged, so CLI wire stamps and GitHub evidence are unaffected. The shrink check (409 `SESSION_UPLOAD_SHRINK_REJECTED`) compares only shapes stored at the same or a newer session filter version (`isComparableIngestShapeVersion`): the first upload after the bump re-baselines a session stored by version 6 once; afterwards truncation is refused again. The bump changes every content hash, so each already-stored session is reprocessed once on its next upload (no backfill or sweep re-reads sessions). The redaction budget is measured against the slimmed text. Records render markers as `[screenshot <type> <size> sha256:<12 hex>]` (transcript records parser version 5); the session page shows "Screenshot taken (image not stored)". Stored sessions keep their bytes until re-uploaded.

## Session size limits

`INGEST_AGGREGATE_CONTENT_MAX_BYTES` (256 MiB) bounds one session's slimmed content (main plus subagents) over direct-to-R2 ingest (`ingest.init` contract, Postgres `ingest_job_expected_total_bytes_check`, migration 0053). Direct `ingestSession` stays at `INGEST_DIRECT_CONTENT_MAX_BYTES` (128 MiB; request bodies are capped at 160 MiB). The CLI mirrors both names. Session detail stays capped at 64 MiB.

Sessions up to 128 MiB ("standard", `STANDARD_SESSION_MAX_BYTES` in `apps/api/src/lib/ingest-size.ts`) behave as before. A larger R2 session:

- is never materialized inside `ingest.commit`. The commit stores its receipt as `R2_INGEST_COMMIT_QUEUED` and answers the retryable 503 with `queued: true`; the CLI polls `ingest.status`.
- is never selected by the main Vercel project. Its 2 GB ingest and 1 GB cron functions materialize and recover only jobs up to 48 MiB (`LARGE_INGEST_MIN_BYTES` in `apps/api/src/lib/ingest-size.ts`; materialization peaks near ten times the session size). A commit above that on a main-project function is queued exactly like a large session (retryable 503, `queued: true`) and left to the worker (`canMaterializeLargeR2IngestJobs()` is false on Vercel, whatever the environment says).
- is materialized in production by the separate large-ingest Vercel project. That project's root directory is `deploy/large-ingest`, with Function CPU set to Performance (4 GB / 2 vCPU). Its only cron, `/api/cron/large-r2-ingest`, runs every minute with `maxDuration` 800 s.
  - With `R2_LARGE_INGEST_WORKER=true` and at least 3,500 MB of function memory, it claims due sessions above 48 MiB (queued, retrying, or running with an expired lease) one at a time and alone in its process (`large-r2-ingest-worker.service.ts`). It uses the recovery code path, gate and budgets.
  - It starts a job only with at least 7 minutes of its 740 s budget left, and aborts a running job at the budget. The job is then recorded as a retry.
  - It holds a 5-minute job lease renewed by the heartbeat, so a killed invocation's job is reclaimed within 5 minutes.
  - `GET /api/health` reports worker mode, memory, R2 and whether the Bun worker files shipped. CI deploys the project after the main deploy when `VERCEL_LARGE_INGEST_PROJECT_ID` is set, and smoke-checks it.
- is also materialized by a resident Bun server (self-hosted, local), alone through its materialization gate. Such a server polls every 15 seconds for due large jobs (`startLargeR2IngestWatcher`).
- runs alone in the ingest filter and usage/skill extraction queues (admitted only into an empty queue) and in the transcript-records job gate (it waits for running jobs instead of being skipped). Standard budgets (`*_QUEUE_*_MAX_BYTES`) are unchanged.
- gets per-session budgets scaled by `scaleSessionBudget` (proportional above 128 MiB, 2x at 256 MiB): filter and usage timeouts, and transcript records' rows, text budget and deadline (ingest and backfill).

## Server git observations

`rudel.session_git_observations` stores observed commit hashes/subject hashes, push ranges, GitHub PR URLs/MCP creation results, CI status reads and Codex git metadata, including child streams. It performs no resolution or attribution. Since git extractor version 3:

- A push range carries the `To <remote>` it was pushed to in `repository_url` (credentials stripped); a new branch is a push range with empty SHAs; a forced update is labelled `forced_update`.
- Commit and push lines are recorded from every call that ran (an exit code, or no error), so a push that updates one ref and rejects another, or a commit followed by a failing command, keeps what happened. PR URLs still come only from successful calls.
- `ci_check` rows record `gh pr checks` and `gh run watch|view|list` invocations (parsed as shell commands, so text that merely mentions them does not count; `-R`/`--repo`, PR URLs and numbers, `--branch` or a branch target, `--commit` and the run id of `gh run view|watch <id>` are kept in `pr_repo`, `pr_number`, `branch`, `commit_hash` and `run_id`), and GitHub MCP calls that read runs, jobs or check status (the consolidated `actions_get`, `actions_list` and `pull_request_read` only for status, check, run or job methods). Failing and pending checks count. A shell check is labelled `unconfirmed` when the command does not show it ran: it follows `&&` or `||` unless the whole command is an `&&` chain that exited 0, or it sits in a compound construct. Calls that never ran or are still running are not recorded. The `run_id` column comes from `20261007180000_session_git_observation_run_ids.sql`, applied by the same `ch:migrate:session-git-observations` runner (and bootstrap) before version 3 deploys. Commit subjects are hashed, never persisted as text; free text is secret-filtered and capped at 512 characters.

Extraction follows receipt publication in ingest and transcript-records backfill, independently best-effort and off-thread. Per process: two active jobs, no waiting queue; per session: 30 seconds, 2,000 candidate calls/meta rows, 8,000 results, 10,000 observations, 64 MiB query results, and at most 256 raw reads totaling 16 MiB. Each raw byte range is at most 1 MiB and pins the exact raw revision and stream. Compound commands are selected by text, never `command_class`; successful results require no error and an evidence pattern (null Claude exit codes are accepted).

Identity is `(organization_id, user_id, source, session_id)`. Generation `parser_version` encodes `git extractor version * 256 + transcript parser version` (each component 1–255), so either parser advancing replaces the generation. An internal `receipt` sentinel in the same bounded synchronous INSERT commits even an empty generation and makes backfill resumable. Evidence consumers must exclude receipts and pin the newest receipt. `block_idx` encodes `source block * 65536 + match ordinal`, preserving every match in compound outputs under the requested replacing key. Superseded generations are removed by lightweight DELETE; all writers check the Postgres tombstone fence before and after publication and remove their session rows on a confirmed fence. Account/workspace purge and its durable follow-up cover the table.

Apply `bun run --cwd packages/ch-schema ch:migrate:session-git-observations` (also appended to production migrations and local bootstrap). Run `bun run --cwd apps/api backfill:git-observations` to preview after records backfill; execute with `--execute --cutoff <printed cutoff>`. `--organization-id` and `--max-sessions` (default 10,000, maximum 100,000) bound the census; extraction uses the same hard per-session bounds as ingest. The cutoff is receipt publication (`head.publishedAt`), not the transcript's earlier session timestamp. Changed generations after the preview are skipped, not silently included. Postgres is required for the deletion fence.

L1 edges (ADR 0003) are queued by git observation extraction, CLI captures, PR snapshots, GitHub sweeps and webhooks, repository binding, and the daily `l1-edge-census` maintenance step (sessions of the last 14 days whose scope is missing or stale). To queue existing sessions and repositories, preview with `bun run --cwd apps/api backfill:l1-edges --organization-id <id>` (or `--all-organizations`) and queue with `--execute`; `--max-sessions` and `--after <next>` page through. `backfill:run-index` queues run index builds the same way, and `retire:transcript-records` removes the superseded transcript generations a transcript backfill leaves behind. `audit:l1` is a read-only before/after report. The worker builds queued scopes when `L1_EDGES_WORKER_ENABLED=true`. Follow `docs/l1-backfill-runbook.md` for production.

`rudel.run_index` (docs/l1-literal-schema.md, "Scale") stores the `runs` view per committed transcript-records generation: one row per run and a receipt per build, keyed by the generation and the worker's build revision, so every build is an immutable snapshot and the newest receipt names the build readers read. Runs and their free text are kept until a deletion request: no TTL and no age-based reads (`20261010120000_run_index.sql` created the TTLs; `20261011120000_l1_retention_removed.sql` removes them, see below). Apply it with `bun run --cwd packages/ch-schema ch:migrate:run-index` (also in production migrations and local bootstrap); the runner journals only after every replica serves the table, its key and comments. The account and workspace purges cover it. The L1 worker builds it per session (scope kind `run_index`, built when `L1_EDGES_WORKER_ENABLED=true`), its request rides on the edges' request after git observations are written (one statement; no upload path waits on the queue for it), and the daily maintenance `run-index-census` step queues recently ingested sessions whose committed snapshot is missing or stale (transcript generation, index or pricing version, usage extraction). Readers use the API's run index reader (`services/analysis/run-index-reader.ts`), which pins the committed snapshot and nulls expired text. The daily `run-index` step retires snapshots no reader needs after the transcript-records grace.

`rudel.weekly_totals` (docs/l1-literal-schema.md, "Weekly totals") holds the run index summed per workspace, member, agent and ISO week, read by `find source=weekly` (`services/analysis/weekly-totals.ts`), which shows every member of a workspace all of its rows (`findScope` in `services/analysis/scope.ts`), never another workspace's. The refreshable view `weekly_totals_mv` (`20261011150000_weekly_totals.sql`, hand-written because chkit cannot express REFRESH) appends a full snapshot every night at 03:00 UTC and once when it is created, from each session's committed build only. Production's `rudel` database is Atomic, so ClickHouse does not coordinate refreshes and each replica appends its own snapshot: that is why the view APPENDs instead of replacing the table, and readers read only the newest complete snapshot (`weeklyTotalsSnapshotSql`). Snapshots expire after 14 days (day partitions, `ttl_only_drop_parts`). Apply it with `bun run --cwd packages/ch-schema ch:migrate:weekly-totals` (last step of `ch:migrate:production` and in local bootstrap); the runner journals only after the table and the view's schedule, APPEND mode, target and source read back. The account and workspace purges cover the table. To see refreshes, read `system.view_refreshes` on each replica (`clusterAllReplicas`). To refresh now, `SYSTEM REFRESH VIEW rudel.weekly_totals_mv` (on one replica).

## L1 retention

Raw transcripts (`claude_sessions`, `codex_sessions`), `transcript_records`, `run_index` and `session_lineage` are kept **until a deletion request**: no TTL, no age-based maintenance job, no age-based reads. Account deletion (`profile.deleteMine`, admin `deleteUser`) and workspace deletion enqueue a ClickHouse purge (`org-session.service.ts`, `getClickHouseSessionPurgePlans`), the only cleanup of these tables, so every ClickHouse table that holds an owner column must be in that plan (`apps/api/src/__tests__/l1-deletion-coverage.test.ts` fails otherwise). `20261011120000_l1_retention_removed.sql` removes the TTLs the earlier migrations installed (`session_language_signals` keeps its 365-day TTL: derived phrases, not L1); apply it with `bun run --cwd packages/ch-schema ch:migrate:l1-retention` (last step of `ch:migrate:production`, journaled only after every replica serves the five tables without a TTL, and re-verified on every deploy: it fails if a TTL comes back). It cannot restore rows a TTL merge already deleted. Table by deletion path: `docs/l1-retention.md`.

## Releasing

This repository does not release the CLI. The published CLI (npm `rudel` and `opaline`) is built and released from [opalinehq/cli](https://github.com/opalinehq/cli). Make CLI changes there.

`apps/cli` stays in this repository only as a test harness for the API. Change it only to keep the API tests working. Do not add CLI features to it and do not publish it. Its `package.json` is `private` to prevent accidental publication.

## Tests earn their place

Keep a test only if it catches something no other test catches. `bun run test:kill-matrix <module.ts>` runs every mutant of a module against each of its tests alone and lists the tests that kill no unique mutant. How to run it and what to remove: `.claude/skills/testing-bun/SKILL.md` ("Every Test Earns Its Place").

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
