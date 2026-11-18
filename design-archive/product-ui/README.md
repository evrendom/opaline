# Retired product UI

These are source snapshots of finished or developed UI variants that no longer
have a route or import path in the live product. Original component paths below this folder
mirror `apps/web/src/` at commit `15ec529e`.

- `features/dashboard/`: previous cost, errors, performance and repository charts.
- `features/team/`: member cards and the roster gallery.
- `features/sessions/`: older summary, search, metadata and footer controls.
  Metadata-tag CSS was extracted from the otherwise active constellation styles.
- `features/shell/`: sidebar news card and popover designs.
- `features/settings/`, `features/get-started/`, `features/wrapped/`: retired
  settings and onboarding variants.
- `app/`, `components/`, `providers/`: accompanying visual styles and UI primitives.

Keep these as design references. They are not runnable workspaces: `@/` imports,
shared tokens and asset URLs refer to the original app. Restore a desired design
and its dependencies into an isolated local project before experimenting.
The original package versions are available in the source commit's manifests.

There are no public routes, capture tools or obsolete test suites here. This
entire archive is excluded from Vercel uploads, Docker contexts and app builds.
