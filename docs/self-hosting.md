# Self-Hosting Opaline

This guide walks through deploying Opaline using **ObsessionDB** (ClickHouse), **Neon** (Postgres), and **Fly.io** (app server). It is one supported self-hosting stack; production infrastructure may differ.

> **This is an opinionated guide.** Opaline is a Bun server that needs Postgres and ClickHouse — it can run anywhere those are available. You don't have to use these specific providers. Any Postgres instance, any ClickHouse instance (that supports `SharedReplacingMergeTree` or `ReplacingMergeTree`), and any platform that can run a Bun/Node.js server will work. This example uses ObsessionDB, Neon, and Fly.io because they all have free tiers and are easy to set up.

## Services

| Component | Provider | Free Tier | Purpose |
|-----------|----------|-----------|---------|
| **ClickHouse** | [ObsessionDB](https://obsessiondb.com) | Yes | Session transcript storage and analytics |
| **Postgres** | [Neon](https://neon.tech) | Yes (0.5 GB) | Authentication (users, sessions, accounts) |
| **App Server** | [Fly.io](https://fly.io) | Yes (3 shared VMs) | HTTP API + static frontend serving |

## 1. Provision ClickHouse (ObsessionDB)

1. Create an account at [obsessiondb.com](https://obsessiondb.com)
2. Create a new ClickHouse instance
3. Note your connection details:
   - **Host** — the HTTPS endpoint (e.g. `https://your-instance.obsessiondb.com`)
   - **Username** — your username
   - **Password** — your password
4. Apply the schema migration:

```bash
# From the repo root — set the env vars that chkit reads
CLICKHOUSE_URL=https://your-instance.obsessiondb.com \
CLICKHOUSE_USERNAME=your-username \
CLICKHOUSE_PASSWORD=your-password \
CLICKHOUSE_DB=default \
  bun run --cwd packages/ch-schema ch:bootstrap
```

Bootstrap replays the checked-in migrations into an empty `rudel` database, including the controlled F16 migration and its live verification checkpoints. It establishes `subagent_count` before the historical analytics-view recreation, without editing any historical SQL or its journal checksum. Run it before starting any API writers; this offline path assumes one writer endpoint. Existing local installations with an ordered, checksum-verified journal prefix receive only the missing migrations, through the controlled F16 runner, existing forward scripts, or stock chkit restricted to each pending migration. As with fresh replay, this local path permits checked-in destructive DDL and must not run against production. Production upgrades continue to use the controlled forward migration scripts, not bootstrap or a historical replay.

Bootstrap is a no-op when the complete ordered history is already journaled with its original checksums. It refuses unjournaled existing tables, gaps, reordered/unknown/duplicate entries, checksum mismatches, and partial F16 state. Interrupted F16 migrations require the controlled recovery procedure. If a disposable fresh bootstrap fails, drop both `rudel` and `default._chkit_migrations` before retrying; never do this on an existing installation.

Local ClickHouse also needs the historical storage policy named `s3`. Docker Compose and CI mount `.github/clickhouse/config.d/storage-policy.xml`, which maps its `default` volume to the local default disk; no actual S3 service is needed.

> **Note**: `CLICKHOUSE_DB` must be set to `default` for the migration because the `rudel` database doesn't exist yet — the migration creates it. Use `CLICKHOUSE_USERNAME` throughout; `CLICKHOUSE_USER` is accepted as a legacy fallback, and setting both to different values is an error.
>
> `CLICKHOUSE_USERNAME` is **required** for a hosted endpoint. The migration tool assumes the `default` superuser only when the URL is local (`localhost`/loopback), so a missing username against a remote host fails loudly instead of quietly connecting as `default`.

## 2. Provision Postgres (Neon)

1. Create an account at [neon.tech](https://neon.tech)
2. Create a new project and database named `rudel`
3. Copy your connection string (looks like `postgres://user:pass@host/rudel?sslmode=require`)
4. Run the Drizzle migrations:

```bash
PG_CONNECTION_STRING="postgres://user:pass@host/rudel?sslmode=require" \
  bun run --cwd packages/sql-schema migrate
```

This creates the auth tables (users, sessions, accounts, verification tokens) used by `better-auth`.

### Ingest rate-limiter deployment contract

Postgres migration `0028_postgres_ingest_rate_limit.sql` must be applied before
deploying API code that uses the Postgres-backed ingest limiter. The Fly CI
workflow already runs Postgres migrations before `flyctl deploy`; manual,
Vercel, and other self-hosted deployment processes must preserve that order.

The limiter fails closed. If Postgres is unavailable, ingest returns HTTP 503
with the `SERVICE_UNAVAILABLE` code and does not continue to downstream
storage. The current CLI treats 503 as retryable and makes at most three total
attempts, waiting 1 second and then 2 seconds between attempts.

Request and byte budgets are per authenticated user and are shared by all API
keys owned by that user. Rejection caches are local to each API instance, so
their database-shedding effectiveness and cached 429 responses are likewise
per instance rather than globally shared. Cache deadlines are bounded by the
configured window duration. If the Postgres wall clock is corrected forward
after a deadline is cached, an instance can continue returning that cached 429
until its monotonic deadline passes even though a fresh database statement
would already roll the window. When changing rate-limit window or cap
configuration, restart or drain all API instances together: an instance running
old configuration can serve cached rejections computed under the old windows
until its cached deadlines pass.

## 3. Deploy to Fly.io

1. Install the Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Sign up or log in: `fly auth login`
3. Create a new app:

```bash
fly launch --name your-app-name --no-deploy
```

4. Set secrets:

```bash
fly secrets set \
  PG_CONNECTION_STRING="postgres://user:pass@host/rudel?sslmode=require" \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  CLICKHOUSE_URL="https://your-instance.obsessiondb.com" \
  CLICKHOUSE_USERNAME="your-username" \
  CLICKHOUSE_PASSWORD="your-password" \
  APP_URL="https://your-app-name.fly.dev" \
  ALLOWED_ORIGIN="https://your-app-name.fly.dev"
```

5. Deploy (the `Dockerfile` in the repo root handles building the frontend and running the API):

```bash
fly deploy
```

6. Verify it's running:

```bash
curl https://your-app-name.fly.dev/health
```

### Custom domain

If you want to use a custom domain instead of `*.fly.dev`:

```bash
fly certs add your-domain.com
```

Then update `APP_URL` and `ALLOWED_ORIGIN` to match:

```bash
fly secrets set \
  APP_URL="https://your-domain.com" \
  ALLOWED_ORIGIN="https://your-domain.com"
```

## Social Login (Optional)

To enable GitHub or Google OAuth login, create OAuth apps with the respective providers and set the client credentials:

```bash
fly secrets set \
  GITHUB_CLIENT_ID="your-client-id" \
  GITHUB_CLIENT_SECRET="your-client-secret"
```

Set the OAuth callback URL to `https://your-domain.com/api/auth/callback/github` (or `/google`).

Without these, users can still sign up and log in with email codes. Password sign-in is limited to the emails in `PASSWORD_AUTH_EMAILS` (`*` allows everyone).

## GitHub Repository Evidence (Optional)

Repository evidence uses a separate, read-only GitHub App. Its credentials are
not interchangeable with `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, which
configure social login.

Configure the GitHub App with these repository permissions set to read-only:
Actions, Checks, Contents, Metadata, Pull requests, and Commit statuses. Leave
**Request user authorization (OAuth) during installation** disabled so the App
can use a Setup URL. Set both the App's **Setup URL** and one of its **Callback
URLs** to the public API callback:

```text
https://your-api-domain.com/api/github/setup
```

Then configure all of the repository App variables:

```bash
GITHUB_REPOSITORY_APP_ID="numeric-app-id"
GITHUB_REPOSITORY_APP_SLUG="your-app-slug"
GITHUB_REPOSITORY_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GITHUB_REPOSITORY_APP_CLIENT_ID="your-github-app-client-id"
GITHUB_REPOSITORY_APP_CLIENT_SECRET="your-github-app-client-secret"
GITHUB_REPOSITORY_APP_CALLBACK_URL="https://your-api-domain.com/api/github/setup"
GITHUB_REPOSITORY_APP_STATE_SECRET="at-least-32-random-characters"
GITHUB_REPOSITORY_APP_WEBHOOK_SECRET="at-least-32-random-characters"
```

`GITHUB_REPOSITORY_APP_STATE_SECRET` may be omitted to use
`BETTER_AUTH_SECRET`. Any missing or partial repository App configuration makes
the connection control unavailable instead of accepting an unverified
installation.

The user-facing GitHub experience (the workspace settings GitHub section and the
dashboard's Merged PRs metric) stays hidden until you also set
`GITHUB_EVIDENCE_UI_ENABLED=true`. Collection, the maintenance cron, and
webhooks do not depend on it.

Connection is a two-step GitHub flow. The Setup URL returns an installation ID,
then Opaline requests a short-lived GitHub App user authorization and verifies
the signed-in GitHub user's access to that exact installation. The user token
is used once and is not stored. Opaline binds only the repositories returned by
GitHub for both that user and that installation; repositories accessible only
to the App are not added to the workspace. This association check does not
grant or prove GitHub organization-owner status. Opaline separately requires
the connecting user to be an owner or administrator of the Opaline workspace.
The repository set is a verified snapshot. Use **Reconnect** in workspace
settings after changing GitHub repository selection or user access; Opaline
does not continuously synchronize later GitHub user-access revocations.

Accepting a repository capture only records a durable collection request; the
GitHub calls run afterwards in the bounded evidence worker. The resident worker
(Fly) is woken immediately and otherwise polls every five minutes. Deployments
without a resident worker (Vercel) collect on the scheduled maintenance cron.
Collection persists each filtered job log as it is fetched, stops fetching logs
after a 256 MiB per-collection budget (recorded as partial coverage), and runs
at most two collections per API process. Objects are registered in a durable
intent table before they are written, so an interrupted collection or a
workspace deletion can always find and remove them.

### GitHub App webhooks (optional)

Webhooks make merges and CI results appear within minutes instead of after the
next reconciliation cron run. On Vercel, the webhook acknowledges with HTTP 202
and registers a platform-managed `context.waitUntil` continuation: it waits
30 seconds plus 1 second of timer slack, then collects only the affected
collection identities in batches of at most 25 under one 240-second pass
budget. The function's 300-second maximum duration covers both debounce and
collection. Concurrent attempts retain the existing reservation and lease
protection; unfinished work remains durable for the reconciliation cron. Self-hosted
Bun/Fly servers still wake their resident worker, which otherwise polls every
five minutes. In the App settings, activate the webhook, set the
**Webhook URL** to `https://your-api-domain.com/api/webhooks/github`, set the
**Webhook secret** to the value of `GITHUB_REPOSITORY_APP_WEBHOOK_SECRET`
(generate it with `openssl rand -hex 32`), and subscribe to **Pull request**,
**Check suite**, **Workflow run** and **Status**. Installation events are sent
to every App automatically. No permission beyond the read-only set above is
required.

The endpoint rejects unsigned or mis-signed requests, deduplicates by
`X-GitHub-Delivery`, and only schedules work: a pull request or CI event for a
bound repository pulls the next refresh of the matching session-linked
collections forward (debounced by 30 seconds), and installation events keep
installation and repository-binding state current. Events for installations or
repositories that are not bound to a workspace are dropped without being
stored, and payloads are never persisted. Added repositories are not bound
automatically; use **Reconnect**. Without the secret the endpoint responds 503
and the reconciliation cron remains the only refresh path. The cron also remains the
fallback for missed deliveries in any configuration.

## Direct-to-R2 Ingest Lifecycle Backstop

When direct-to-R2 ingest is enabled, configure an object lifecycle rule on the
ingest bucket with the prefix `ingest/` and a seven-day object expiration. The
application job sweeper and terminal-state cleanup are the primary deletion
mechanisms; this lifecycle rule is defense in depth for completed objects that
survive an application or database outage. Cloudflare's default seven-day rule
only aborts incomplete multipart uploads and does not delete completed objects.

In the Cloudflare dashboard, open the bucket's **Settings** page and add an
enabled Object Lifecycle Rule with these values:

- Rule name: `expire-abandoned-ingest-objects`
- Prefix: `ingest/`
- Delete objects after: `7 days`

Verify the rule after provisioning with:

```bash
npx wrangler r2 bucket lifecycle list <bucket-name>
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PG_CONNECTION_STRING` | Yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (`openssl rand -base64 32`) |
| `PASSWORD_AUTH_EMAILS` | No | Comma-separated, case-insensitive emails allowed to sign in or sign up with a password; `*` allows everyone. Missing or empty allows nobody |
| `CLICKHOUSE_URL` | Yes | ClickHouse HTTPS endpoint |
| `CLICKHOUSE_USERNAME` | Yes | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | Yes | ClickHouse password |
| `R2_ACCOUNT_ID` | No | Cloudflare account ID for optional EU-jurisdiction direct-to-R2 ingest |
| `R2_ACCESS_KEY_ID` | No | R2 S3 access key ID; all three R2 variables are required to enable the protocol |
| `R2_SECRET_ACCESS_KEY` | No | R2 S3 secret access key |
| `APP_URL` | Yes | Public URL of the deployed app |
| `ALLOWED_ORIGIN` | Yes | CORS origin (same as `APP_URL` for single-domain) |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth client secret |
| `GITHUB_REPOSITORY_APP_ID` | No | Numeric ID of the repository evidence GitHub App |
| `GITHUB_REPOSITORY_APP_SLUG` | No | URL slug of the repository evidence GitHub App |
| `GITHUB_REPOSITORY_APP_PRIVATE_KEY` | No | Private key used only for GitHub App JWTs |
| `GITHUB_REPOSITORY_APP_CLIENT_ID` | No | Client ID of the same repository evidence GitHub App |
| `GITHUB_REPOSITORY_APP_CLIENT_SECRET` | No | Client secret used for the one-shot user authorization exchange |
| `GITHUB_REPOSITORY_APP_CALLBACK_URL` | No | Public `/api/github/setup` URL registered as the App Setup and OAuth callback URL |
| `GITHUB_REPOSITORY_APP_STATE_SECRET` | No | Dedicated 32+ character callback-state secret; defaults to `BETTER_AUTH_SECRET` |
| `GITHUB_REPOSITORY_APP_WEBHOOK_SECRET` | No | 32+ character GitHub App webhook secret; enables `/api/webhooks/github` |
| `GITHUB_EVIDENCE_UI_ENABLED` | No | Set to `true` to show the Merged PRs dashboard metric and the workspace settings GitHub section. Evidence collection runs regardless; missing or invalid values keep the UI hidden |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

## Vercel Hobby and the frequent crons

`vercel.json` schedules `/api/cron/r2-ingest` every minute, so ingest jobs that were left pending during a ClickHouse outage are picked up again within minutes. It also runs `/api/cron/github-evidence` every five minutes: Vercel has no resident worker, so pending GitHub evidence collections and the repository history sweep only advance when this cron runs (up to about four minutes per run; an idle run returns immediately). `/api/cron/l1-edges` runs every minute and builds the L1 edges between sessions, pull requests and CI runs when `L1_EDGES_WORKER_ENABLED=true` (otherwise it returns immediately and requests stay queued). `/api/cron/run-questions` runs every minute and answers queued run questions when a provider is configured (`SUBQ_API_KEY`; otherwise it returns immediately). Vercel Hobby only allows daily cron jobs and rejects deployments with more frequent schedules. On Hobby, remove the `/api/cron/r2-ingest` entry and change `/api/cron/github-evidence`, `/api/cron/l1-edges` and `/api/cron/run-questions` to a daily schedule. The daily `/api/cron/repair` job still re-picks pending ingest jobs, and the initial GitHub history then takes much longer to complete.
