# Self-hosting Opaline

Opaline runs on your own hardware with one command. A self-hosted server is a single-team install:
every feature is on, there are no plans or billing, nothing is sent to Stripe, PostHog, Sentry,
Slack or CRM, and the background jobs run inside the server.

What runs:

| Part | Holds |
| --- | --- |
| Opaline server (Bun) | API, MCP endpoint, dashboard, background jobs |
| Postgres | Accounts, workspaces, invites, saved answers |
| ClickHouse | Sessions and everything computed from them |
| Object storage | Large uploads, evidence images and transcripts. A directory on disk by default, or any S3-compatible store |

## Pick a setup

| You want | Run |
| --- | --- |
| Everything on this computer | `npx opaline@latest server` |
| Your own ClickHouse (ClickHouse Cloud, a cluster) | `npx opaline@latest server --clickhouse-url https://… --clickhouse-user …` |
| ClickHouse on a NAS, Opaline on your laptop | `deploy/selfhost/install.sh --clickhouse-only` on the NAS, then `opaline server --clickhouse-url http://nas:8123 …` on the laptop |
| The whole stack on a NAS or small server for a team | `deploy/selfhost/install.sh --email you@example.com` |

## Everything on this computer

```sh
npx opaline@latest server
```

The first run:

1. uses ClickHouse, Postgres and Bun from your system when they are recent enough (ClickHouse
   25.8+, Postgres 16+, Bun 1.3+), otherwise downloads pinned versions and checks their checksums;
2. creates both databases under `~/.opaline/server` and starts everything in the background, bound
   to `127.0.0.1`, on port 4100;
3. creates your account (your `git config user.email`, or `--email`) as the owner of a workspace;
4. logs this machine's CLI in, installs the Claude Code and Codex hooks and registers the MCP in
   Claude Code, Codex and Cursor;
5. prints a one-time sign-in link for the dashboard and opens it.

Later runs start whatever is stopped. Day to day:

```sh
opaline server status        # what runs, ports, paths
opaline server open          # the dashboard, through a new one-time sign-in link
opaline server logs -f       # --service server|postgres|clickhouse
opaline server stop
```

Until the server package is published on npm, point the CLI at a packed server or at an athena
checkout:

```sh
bun run build:selfhost --version 0.18.0                     # in athena
OPALINE_SERVER_ARTIFACT=dist-selfhost/opaline-server-0.18.0.tgz npx opaline@latest server

bun run --cwd apps/web build && bun run --cwd apps/web build:widget
OPALINE_SERVER_DIR=~/code/athena npx opaline@latest server   # or run a checkout directly
```

