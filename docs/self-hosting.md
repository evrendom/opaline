# Self-hosting Opaline

A self-hosted Opaline server is a single-team install: every feature is on, there are no plans or
billing, nothing is sent to Stripe, PostHog, Sentry or Slack, and the background jobs run inside
the server.

What runs:

| Part | Holds |
| --- | --- |
| Opaline server (Bun) | API, MCP endpoint, dashboard, background jobs |
| Postgres | Accounts, workspaces, invites, saved answers |
| ClickHouse | Sessions and everything computed from them |
| Object storage | Large uploads, evidence images and transcripts. A directory on disk by default, or any S3-compatible store |

## Pick a setup

| You want | Use |
| --- | --- |
| Opaline for yourself, on your Mac | The [Mac app](../README.md). It brings its own server, Postgres and ClickHouse and needs no setup |
| A server for a team, on a NAS, VM or small server | The Docker Compose stack in [`deploy/selfhost`](../deploy/selfhost/README.md) |
| ClickHouse on a NAS, the server somewhere else | `deploy/selfhost/install.sh --clickhouse-only` on the NAS, then the server with `CLICKHOUSE_URL` |
| Your own Postgres and ClickHouse | [Running the server without Docker](#running-the-server-without-docker) |

The published CLI (`npx opaline@latest`) uploads sessions to a server and signs in to it. It has no
command that starts a server yet.

## The Docker stack

`deploy/selfhost` runs Opaline, Postgres 17 and ClickHouse, with an optional Caddy for HTTPS. The
server package (`@opalinehq/server`) is not on npm yet, so build it from a checkout of this
repository first:

```sh
bun install
bun run build:selfhost --version 0.18.0     # writes dist-selfhost/opaline-server-0.18.0.tgz + .json
```

Copy `deploy/selfhost` and the two files to the machine, then:

```sh
./install.sh --artifact opaline-server-0.18.0.tgz --email you@example.com --workspace "Acme"
./install.sh --artifact opaline-server-0.18.0.tgz --domain opaline.example.com --email you@example.com   # with HTTPS through Caddy
```

`install.sh` writes `.env` with fresh secrets, builds the image, starts the stack, creates your
owner account and prints a sign-in link plus the command each computer runs to connect. Its
[README](../deploy/selfhost/README.md) covers requirements, profiles, settings
(`compose.override.yaml`), logs, upgrades and the volumes to back up. Run `./install.sh` again for
a new sign-in link.

## ClickHouse on a NAS

On the NAS, from `deploy/selfhost`:

```sh
./install.sh --clickhouse-only
```

It starts only ClickHouse, on the LAN at port 8123 with the user `opaline`, and prints the
`CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD` for the server. Start the server
on the other machine with them, as in
[Running the server without Docker](#running-the-server-without-docker). ClickHouse speaks plain
HTTP here, so keep port 8123 on your LAN.

## Your own ClickHouse

The server needs these grants on the `rudel` database: CREATE TABLE, INSERT, SELECT, ALTER, and
CREATE DATABASE when `rudel` does not exist yet. It creates or upgrades the schema itself on start.
It probes what the ClickHouse supports (`Shared*MergeTree` engines, an `s3` storage policy) and
creates plain tables on the default disk where they are missing; `CLICKHOUSE_FLAVOR=oss|cloud`
skips the probe.

## Teammates

Sign-up is invite-only. The owner account comes from setup; everyone else needs one of:

- the workspace invite link from Settings, Members, Invite link (valid 7 days, until replaced or
  revoked), or
- an invitation for their email from Settings, Members (no email is sent unless `RESEND_API_KEY`
  is set; copy the link it shows and send it yourself).

The teammate opens the link, creates an account with a password, then connects their machine:

```sh
npx opaline@latest login --api-base https://opaline.example.com
```

For a plain-HTTP server on the LAN add `--allow-insecure-api-base`. Their agents connect to the MCP
endpoint as described in [Connect your agents](#connect-your-agents-mcp).

`OPALINE_OPEN_SIGNUP=1` lets anyone who can reach the server sign up without an invite. The server
enforces invite-only itself, for password, email-code and social sign-up alike; the sign-up page
only explains it.

## Sign-in links and passwords

There is no email by default, so sign-in links replace "forgot password":

| You need | Do |
| --- | --- |
| The dashboard, as the owner | Run `./install.sh` again on the server (link valid 10 minutes, once) |
| A link for a teammate | The link icon on their row in Settings, Members (valid one hour, once) |
| A new password | Settings, Account, Password |

Owners can make a link for anyone in their workspace, admins for anyone but an owner. Right after
signing in with a link, a password can be set without the old one for an hour; otherwise the
current password is required. Changing it signs you out in other browsers; CLI and MCP API keys
keep working. Every link made for someone else, and every password change, is logged at info level
with user ids (never the link).

Links come from `POST /api/selfhost/login-link` with the setup token (`X-Opaline-Setup-Token`), an
API key (`x-api-key` or `Authorization: Bearer`) or a browser session, and an optional
`{ "email": "…" }`.

## Connect your agents (MCP)

Claude Code, Codex and Cursor connect to `<server>/api/mcp` with an API key sent as a bearer token.
Settings, MCP in the dashboard shows the exact entry for each:

| Agent | Where it goes |
| --- | --- |
| Claude Code | `claude mcp add --scope user --transport http opaline <server>/api/mcp --header "Authorization: Bearer <key>"` |
| Codex | `[mcp_servers.opaline]` with `url` and `http_headers` in `~/.codex/config.toml` |
| Cursor | The `opaline` entry in `~/.cursor/mcp.json` |

claude.ai and ChatGPT connectors are different: their servers call your `/api/mcp` from the
internet and sign in with OAuth, so the server needs a public HTTPS URL. Two ways:

- **Your domain.** Run the Docker stack with `--domain`, or put any reverse proxy in front of port
  4100 and set the server's public URL (`./install.sh --public-url https://opaline.example.com`).
- **Tailscale Funnel.** On the server's machine run `tailscale funnel --bg 4100`, then
  `./install.sh --public-url https://<machine>.<tailnet>.ts.net`.

Use that URL for the dashboard from then on: the server trusts browser requests only from its
public origin. Add `https://…/api/mcp` as a custom connector in claude.ai (Settings, Connectors) or in
ChatGPT (a custom connector, in developer mode). Anyone on the internet can now reach the sign-in
page; invite-only sign-up is what keeps them out, so leave `OPALINE_OPEN_SIGNUP` unset.

## Settings

In the Docker stack, extra settings are environment variables of the `opaline` service in
`compose.override.yaml` (see the stack's README). Without Docker, set them in the server's
environment.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPALINE_OPEN_SIGNUP` | unset | `1`: anyone who reaches the server can sign up |
| `OPALINE_SQL_QUOTA_PER_HOUR` | unset (no quota) | Limit `sql`, `run`, `measures`, `patterns` and `search` calls per workspace per hour |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_ENDPOINT` | local disk | S3-compatible object storage, below |
| `OPENAI_API_KEY` | unset | Embeddings for search by meaning and for finding saved answers; without it search matches exact text and regexes, and saved answers use local word vectors |
| `RESEND_API_KEY` | unset | Email: sign-in codes and invitation emails |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Social sign-in; callback `<public URL>/api/auth/callback/github` (or `/google`). Invite-only still applies |
| `ANTHROPIC_API_KEY` | unset | Compass moment observations |
| `SUBQ_API_KEY` | unset | Run question tags and the frustration check |
| `GITHUB_TOKEN`, `GH_TOKEN` | unset: the GitHub CLI's login | Read-only GitHub token for pull requests and CI, below |
| `GH_HOST`, `GH_CONFIG_DIR` | `github.com`, gh's default | Which host and which gh configuration `gh auth token` uses |
| `OPALINE_GITHUB_HISTORY_DAYS` | 90 | Days of pull request and CI history read for a new repository (1 to 730) |

### Object storage

By default objects live in the server's data directory (`<OPALINE_DATA_DIR>/object-store`; the
`opaline_opaline-data` volume in the Docker stack) and the server signs its own upload and download
URLs. To use S3, MinIO, SeaweedFS or R2 instead, set `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and either `S3_ENDPOINT` or (AWS) `S3_REGION`. With `S3_ENDPOINT` set,
path-style addressing is on unless `S3_FORCE_PATH_STYLE=false`.

The CLI uploads large sessions and the dashboard loads images straight from presigned URLs, so
every CLI and browser must reach the URL they are signed for. When the server reaches the store at
an internal address, such as `http://seaweedfs:8333` inside Docker, set `S3_PUBLIC_ENDPOINT` to the
address everyone else uses, such as `http://nas.local:8333`. Presigned URLs are signed for that
host; the server keeps using `S3_ENDPOINT`.

### GitHub pull requests and CI

The server reads pull requests, reviews, checks, Actions runs and their logs with a read-only GitHub
token. It uses the first it finds:

1. `GITHUB_TOKEN`, then `GH_TOKEN`, in the server's environment;
2. the GitHub CLI's login where the server runs (`gh auth token`).

The Docker image has no GitHub CLI, so there it needs `GITHUB_TOKEN` in `compose.override.yaml`. A
server you run yourself on your own computer usually needs nothing, or once:

```sh
gh auth login --scopes repo
```

A classic token needs the `repo` scope for private repositories and their CI logs. A fine-grained
token needs read access to Contents, Metadata, Pull requests, Actions, Checks and Commit statuses of
the repositories it should cover.

There is nothing to connect and no webhook. Every five minutes the server reads the git remotes of
the sessions uploaded to each workspace, asks GitHub which of those repositories the token can read,
and collects them: the last 90 days at first (`OPALINE_GITHUB_HISTORY_DAYS`), then what changed.
Repositories the token cannot read are skipped and asked about again every six hours. The token is
read when it is needed and never stored or logged, so `gh auth login` or a new token takes effect
within a minute, without a restart.

Settings, GitHub shows where the token comes from, its account and scopes, the repositories it
collects and the ones it cannot read, the last sweep and the rate limit, and the command that fixes
a missing token. The server log has a `github:` line at startup.

A user token may make 5,000 requests an hour. Collection uses at most half of what is left and then
waits for the hour to renew, so your own `gh` keeps working; the first pass over a busy repository
can therefore take an hour or two.

On a server shared with teammates, anyone who can upload sessions to a workspace can make the server
collect any repository the token can read, by naming it as a git remote. Give a shared server a
token that reads only the team's repositories (a fine-grained token, or one of a machine account).

`GH_HOST` points `gh auth token` and the API at GitHub Enterprise Server. Pull requests and CI are
collected there too, but sessions link to them in the run index only for `github.com` remotes.

The GitHub App (`GITHUB_REPOSITORY_APP_*`) is for the hosted service; a self-hosted server ignores
those variables.

## Memory and disk

- ClickHouse gets a memory cap: 3 GiB in the Docker stack (`CLICKHOUSE_MEMORY`). Do not go below
  2 GiB: run index queries need 0.5 to 0.9 GiB each, and at 2 GiB the first insert of a 140 MiB
  session needed a retry. 3 GiB is enough for a small team.
- The server and Postgres take up to about 1.5 GiB at peak (preparing a 136 MiB session's detail
  view added 0.6 GiB). Plan for 4 GiB of RAM in total, 8 GiB for large sessions.
- ClickHouse stores about 1 MiB per session. Repository evidence (transcripts, images, saved
  outputs) sits in object storage at its raw size; staged uploads are deleted after 7 days.

## Backups

- Docker stack: the volumes `opaline_postgres-data`, `opaline_clickhouse-data` and
  `opaline_opaline-data`, plus `.env`, whose secrets (auth secret, setup token, database passwords)
  a restored copy needs. Keep the copy private.
- A server you run yourself: back up Postgres, ClickHouse and `OPALINE_DATA_DIR` with your usual
  tools, and keep `BETTER_AUTH_SECRET`.

## Upgrades

- Docker stack: build the newer package and run `./install.sh --artifact <newer tgz>`.
- Postgres migrations and the ClickHouse schema upgrade run on every start and do nothing when there
  is nothing to do; they only go forward, so an older release may refuse the newer schema.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Anything (Docker stack) | `docker compose ps`, then `docker compose logs --tail 200 opaline` |
| "This sign-in link expired or was already used" | Run `./install.sh` again, or ask an owner for a link from Settings, Members |
| "This Opaline server is invite-only" | Open an invite link from an owner or admin, or set `OPALINE_OPEN_SIGNUP=1` |
| "ClickHouse ran out of memory for all of its queries" | Raise the ClickHouse memory cap |
| A teammate's CLI refuses `http://` | `npx opaline@latest login --api-base http://… --allow-insecure-api-base` |
| The server stops answering for minutes after a very large upload | Known: the first view of a session above about 100 MiB is prepared in the server process (136 MiB took 166 s). It recovers by itself |
| Evidence of a transcript above 128 MiB is incomplete | It is sent in several deliveries; `npx opaline@latest upload --retry` sends what is left |
| Agents do not see the Opaline tools | Add the entry from Settings, MCP, then restart the agent |
| Settings, GitHub says "No token" | `gh auth login --scopes repo` where the server runs, or `GITHUB_TOKEN=…` in `compose.override.yaml` |
| A repository is missing from Settings, GitHub | Its sessions need a GitHub remote, and the token must be able to read it (otherwise it is listed as not readable); new ones appear within five minutes of the first upload |

## Running the server without Docker

`bun apps/api/src/selfhost/main.ts` (from a checkout or the packaged server) is the entry point the
Docker image and the Mac app run. It validates the environment and reports every problem at once,
migrates Postgres, creates or upgrades the ClickHouse schema, serves the API, MCP and dashboard,
runs the jobs, and prints `ready <url>` on stdout. From a checkout, build the dashboard first:

```sh
bun install
bun run --cwd apps/web build && bun run --cwd apps/web build:widget
OPALINE_WEB_DIR=apps/web/dist PG_CONNECTION_STRING=… CLICKHOUSE_URL=… BETTER_AUTH_SECRET=… \
  bun apps/api/src/selfhost/main.ts
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `PG_CONNECTION_STRING` | Yes | Postgres; its user must own the database |
| `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` | Yes (username for non-local hosts) | ClickHouse HTTP interface |
| `BETTER_AUTH_SECRET` | Yes | 32+ characters |
| `PORT`, `HOST` | No | Default 4100 and 127.0.0.1 |
| `APP_URL`, `ALLOWED_ORIGIN` | No | Public origin; default `http://localhost:<PORT>` |
| `OPALINE_SETUP_TOKEN` | No | 16+ characters; enables `POST /api/selfhost/setup` (first account) and setup-token sign-in links |
| `OPALINE_DATA_DIR` | No | Server files, including the local object store |
| `OPALINE_WEB_DIR` | No | The built web app (`apps/web/dist`); without it the server is API only |
| `CLICKHOUSE_FLAVOR` | No | `auto` (default), `oss` or `cloud` |
| `CRON_SECRET` | No | Generated per process when unset |
| `OPALINE_VERSION` | No | What `/api/selfhost/info` reports |

`GET /api/selfhost/info` says whether a server is self-hosted, its version and URLs, whether setup
is done and how people sign in (`auth.openSignup` included). `GET /api/selfhost/github` with the setup token or
an admin's API key returns the GitHub token status (never the token). `POST /api/selfhost/setup` with
`X-Opaline-Setup-Token` and `{ email, name, workspaceName }` creates the owner account while no
account exists and returns an API key and a sign-in link.
