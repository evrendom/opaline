# Opaline design system

How UI is built in the Mac app (`apps/desktop/ui`): the Opaline design system's tokens, primitives and composites, and the rules for using them. Every rule is a hard rule. If a pattern doesn't fit, raise it before working around it.

## Layout

```
apps/desktop/ui/src/
  app/ui/            # Opaline primitives. One file per primitive.
  app/providers/     # ThemeProvider, AppProviders
  components/        # app composites built from primitives (data table, conversation trace, …)
  features/<area>/   # screens and their feature-only parts
  index.css          # Tailwind entry: imports the files below in order
  app/theme.css      # Layer 1: the primitives (ramps, palette, type, space, corners, motion) and their utilities
  app/tokens.css     # Layer 2: the roles screens read
  app/patterns.css   # Opaline patterns: controls app/ui doesn't cover, and recurring patterns, each state as a class
  app/preset-extensions.css  # squircle corner utilities and the opal-1…5 names mapped onto the palette
```

The `opaline-design` skill (`.claude/skills/opaline-design/SKILL.md`) holds the rules for using these files.

- **Always** put a reusable primitive in `src/app/ui/` and import it as `@/app/ui/<name>`. This is the only primitive library: `components.json` points shadcn's `ui` alias here.
- **Always** put composites (primitives arranged for a recurring job, like `DataTable`, `StatCard`, `EmptyState`, `RetryButton`) in `src/components/`, and feature-only parts in `src/features/<area>/`.
- **Never** create a second copy of a primitive (a `button.tsx` in a feature or in `components/`). Extend the one in `app/ui`: pass `className` for a one-off, and add a variant there when a look is reused.
- **Only** keep what the app uses. Add a primitive, part, variant or size when a screen needs it, not in case one might; delete one when its last user goes.

## Primitives — `@/app/ui`

Opaline's primitives are shadcn-derived and built on Base UI, with the Mac app's changes:

- No `cursor-pointer`. The app uses the default arrow on controls, like a native Mac app (`index.css` resets `a[href]` too).
- Menus, popovers and selects mount `FluidMenuHover`, the sliding hover highlight.
- `Button` carries `skullet-block`, so a skeleton pass draws it as a block.

| Need | Use |
| --- | --- |
| Action | `Button` (`default`, `outline`, `ghost`, `destructive`, `link`, `toolbar`; sizes `xs`, `sm`, `default`, `icon`, `icon-xs`, `icon-sm`, `inline`) |
| Toolbar control (filter, sort, date range, version picker) | `Button variant="toolbar"`; mark it `aria-pressed` or `data-active` when it holds a choice. On a Base UI trigger: `render={<Button variant="toolbar" />}` |
| An action inside a sentence ("Couldn't load. Try again") | `<Button variant="link" size="inline">` |
| Retry after a failed load | `RetryButton` (`components/retry-button.tsx`) |
| A link styled as a button | `<a className={buttonVariants()}>`, or `<Button render={<Link to="…" />}>` for in-app routes |
| Text field | `Input`; with an icon, prefix, suffix or button use `InputGroup` + `InputGroupInput` + `InputGroupAddon`; a toolbar's search pill is `InputGroup variant="toolbar"`; the sign-in forms' tall controls add `form-button` / `form-input` |
| Choice | `Select` (item labels are collected for `SelectValue` automatically), `Checkbox`, `DropdownMenu` |
| Tab row or segmented control | `PillTabs` (`features/repos/pill-tabs.tsx`); its sliding pill sits on the track tone, or lifts off the page with `pillClassName="tab-pill"` (patterns `.tab-track` / `.tab-pill`) |
| Label / form row | `Label`, `Field` |
| Surface | `Card` (`size="sm"` for dense), `Dialog`, `Sheet`, `Popover`, `Tooltip` |
| Data | `Table` (pass `align` per column), `Badge` (`secondary`, `outline`) |
| Person | `Avatar` (`default`, `sm`), `AvatarGroup` |
| Number that animates | `FlowNumber` (`flow-number.tsx`) |
| Loading | `Bones` / `Bone` / `Reveal` (`bones.tsx`) for page skeletons, `Skeleton` for a single bar, `ChartLoadingWave` for charts |
| Nothing to show | `EmptyState` (`components/dashboard/page-parts.tsx`) in a section, `PageEmptyState` for a whole page's empty, error or not-found state; both are built on `Empty` |
| A small control on a touch screen | `TouchTarget` inside it grows the hit area to 48px |
| Notifications | `toast` from `sonner`; `AppToaster` is mounted once in `AppShellLayout` |

