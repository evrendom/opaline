# Opaline workspace guidance

## Current product and onboarding

- The product is Opaline. Rudel is a legacy name.
- Wrapped is retired. Do not use its old code, screenshots, docs, or Git history as the source for current onboarding or product design.
- New users continue setup at `/welcome`. Returning users open `/{workspace}/sessions`, using the actual workspace slug.
- Current onboarding lives in `apps/web/src/features/cli-onboarding/`.
- Preserve CLI pairing, browser-approved workspace binding, and completion updates when changing onboarding or `opaline --code`.
- Historical `.context` worktrees and launch notes are not current product specifications.

## CLI

- The published CLI (npm `rudel` and `opaline`) lives in [opalinehq/cli](https://github.com/opalinehq/cli). Put CLI fixes and features there.
- `apps/cli` in this repository is only a test harness for the API. It is not published.

## Tests

- Keep a test only if it catches something no other test catches. `bun run test:kill-matrix <module.ts>` builds the mutation-testing kill matrix and lists the tests that kill no unique mutant; see `.claude/skills/testing-bun/SKILL.md` ("Every Test Earns Its Place").

## Retired code

- Recover Wrapped from Git history only when explicitly requested.
- Historical database schemas and migrations are retained for existing data.
- The Wrapped archetype pipeline is retired; its ClickHouse tables stay until they are dropped (see `docs/l1-literal-schema.md`).
