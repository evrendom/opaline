# Opaline

See where your coding agents get stuck, and what to fix in your setup.

Opaline is a Mac app for Claude Code and Codex. It reads the sessions your agents leave on your Mac and shows what they cost, where they loop or fail, which mistakes keep coming back, and what to change in your `CLAUDE.md`, `AGENTS.md`, skills, hooks, scripts or CI. Everything runs on your Mac: the app brings its own server, Postgres and ClickHouse, and nothing leaves the machine.

**[Download Opaline for Mac](https://github.com/evrendom/opaline/releases/download/desktop-latest/Opaline-macOS-arm64.dmg)** (Apple silicon) · [evren.opaline.so](https://evren.opaline.so)

## What you get

- **Usage and cost** for Claude Code and Codex by day, repository and model, including your plan usage.
- **Every session, readable**: turns, tool calls, files, context, subagents, pull requests and CI.
- **Flags** for runs that looped, failed or got corrected, so the problems that repeat stand out.
- **Your agents can ask too**: "Connect your agents" adds the Opaline plugin to Claude Code and Codex, so they can look up past sessions and answer questions about them through the local MCP server.

The app keeps itself up to date from this repository's releases.

## Build from source

You need [Bun](https://bun.sh) and macOS.

```bash
git clone https://github.com/evrendom/opaline.git
cd opaline
bun install
bash apps/desktop/package.sh
```

`package.sh` builds the server and web app from your checkout and writes `Opaline.app` and `Opaline.dmg` to `~/.cache/opaline-desktop/package`. For day-to-day development, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Run it on a server instead

```bash
npx opaline@latest server
```

This runs the same server, dashboard and MCP endpoint with Postgres and ClickHouse on any machine, and connects the CLI, Claude Code and Codex. Use your own ClickHouse with `--clickhouse-url`, or run the whole stack on a NAS with `deploy/selfhost/install.sh`. See [docs/self-hosting.md](docs/self-hosting.md).

## The CLI

The `opaline` command (`apps/cli`, published to npm as `opaline`, `@opalinehq/cli` and `rudel`) finds saved Claude Code and Codex sessions, uploads them to an Opaline server, and keeps new ones in sync. See [docs/usage.md](docs/usage.md) and [docs/data-handling.md](docs/data-handling.md).

## Privacy and secrets

Session transcripts contain whatever your agents saw: source code, prompts, command output, file contents, URLs, and sometimes secrets. In the Mac app they stay on your Mac. When sessions are sent to a server, the CLI removes known secret formats first and the server applies the same filter again before storing anything. The filter catches known formats only; it does not catch values such as `DB_PASSWORD=hunter2`, custom tokens without a recognizable prefix, or secrets split across lines. Keep secrets out of agent sessions where you can.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | The Mac app (Electron), its onboarding and packaging |
| `packages/local-server` | Runs the local server, Postgres and ClickHouse for the app |
| `apps/api` | The server: ingest, analysis, MCP |
| `apps/web` | The dashboard |
| `apps/cli` | The CLI |
| `plugins/opaline` | The Claude Code and Codex plugin |
| `packages/*` | Shared packages: schemas, transcript parsing, secret filter |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md); please do not open public issues for security problems.

## License

Opaline is created by Evren Dombak and licensed under the [Apache License 2.0](LICENSE). If you redistribute it or build on it, keep the [NOTICE](NOTICE) file with it.