- **Always** compose with Base UI's `render` prop (`<TooltipTrigger render={<button … />} />`). **Never** use `asChild` or import `radix-ui` (lint rejects it).
- **Never** style a raw `<button>`, `<input>`, `<select>` or `<textarea>` to look like a control, with classes or a feature CSS class. Use the primitive, or add a variant to it. A raw `<button>` is fine for an unstyled clickable surface: a list row, a chart mark, a tree node.
- **Never** restyle a primitive from feature CSS (`.my-page [data-slot="button"] { … }`). If a look recurs, it is a variant.

## Tokens and styling — Tailwind v4

Two layers, with the rules in the `opaline-design` skill. Layer 1 is `src/app/theme.css`: the primitives. Layer 2 is `src/app/tokens.css`: the roles screens are written against. The system page (`/dev/design-system` in development) shows every component the app uses, in light and dark.

- **Always** colour with the Layer 2 roles: ground `bg-canvas`, `bg-surface`, `bg-card`, `bg-card-soft`, `bg-inset`, `bg-field`, `bg-track`, `bg-shelf`, `bg-hover`, `bg-hover-strong`, `bg-wash`, `bg-mark-fill`; ink `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-disabled`, `text-ink-inverse`, `text-ink-soft`, `text-ink-meta`; lines `border-line`, `border-line-strong`, `border-line-soft`; action `primary`, `accent`, `accent-tint`, `accent-line`, `accent-fg` (on an accent fill), `focus`; state `success`, `warning`, `error`, each with `-tint` and `-line`. Feature CSS reads them as `var(--surface)`. **Never** read Layer 1 (`neutral-1`…`neutral-10`, `color-1`…`color-5`, their `-translucent`/`-transparent` levels) in a screen or primitive; a colour no role covers is a new role in `tokens.css` first. The shadcn names in `tokens.css` (`--background`, `--muted-foreground`, …) exist for third-party code only.
- **Never** switch roles with `dark:`. Roles flip with the mode; a `dark:` swap means a role is missing. A primitive keeps a `dark:` pair only where the two modes differ by an opacity step no role holds, with a comment saying so.
- **Always** set text with a text style: `text-body-{xxs…xxl}` or `text-display-{xxs…xxl}`, which carry size, line height and tracking (body `xxs` tracks +2%, `xxl` and display −1.5%, the rest 0). Faces are `font-body`, `font-display`, `font-data`; weights `font-regular`, `font-medium`, `font-heavy`. Don't add `leading-*` beside a text style.
- **Always** space with the steps: `p-m`, `gap-l`, `mt-xs` (`zero`, `xxs`…`xxl`). Past XXL, use a multiple such as `gap-[calc(var(--space-xxl)*4/3)]`. Sizes (`w-*`, `h-*`, `size-*`) keep Tailwind's scale.
- **Always** round with `corner-{zero,xs…xl,full}` (`rounded-*` is Tailwind's own scale; don't use it) and stroke with `edge-{none,s,m,l}` (colour stays `border-*`). Keep the squircle pair on surfaces: `corner-m squircle:corner-xl corner-squircle` on cards, `corner-s squircle:corner-l corner-squircle` on menus and popovers. A hover or focus overlay drawn 1px inside a tile keeps concentric corners with `corner-s-inset squircle:corner-xl-inset`.
- **Always** lift and separate with the role shadows, written `shadow-<role>`: `shadow-card`, `shadow-control`, `shadow-raised`, `shadow-overlay`, `shadow-primary`, `shadow-destructive`, `shadow-chip`, `shadow-selected`, `shadow-inset`, `shadow-label`, `shadow-float`, `shadow-sheet`, `shadow-contact`, `shadow-window`, `shadow-jump`, `shadow-flyout` (in CSS, `var(--shadow-card)`). Each carries its dark form. Tailwind's `shadow-sm…xl`, the theme's unused `shadow-s/m/l` and literal `shadow-[…]` stay out of screens; artwork glows (opal and tint shadows) are the exception.
- **Never** hard-code a hex, `rgb()` or `oklch()` colour, or an arbitrary text size or spacing value, in `className` or `style`. Data and artwork colours (charts, lanes, syntax, brand art) are the exception; keep them with their data.
- **Always** time motion with the roles: the theme's `--motion-duration` (150ms) / `--motion-easing` and `--motion-large-duration` (300ms) / `--motion-large-easing`, and the Layer 2 roles in `tokens.css`: `--motion-quick-duration` (100ms), `--motion-medium-duration` (200ms), `--motion-slow-duration` (650ms), `--motion-strong-easing`, `--motion-drawer-easing`, `--motion-wave-easing`. Tailwind: `duration-(--motion-medium-duration)`, `ease-strong`, `ease-drawer`, `ease-wave`. A timing none of them holds stays literal with a reason, or becomes a role.
- **Always** keep `bun run check:design` clean (`tools/design-escapes.ts`). It lists every class that leaves the scales and roles (Tailwind default type, spacing, `rounded-*`, palette colours, `[#hex]`/`rgb(`/`oklch(` in a class, default and literal shadows) across `src`, and fails on the paths in its `ENFORCED` list; the web tests (`src/app/design-escapes.bun-test.ts`) and CI run it. Data paint is allowed by a file entry in its `DATA_PAINT` list (with the reason) or a `design-escape-ok: <reason>` comment on or above the line.
- **Always** merge classes with `cn()` from `@/lib/utils`: it knows the system's classes and the role shadows. Every component takes `className` and merges it on its root element.
- **Never** bake outer margins into a component. The call site spaces it.
- **Never** add a CSS file for something a utility or a primitive already covers. Feature CSS is for what Tailwind can't express (keyframes, `::part`, shadow-root styles, complex `:has()` chains), and reads the roles.

