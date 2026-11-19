# rudel (test harness)

> [!WARNING]
> This package is a test harness for the athena API. It is not published to npm.
> The published CLI (npm `rudel` and `opaline`) lives in [opalinehq/cli](https://github.com/opalinehq/cli).
> Put CLI fixes and features there. Change this package only to keep the API tests working.
> The rest of this file describes the harness commands and can be out of date relative to the published CLI.

## Prerequisites

- [Bun](https://bun.sh) runtime installed

## Running the harness

Do not install this package from npm. `npm install -g rudel` installs the published CLI from opalinehq/cli, not this code.

```bash
# Run the harness from source
bun run --cwd cli dev -- --help

# Run the harness tests
bun run --cwd cli test
```

## Commands

### `rudel login`

Authenticate with Opaline. Opens your browser to [opaline.so](https://opaline.so) where you sign in, then the CLI receives a token automatically.

Flags:

| Flag | Description |
|---|---|
| `--api-base <url>` | API server to authenticate against. Defaults to `RUDEL_API_BASE`, else `https://opaline.so`. Must be `https://`, or `http://` on a loopback host. |
| `--allow-insecure-api-base` | Permit plaintext `http://` on a non-loopback host, for **both** the API base and the browser verification URL it returns. Your access token and ingest API key are then sent unencrypted, so only use this on a trusted network. Also settable as `RUDEL_ALLOW_INSECURE_API_BASE=1`. |
| `--no-browser` | Print the verification URL instead of opening a browser. |

The API base must not carry a query string or fragment — `https://host?tenant=acme` is rejected, because the CLI appends paths such as `/api/auth/device/code` to it.

Self-hosting over plain HTTP therefore needs `--allow-insecure-api-base` on every `rudel login`. The server also logs a warning at startup when its own verification origin is plaintext. Serving your deployment over HTTPS is strongly preferred; plaintext exposes the login token, the ingest API key, and every uploaded transcript to anyone on the network path.

### `rudel enable`

Registers the available Claude Code / Codex hooks so your session transcript uploads automatically when a session ends. This is the recommended way to use Opaline -- set it and forget it.

### `rudel disable`

Removes the auto-upload hook.

### `rudel upload [session]`

Upload session transcripts. Run without arguments to interactively select projects for batch upload, or pass a session ID / file path to upload a single session.

```bash
# Interactive project picker (batch upload)
rudel upload

# Upload by session ID
rudel upload abc123

# Upload a specific file
rudel upload ./path/to/session.jsonl

# Preview without uploading
rudel upload --dry-run

# Auto-classify sessions
rudel upload --classify
```

Upload endpoints must use HTTPS, except that loopback HTTP endpoints such as
`http://localhost:4010/rpc` are allowed for local development. Plaintext HTTP
to any other host is refused unless the upload-specific
`--allow-insecure-endpoint` flag is passed or
`RUDEL_ALLOW_INSECURE_ENDPOINT=1` is set. This opt-in is intentionally separate
from `--allow-insecure-api-base`: it permits the ingest API key and full
transcript to cross the network unencrypted and should only be used on a
trusted network. Non-HTTP URLs, malformed URLs, and URLs with embedded
credentials are always refused.

Automatic Claude Code and Codex uploads use the environment form because hooks
run unattended. If `RUDEL_API_BASE` names an unsafe destination, the hook
refuses the upload, reports the reason in stderr and
`~/.rudel/logs/hook-upload.log`, and adds the session to the failed-upload queue
for `rudel upload --retry`; it does not fall back to the saved API base.

Repository evidence delivers large transcripts in bounded windows. Accepted
windows leave a private, persisted continuation until the remaining stable
records are delivered, including after a terminal hook exits. Run
`rudel upload --retry` again if its bounded batch leaves more work. Pending
captures made with an older secret-filter version are quarantined, never
replayed unchanged; recollect those sessions with the upgraded CLI.

When run without arguments, `rudel upload` scans `~/.claude/projects/` for all projects with session transcripts and presents an interactive picker. The current project (matched from your working directory) and its subfolders are pre-selected. Use arrow keys to navigate, space to toggle, and enter to confirm.

### `rudel whoami`

Show the currently authenticated user.

### `rudel logout`

Clear stored credentials.

## What Data Is Collected

Each uploaded session includes:

- Session ID & timestamps (start, last interaction)
- User ID & organization ID
- Project path & package name
- Git context (repository, branch, SHA, remote)
- Session transcript (full prompt & response content)
- Sub-agent usage

## Known-secret Redaction

Before upload, the CLI redacts known secret patterns in both the main transcript and every sub-agent transcript. The Opaline API reapplies the same deterministic filter before storage and reports counts by pattern; matched values are removed in full and never included in the summary. Uploads are stopped if known-pattern redaction exceeds 20% of the transcript or the bounded filter cannot establish a stable result.

This substantially reduces exposure, but it does not catch `DB_PASSWORD=hunter2`, bare custom tokens without a distinguishing prefix, secrets split across lines, base64-encoded or paraphrased secrets, credentials in screenshots, or double-escaped JSON embedded inside another JSON string. Seven of the 18 selected rules also require a restricted trailing delimiter, so ordinary punctuation immediately after a secret can prevent a match. Keep secrets out of coding-agent sessions whenever possible.

## Links

- **Web App**: [opaline.so](https://opaline.so)
- **Issues**: [GitHub Issues](https://github.com/opalinehq/cli/issues)
