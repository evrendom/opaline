# Opaline on a NAS or small server

A Docker Compose stack for a team: Opaline (API, MCP, dashboard, background jobs), Postgres 17 and
ClickHouse, with an optional Caddy for HTTPS on your own domain. For one person on a Mac, the
[Mac app](../../README.md) is simpler and needs no Docker.

## Requirements

- Docker with Compose v2 (`docker compose version`).
- An amd64 CPU with SSE4.2 (any x86-64 from the last decade, Intel Celeron J/N series included) or
  an arm64 CPU. The image runs Bun 1.3.8 (the baseline build on amd64): later Bun releases crash
  on x86-64 CPUs without AVX2, which most NAS Celerons lack.
- 4 GiB of RAM or more. ClickHouse is capped at 3 GiB (`CLICKHOUSE_MEMORY`); the server and
  Postgres take about 1.5 GiB at peak.

## Install

Copy this directory to the machine and run:

```sh
./install.sh --email you@example.com --workspace "Acme"
```

It writes `.env` with fresh random secrets (mode 600), builds the Opaline image, starts the stack,
waits until every service is healthy, creates your owner account and prints a one-time sign-in
link plus the command that connects Claude Code and Codex on each computer:

```sh
npx opaline@latest login --api-base http://192.168.1.10:4100 --allow-insecure-api-base
```

(`--allow-insecure-api-base` appears only for a plain-HTTP server on the LAN.) Teammates sign up
through an invite link from Settings > Members, then run the same command. Run `./install.sh`
again whenever you need a new sign-in link; it keeps `.env` and your data.

Options: `--public-url` (how browsers and the CLI reach the server; default
`http://<LAN address>:4100`), `--port`, `--name`, `--version`, `--upgrade`, `--artifact`,
`--domain`, `--clickhouse-only`. See `./install.sh --help`.

### Where the server comes from

The image installs the `@opalinehq/server` package at `OPALINE_VERSION` from npm. That package
is not published yet, so build it from a checkout of this repository and hand the file to the
installer:

```sh
bun install
bun run build:selfhost --version 0.18.0          # writes dist-selfhost/opaline-server-0.18.0.tgz + .json
./install.sh --artifact /path/to/opaline-server-0.18.0.tgz --email you@example.com
```

The installer copies the tarball and its `.json` manifest next to the Dockerfile; the image build
checks the tarball's sha256 against the manifest.

## HTTPS with your domain

```sh
./install.sh --domain opaline.example.com --email you@example.com
```

This enables the `https` profile: Caddy serves `https://opaline.example.com` with a Let's Encrypt
certificate and Opaline listens only on 127.0.0.1. DNS for the domain must point at this machine
and ports 80 and 443 must reach it.

## ClickHouse on the NAS, Opaline elsewhere

To keep the data on the NAS but run the Opaline server on another machine:

```sh
./install.sh --clickhouse-only
```

Only ClickHouse starts, published on the LAN at port 8123 with the user `opaline` and the password
from `.env` (`CLICKHOUSE_PASSWORD`). The installer prints the settings for the other machine:

```sh
CLICKHOUSE_URL=http://192.168.1.10:8123 CLICKHOUSE_USERNAME=opaline CLICKHOUSE_PASSWORD=<password>
```

Start the server there with those variables (see "Running the server without Docker" in
[docs/self-hosting.md](../../docs/self-hosting.md)); it keeps every session in the NAS's
ClickHouse. ClickHouse speaks plain HTTP here, so keep port 8123 on your LAN. Running `./install.sh` without
`--clickhouse-only` later turns the full stack on and takes ClickHouse off the LAN again.

## Profiles and settings

`COMPOSE_PROFILES` in `.env` picks what runs: `server` (Opaline + Postgres + ClickHouse, the
default), `server,https` (plus Caddy), or empty (ClickHouse only). Every setting is in
`.env.example`. Optional integrations (OpenAI embeddings, email through Resend, a GitHub token
for pull requests and CI, S3-compatible storage) are environment variables of the `opaline`
service; add them in a `compose.override.yaml` next to `compose.yaml`, for example:

```yaml
services:
  opaline:
    environment:
      OPENAI_API_KEY: sk-...
      GITHUB_TOKEN: github_pat_...
```

The image has no GitHub CLI, so GitHub needs `GITHUB_TOKEN` here (read-only; a classic token with
the `repo` scope, or a fine-grained one).

## Operating it

- Logs: `docker compose logs -f opaline`
- Stop / start: `docker compose stop`, `docker compose up -d`
- Upgrade: `./install.sh --artifact <newer tgz>`, or `./install.sh --upgrade` once
  `@opalinehq/server` is on npm.
  The new image runs the Postgres and ClickHouse migrations on start; data stays in the volumes.
- Back up: the named volumes `opaline_postgres-data`, `opaline_clickhouse-data` and
  `opaline_opaline-data` (uploaded objects), plus `.env`.
- Remove everything, data included: `docker compose --profile server --profile https down -v`.

## Building the image from source

`source.Dockerfile` in this directory builds the same image from a checkout of this repository
(`docker build -f deploy/selfhost/source.Dockerfile -t opaline-server .`, run from the repository root); it compiles the artifact with Bun 1.3.14, so build it on a
machine with AVX2 or arm64. The image it produces runs anywhere this stack does.