## Theme

- **Always** read and set the theme through `useTheme()` from `@/app/providers/ThemeProvider` (`system` | `light` | `dark`). **Never** toggle `document.documentElement.classList` yourself.
- **Always** check every screen in light and dark.
- **Always** add a new primitive variant, pattern or role to the system page, `/dev/design-system` (development only, `src/app/system/DesignSystemPage.tsx`): every role, step, primitive and pattern in each state at rest, light beside dark. The page is the spec.

## Icons — `@tabler/icons-react`

- **Always** import icons from `@tabler/icons-react`. **Never** add another icon library (lint rejects `lucide-react`).
- **Always** use the outline icon for actions, controls, rows and inline glyphs. Use the `*Filled` variant for navigation and identity: sidebar and settings nav, reader tabs, and small category marks in charts, legends and labels.
- **Always** size icons by place, with Tailwind: `size-3.5` (14) in buttons, toolbar pills, inputs and by default; `size-3` (12) in badges and dense rows; `size-4` (16) in menu and select items and for emphasis. Primitives size their own icons, so don't size an icon inside a `Button`, `Badge`, menu or select item.
- **Never** put a margin on an icon inside a `Button` or `Badge`; they space children with `gap-*`.

## Data

- **Always** call the API through the oRPC TanStack Query utils in `@/lib/orpc`. **Never** `fetch` the API from a component.
- **Never** mirror server data into `useState`; read it from the query.
- **Always** format dates with `date-fns`.

## Known debt (do not copy)

These predate the rules above. Move them onto the roles and primitives when you touch them; don't extend them.

- Tailwind's default scales still compile next to the system's: `text-sm`, `p-3`, `rounded-lg`, `shadow-md`, `bg-rose-500` build silently. `bun run check:design` lists what remains outside its enforced scope (the sessions reader, the dashboard and the other product features); `index.css` keeps `--radius-sm…4xl`, which keeps `rounded-md…4xl` alive.
- About 195 `dark:` variants swap one role for another where a role is missing, and about 100 more swap in palette, white/black or literal colours.
- Feature CSS islands with hand-written surfaces, controls and literal values: costs (`costs/cost-dashboard*.css`), the dashboard (`dashboard/dashboard-theme.css`, 22 control-like classes), Compass (`compass/compass.css`), `app/app-surface.css` (the `--dashboard-01-*` chrome and `--team-lineup-*` card colours, with Layer 1 reads), `session-constellation-tree.css` (type literals) and `product-window-chrome.css`.
- Duplicate controls: search fields outside `InputGroup` (`.toolbar-search`, `.cost-search`, `.sessions-settings-search`, which renders as a bordered rectangle, not a pill); `.compass-chip` repeats `.filter-chip`; `.cli-onboarding-primary` is a second primary button (`cli-onboarding.css`, re-overridden in `welcome.css`), with `.cli-onboarding-text-button` beside it.
- `dashboard-theme.css` is mostly dead: 119 of its 121 `.dashboardy-*` classes (a flight-board template's cards, meters, tables and sticky nav) are referenced nowhere in `src`. Raw `<button>`s styled as controls in places.
- `--dashboard-01-metric-button-focus-ring` is read for focus outlines (`expandable-trace-row.tsx`, `skill-cards.tsx`, `ThemeSwitcher.tsx`, `SettingsLayout.tsx`, `reports-settings.css`) but defined nowhere, so those outlines fall back to the text colour.
- Motion: many feature CSS transitions are still literal timings (80, 120, 160, 180, 220, 240ms and a few long loops) rather than the motion roles.
