# Vercel build checks

CI runs workspace type checks, lint, tests, the API and CLI builds, the combined
site build, and browser resource checks before allowing deployment. The combined
site build owns the product, demo, and marketing assets; CI does not build the
product and marketing a second time through Turbo.

`bun run check-types:vercel` checks every `api/**/*.ts` entrypoint and its imported
code using the root `tsconfig.json`, with `noCheck: false`. Vercel also runs this
command once before building, so manual preview builds retain the same check.

`api/tsconfig.json` is the configuration Vercel's function compiler discovers.
It uses `noCheck: true` to avoid checking the shared API graph again for each
function. Keep `target`, `module`, and `strict` explicit here: Vercel applies
defaults before resolving `extends`, which otherwise overrides inherited settings.
Application type checks in `apps/api` remain enabled independently.

The web `build` script emits assets. Use `bun run verify` for a checked local
build, or `bun run --cwd apps/web check-types` for a frontend-only type check.
Smoke checks and promotion still run after Vercel creates the deployment.

Production deploys run the Postgres migration runner before deploying source to
Vercel, using the production `PG_CONNECTION_STRING` secret. A failed migration
stops deployment. Keep migrations compatible with the currently serving version
because it continues serving while the new deployment builds. Preview deployments
do not run production migrations.
