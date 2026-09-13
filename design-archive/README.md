# Design archive

Historical design work kept for reference. Nothing in this directory is an app,
public route, package workspace, or production build input.

- `replications/`: completed website captures and interactive replicas from the
  former `__DO_NOT_MERGE__inspiration` collection, with their runtime assets.
- `reference-assets/`: the original images and fonts kept from the reference
  replications, outside the app public folders.
- `product-shells/`: the original experimental shell layouts, navigation
  components, styling, and routing source before the canonical shell was kept.

Capture, scraping, extraction, materialization, annotation, and recording tools
are intentionally omitted, as are intermediate generated markup/CSS variants
and the retired mock-demo implementation. JavaScript required to display or
interact with an archived replica remains part of that replica.

These are historical snapshots, not supported runnable workspaces. Relative
imports and root asset URLs describe their original environment; a future design
experiment should restore the desired snapshot into a separate local project.
Do not import this archive into an app or copy it into an app's `public` folder.

Vercel uploads and Docker contexts exclude this directory. The combined build
also checks that retired reference assets are absent from its output. The live
router contains no archived shell routes, including in development mode.
