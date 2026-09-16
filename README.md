# Opaline

**Try the hosted version for free at [opaline.so](https://opaline.so)**

Analytics for Claude Code and Codex. Opaline gives you a dashboard with insights on your coding sessions — token usage, session duration, activity patterns, model usage, and more.

## Prerequisites

- [Bun](https://bun.sh) runtime installed

## Getting Started

1. Create an account at [opaline.so](https://opaline.so)
2. Install the CLI and connect it to your account:

```bash
npm install --global opaline

opaline login     # authenticate via your browser
opaline enable    # auto-upload sessions when Claude Code / Codex exits
```

3. Invite teammates (optional): go to **Settings → Organization** in the dashboard, enter their email, and share the generated invite link with them.

That's it. Your Claude Code / Codex sessions will now be uploaded automatically.

Already have past sessions? Upload them in one go:

```bash
opaline upload    # interactive picker for batch upload
```

See the [Opaline CLI documentation](https://github.com/opalinehq/cli#readme) for all available commands.

## How It Works

1. You install the CLI and run `opaline enable`
2. This registers Claude Code / Codex hooks that run when a session ends
3. The hook redacts known secret patterns and uploads the session transcript to Opaline
4. Transcripts are stored in ClickHouse and processed into analytics

## What Data Is Collected

Each uploaded session includes:

- Session ID & timestamps (start, last interaction)
- User ID & organization ID
- Project path & package name
- Git context (repository, branch, SHA, remote)
- Session transcript (full prompt & response content)
- Sub-agent usage

## Security & Privacy Disclaimer

Opaline is designed to ingest full coding-agent session data for analytics. That means uploaded transcripts and related metadata may contain sensitive material, including source code, prompts, tool output, file contents, command output, URLs, and secrets that appeared during a session.

The current CLI redacts known secret patterns from the main transcript and sub-agent transcripts before upload, and the API reapplies the same deterministic filter before storage. Matched values are removed in full; uploads are stopped if known-pattern redaction exceeds 20% of the transcript or the bounded filter cannot establish a stable result. This reduces exposure but does not catch `DB_PASSWORD=hunter2`, bare custom tokens without a distinguishing prefix, secrets split across lines, base64-encoded or paraphrased secrets, credentials in screenshots, or double-escaped JSON embedded inside another JSON string. Seven of the 18 selected rules also require a restricted trailing delimiter, so ordinary punctuation immediately after a secret can prevent a match. Do not treat the filter as a substitute for keeping secrets out of coding-agent sessions.

Only enable Opaline on projects and environments where you are comfortable uploading that data. Review the [Opaline Privacy Policy](https://opaline.so/privacy) before enabling uploads for yourself or your team.

We also use limited product analytics on the hosted service to understand whether core workflows work, diagnose failures, and improve the product. This is explicit event tracking for account and authentication flows, CLI login and enable flows, session upload outcomes, dashboard views and interactions, organization management actions, and a small set of utility interactions such as theme toggle or sidebar collapse.

This product analytics layer is intentionally limited. It does not enable blanket click autocapture, session replay, or surveys by default. It is designed to capture product events and operational context like page name, action name, date range, normalized error codes, and organization or user identifiers where needed. It should not include raw transcript content, source code, prompts, tool output, command output, or file contents from your sessions. By using the hosted app, you agree to this limited analytics processing as part of the service.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, development commands, and PR guidelines.

For self-hosting your own instance, see [docs/self-hosting.md](docs/self-hosting.md).

The hosted development preview uses a stable address:
[opaline-dev-opalinehq.vercel.app](https://opaline-dev-opalinehq.vercel.app).
To deploy a branch that includes the current Vercel workflow:

```bash
gh workflow run vercel.yml --repo opalinehq/athena --ref YOUR_BRANCH -f target=preview
```

The workflow checks the new deployment before updating that address. Preview
builds share this address; the latest requested build replaces the previous one.
Preview authentication uses this same origin for `APP_URL`, `ALLOWED_ORIGIN`,
and `TRUSTED_ORIGINS`, preserving login across deployments. Vercel deployment
protection still applies. The hosted preview currently uses the production
database, so changes to workspace data are real.

Register `https://opaline-dev-opalinehq.vercel.app/api/auth/callback/github`
as an additional callback on the GitHub OAuth app used by the preview, keeping
the production callback. Google requires the corresponding `/callback/google`
URL in its OAuth client settings. Callback registration is a one-time setup for
each provider; it does not change when the deployment URL changes.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Do not open public issues for security concerns.

## License

[MIT](LICENSE)

## Retired features

Wrapped is retired. See [the retirement notes](docs/wrapped-retirement.md) for the removed surfaces and retained data infrastructure. Current onboarding starts at `/welcome`.
