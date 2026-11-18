# Design archive

Historical design work kept for reference. Nothing in this directory is an app,
public route, package workspace, or production build input.

- `reference-assets/`: images and fonts from Opaline's own retired designs,
  outside the app public folders.
- `product-ui/`: disconnected dashboard, team, session and settings designs,
  with the component styles and helpers needed to understand the snapshots.
  Their obsolete tests are omitted; current product tests stay with the app.
- `product-shells/`: the original experimental shell layouts, navigation
  components, styling, and routing source before the canonical shell was kept.

Capture, scraping, extraction, materialization, annotation, and recording tools
are intentionally omitted, as are intermediate generated markup/CSS variants
and the retired mock-demo implementation. Captures of other companies'
websites are not part of this archive.

These are historical snapshots, not supported runnable workspaces. Relative
imports and root asset URLs describe their original environment; a future design
experiment should restore the desired snapshot into a separate local project.
Do not import this archive into an app or copy it into an app's `public` folder.

Vercel uploads and Docker contexts exclude this directory. The combined build
also checks that retired reference assets are absent from its output. The live
router contains no archived shell routes, including in development mode.
