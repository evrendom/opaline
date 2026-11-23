# Frontend: the Mac app UI

How code is organised in the Mac app (`apps/desktop/ui`). **Every visual
rule lives in the design docs: read [`design/README.md`](design/README.md)
before building any screen.** This file covers where code goes, theming and
data.

## Layout

```
apps/desktop/ui/
  design/            # the design system docs: start at README.md
  src/
    app/ui/          # the primitives. One file per primitive.
    app/providers/   # ThemeProvider, AppProviders
    app/system/      # the dev showcase, /dev/design-system
    components/      # composites built from primitives (data table, conversation trace, …)
    features/<area>/ # screens and their feature-only parts
    index.css        # Tailwind entry: imports the files below in order
    app/theme.css    # Layer 1: primitives and steps
    app/tokens.css   # Layer 2: the roles screens read
    app/patterns.css # recurring structures as classes (menus, settings rows)
  tools/design-escapes.ts  # the design check (bun run check:design)
```

- **Always** put a reusable primitive in `src/app/ui/` and import it as
  `@/app/ui/<name>`. It's the only primitive library: `components.json`
  points shadcn's `ui` alias here.
- **Always** put composites (primitives arranged for a recurring job, like
  `DataTable`, `StatCard` and `RetryButton`) in `src/components/`, and
  feature-only parts in `src/features/<area>/`.
- **Never** create a second copy of a primitive, such as a `button.tsx` in a
  feature. A look that three or more screens need becomes a variant in
  `app/ui`. A look only one screen needs uses the nearest existing variant.
- **Only** keep what the app uses. Delete a primitive, variant, size or
  pattern when its last user goes: a dead option is still a choice an agent
  can pick.

## Theme

- **Always** read and set the theme through `useTheme()` from
  `@/app/providers/ThemeProvider` (`system` | `light` | `dark`). **Never**
  toggle `document.documentElement.classList` yourself.
- **Always** check every screen in light and dark.
- **Always** add a new role, step, variant or pattern to `/dev/design-system`
  (`src/app/system/`), with each state at rest and light beside dark, and to
  the matching file in `design/`.

## Data

- **Always** call the API through the oRPC TanStack Query utils in
  `@/lib/orpc`. **Never** `fetch` the API from a component.
- **Never** mirror server data into `useState`; read it from the query.
- **Always** format dates with `date-fns`.

## Known debt

- `patterns.css`'s settings group reaches into `Input`, `Select`, `Button` and
  `Avatar` through `[data-slot=…]` selectors (48px fields and pills): 15
  `restyle` escapes, held by the baseline. The fix is a size on the
  primitives that settings asks for.
- Six files are over 1,000 lines (`cost-chart.tsx`,
  `session-transcript-list.tsx`, `conversation-trace-tree.tsx`,
  `session-detail-fast-response-pane.tsx`, `workspace-use-view.tsx` and
  `plan-usage-chart.tsx`). Split them by section when you work in them.
