---
name: environment-variables
description: Environment variable management patterns. CRITICAL use when adding new environment variables (secrets, API keys, config), debugging "X not defined" or missing env var errors, tests passing locally but failing in CI, Turborepo not passing env vars to tasks, or troubleshooting deployment configuration errors.
allowed-tools: [Read, Edit, Grep, Glob, Bash]
---

# Environment Variables Management

## Source of Truth

`.env.example` documents the variables supported by the public repo. Contributors
put local values in an untracked `.env` file or export them in the current shell.
Never hardcode secrets or commit real values.

The core team injects hosted-service values through a private secrets manager.
Hosted-service configuration and operations are intentionally outside this repo.

## Four Integration Points

When adding a new environment variable:

### 1. Contributor Environment

Add the variable with a safe placeholder and description to `.env.example`.
Contributors set the real value in `.env` or their shell.

### 2. GitHub CI Workflow

Map from GitHub Secrets in `.github/workflows/ci.yml`:

```yaml
jobs:
  test:
    env:
      CLICKHOUSE_URL: ${{ secrets.CLICKHOUSE_URL }}
      API_KEY: ${{ secrets.API_KEY }}
```

Secrets must exist in repository settings → Secrets → Actions first.

### 3. Frontend `VITE_*` Variables

Frontend variables prefixed with `VITE_` are baked into the UI by Vite when `apps/desktop/ui` is built (`bun run build:selfhost` builds it for the app). Set them in the environment of that build, and declare their types in `apps/desktop/ui/src/vite-env.d.ts`.

### 4. Package-Specific turbo.json

**CRITICAL**: Add to package-specific `turbo.json`, NOT root.

```json
{
  "extends": ["//"],
  "tasks": {
    "test": {
      "passThroughEnv": ["CLICKHOUSE_URL", "API_KEY"]
    }
  }
}
```

## Checklist: Adding New Environment Variable

- [ ] Add a safe placeholder and description to `.env.example`
- [ ] Set the local value in an untracked `.env` file or the current shell
- [ ] Add to GitHub Secrets (if used in CI)
- [ ] Add to `.github/workflows/ci.yml` (if used in CI)
- [ ] If `VITE_*`: declare it in `apps/desktop/ui/src/vite-env.d.ts`
- [ ] Add to package-specific `turbo.json` → `passThroughEnv`
- [ ] Validate tests pass locally and in CI

## Debugging Missing Env Vars

Check in order:

1. **Local environment**: confirm the variable is exported or present in the
   untracked `.env`
2. **Package turbo.json**: `cat packages/your-package/turbo.json | grep -A 10 passThroughEnv`
3. **GitHub Secrets**: Repository settings → Secrets → Actions
4. **Hosted deployments**: ask the core team to verify the private secrets
   manager and deployment mapping

## Common Mistakes

❌ Adding to root `turbo.json` instead of package-specific
❌ Reading a `VITE_*` var at runtime: it is fixed when the UI is built