All flags and CLI variables are in the CLI's
[self-hosting page](https://github.com/opalinehq/cli/blob/main/docs/self-hosting.md).

## Your own ClickHouse

```sh
OPALINE_CLICKHOUSE_PASSWORD=… npx opaline@latest server \
  --clickhouse-url https://abc123.eu-west-1.aws.clickhouse.cloud:8443 \
  --clickhouse-user opaline
```

Postgres and the server still run locally. Before starting anything the CLI pings the endpoint,
checks the credentials and the grants on the `rudel` database: CREATE TABLE, INSERT, SELECT, ALTER,
and CREATE DATABASE when `rudel` does not exist yet. The server then creates or upgrades the schema
itself. It probes what the ClickHouse supports (`Shared*MergeTree` engines, an `s3` storage policy)
and creates plain tables on the default disk where they are missing; `CLICKHOUSE_FLAVOR=oss|cloud`
skips the probe.

## ClickHouse on a NAS, Opaline on your laptop

On the NAS, from `deploy/selfhost` (see its README for requirements):

```sh
./install.sh --clickhouse-only
```

It starts only ClickHouse, on the LAN at port 8123 with the user `opaline`, and prints the command
for the laptop:

```sh
OPALINE_CLICKHOUSE_PASSWORD=<from the NAS .env> npx opaline@latest server \
  --clickhouse-url http://192.168.1.10:8123 --clickhouse-user opaline
```

The sessions live on the NAS; accounts and saved answers live in the laptop's Postgres. ClickHouse
speaks plain HTTP here, so keep port 8123 on your LAN.

## The whole stack on a NAS

`deploy/selfhost` is a Docker Compose stack (Opaline, Postgres 17, ClickHouse, optional Caddy for
HTTPS). On the NAS:

```sh
./install.sh --email you@example.com --workspace "Acme"
./install.sh --domain opaline.example.com --email you@example.com   # with HTTPS through Caddy
```

`install.sh` writes `.env` with fresh secrets, builds the image, starts the stack, creates your
owner account and prints a sign-in link plus the command each computer runs to connect. Its README
covers profiles, settings (`compose.override.yaml`), logs, upgrades and the volumes to back up. Run
`./install.sh` again for a new sign-in link.

## Teammates

Sign-up is invite-only. The owner account comes from setup; everyone else needs one of:

- the workspace invite link from Settings, Members, Invite link (valid 7 days, until replaced or
  revoked), or
- an invitation for their email from Settings, Members (no email is sent unless `RESEND_API_KEY`
  is set; copy the link it shows and send it yourself).

The teammate opens the link, creates an account with a password, then connects their machine:

```sh
npx opaline@latest login --server https://opaline.example.com
npx opaline@latest mcp install
```

For a plain-HTTP server on the LAN add `--allow-insecure-api-base` to `login` once. The server must
be reachable from their machine: start it with `--host 0.0.0.0` (it then serves
`http://<LAN address>:4100`), or put it behind HTTPS (below).

`OPALINE_OPEN_SIGNUP=1` lets anyone who can reach the server sign up without an invite. The server
enforces invite-only itself, for password, email-code and social sign-up alike; the sign-up page
only explains it.

## Sign-in links and passwords

There is no email by default, so sign-in links replace "forgot password":

| You need | Do |
| --- | --- |
| The dashboard, on the server's machine | `opaline server open` (link valid 10 minutes, once) |
| A link for a teammate | `opaline server open --email teammate@example.com`, or the link icon on their row in Settings, Members (valid one hour, once) |
| A new password | Settings, Account, Password |

Owners can make a link for anyone in their workspace, admins for anyone but an owner. On the
server's machine the CLI uses the server's setup token instead, which works for every account.
Right after signing in with a link, a password can be set without the old one for an hour;
otherwise the current password is required. Changing it signs you out in other browsers; CLI and
MCP API keys keep working. Every link made for someone else, and every password change, is logged
at info level with user ids (never the link).

Links come from `POST /api/selfhost/login-link` with the setup token (`X-Opaline-Setup-Token`), an
API key (`x-api-key` or `Authorization: Bearer`) or a browser session, and an optional
`{ "email": "…" }`.

## Connect your agents (MCP)

Claude Code, Codex and Cursor connect with an API key. `opaline server` registers them on the
server's machine; elsewhere `opaline mcp install` does it after `opaline login --server …`:

| Agent | Written |
| --- | --- |
| Claude Code | `claude mcp add --scope user --transport http opaline <server>/api/mcp --header "Authorization: Bearer <key>"` |
| Codex | `[mcp_servers.opaline]` with `url` and `http_headers` in `~/.codex/config.toml` |
| Cursor | The `opaline` entry in `~/.cursor/mcp.json` |

claude.ai and ChatGPT connectors are different: their servers call your `/api/mcp` from the
internet and sign in with OAuth, so the server needs a public HTTPS URL. Two ways:

- **Your domain.** Run the NAS stack with `--domain`, or any reverse proxy that forwards to port
  4100, and start the server with `--public-url https://opaline.example.com`.
- **Tailscale Funnel.** On the server's machine run `tailscale funnel --bg 4100`, then
  `opaline server --public-url https://<machine>.<tailnet>.ts.net --yes`.

Use that URL for the dashboard from then on: the server trusts browser requests only from its
public origin. Add `https://…/api/mcp` as a custom connector in claude.ai (Settings, Connectors) or in
ChatGPT (a custom connector, in developer mode). Anyone on the internet can now reach the sign-in
page; invite-only sign-up is what keeps them out, so leave `OPALINE_OPEN_SIGNUP` unset.

## Settings

`opaline server` gives the server a fixed environment. Put extra settings in
`~/.opaline/server/server.env`, one `NAME=value` per line, and restart with
`opaline server stop && opaline server`. The CLI prints which settings it passed and refuses to
override the ones it sets itself (port, URLs, database connections, secrets). In the Docker stack
they go in `compose.override.yaml`.

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

By default objects live in `~/.opaline/server/data/object-store` and the server signs its own upload
and download URLs. To use S3, MinIO, SeaweedFS or R2 instead, set `S3_BUCKET`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and either `S3_ENDPOINT` or (AWS) `S3_REGION`. With
`S3_ENDPOINT` set, path-style addressing is on unless `S3_FORCE_PATH_STYLE=false`.

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

On your own computer that usually means nothing to do, or once:

```sh
gh auth login --scopes repo
```

For a server on another machine (a NAS, a VM, your cloud), give it a token: `GITHUB_TOKEN=…` in
`~/.opaline/server/server.env` there (with `opaline server`) or in `compose.override.yaml` (Docker
stack). A classic token needs the `repo` scope for private repositories and their CI logs. A
fine-grained token needs read access to Contents, Metadata, Pull requests, Actions, Checks and
Commit statuses of the repositories it should cover.

There is nothing to connect and no webhook. Every five minutes the server reads the git remotes of
the sessions uploaded to each workspace, asks GitHub which of those repositories the token can read,
and collects them: the last 90 days at first (`OPALINE_GITHUB_HISTORY_DAYS`), then what changed.
Repositories the token cannot read are skipped and asked about again every six hours. The token is
read when it is needed and never stored or logged, so `gh auth login` or a new token takes effect
within a minute, without a restart.

Settings, GitHub shows where the token comes from, its account and scopes, the repositories it
collects and the ones it cannot read, the last sweep and the rate limit, and the command that fixes
a missing token. `opaline server start` and `opaline server status` print the same in one line, and
the server log has a `github:` line at startup.

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

- ClickHouse gets a memory cap: a quarter of the machine's RAM between 3 and 8 GiB with
  `opaline server` (`--clickhouse-memory <GiB>` sets it), 3 GiB in the Docker stack
  (`CLICKHOUSE_MEMORY`). Do not go below 2 GiB: run index queries need 0.5 to 0.9 GiB each, and at
  2 GiB the first insert of a 140 MiB session needed a retry. 3 GiB is enough for a small team.
- The server and Postgres take up to about 1.5 GiB at peak (preparing a 136 MiB session's detail
  view added 0.6 GiB). Plan for 4 GiB of RAM in total, 8 GiB for large sessions.
- ClickHouse stores about 1 MiB per session. Repository evidence (transcripts, images, saved
  outputs) sits in object storage at its raw size; staged uploads are deleted after 7 days.

## Backups

- `opaline server`: run `opaline server stop` and copy `~/.opaline/server`. It holds both
  databases, the object store and `server.json`, whose secrets (auth secret, setup token, database
  passwords) a restored copy needs. Keep the copy private.
- Docker stack: the volumes `opaline_postgres-data`, `opaline_clickhouse-data` and
  `opaline_opaline-data`, plus `.env`.
- Your own ClickHouse: back it up with that service's tools; Postgres still lives in the data
  directory.

## Upgrades

- `npx opaline@latest server` installs the server release that matches the CLI, restarts only the
  server process, and keeps the previous release for a rollback. Postgres migrations and the
  ClickHouse schema upgrade run on every start and do nothing when there is nothing to do; they
  only go forward, so an older release may refuse the newer schema.
- From an athena checkout: pull, rebuild the web (`build` and `build:widget`), then
  `opaline server stop && opaline server`.
- Docker stack: `./install.sh --upgrade`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Anything | `opaline server status`, then `opaline server logs --service server -n 200` |
| "port 4100 is already in use" | Stop the other process, or `opaline server --port 4200 --yes` (the CLI login and MCP registration follow) |
| "This sign-in link expired or was already used" | `opaline server open` for a new one |
| "This Opaline server is invite-only" | Open an invite link from an owner or admin, or set `OPALINE_OPEN_SIGNUP=1` |
| "ClickHouse ran out of memory for all of its queries" | Raise the ClickHouse memory cap |
| A teammate's CLI refuses `http://` | `opaline login --server http://… --allow-insecure-api-base` |
| `opaline server` warns that the checkout has no web build | Build `apps/web` (`build` and `build:widget`) in the checkout |
| The server stops answering for minutes after a very large upload | Known: the first view of a session above about 100 MiB is prepared in the server process (136 MiB took 166 s). It recovers by itself |
| Evidence of a transcript above 128 MiB is incomplete | It is sent in several deliveries; `opaline upload --retry` sends what is left |
| Agents do not see the Opaline tools | `opaline mcp install`, then restart the agent |
| Settings, GitHub says "No token" | `gh auth login --scopes repo` where the server runs, or `GITHUB_TOKEN=…` in `server.env` |
| A repository is missing from Settings, GitHub | Its sessions need a GitHub remote, and the token must be able to read it (otherwise it is listed as not readable); new ones appear within five minutes of the first upload |

## Running the server without the CLI

`bun apps/api/src/selfhost/main.ts` (from a checkout or the packaged server) is the entry point
that `opaline server` and the Docker image run. It validates the environment and reports every
problem at once, migrates Postgres, creates or upgrades the ClickHouse schema, serves the API, MCP
and dashboard, runs the jobs, and prints `ready <url>` on stdout.

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
