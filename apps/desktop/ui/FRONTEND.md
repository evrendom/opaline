# Opaline design system

How UI is built in the Mac app (`apps/desktop/ui`): the Opaline design system's tokens, primitives and composites, and the rules for using them. Every rule is a hard rule. If a pattern doesn't fit, raise it before working around it.

## Layout

```
apps/desktop/ui/src/
  app/ui/            # Opaline primitives. One file per primitive.
  app/providers/     # ThemeProvider, AppProviders
  components/        # app composites built from primitives (data table, conversation trace, …)
  features/<area>/   # screens and their feature-only parts
  index.css          # Tailwind entry: imports Graphical's generated theme, then the files below
  app/tokens.css     # Opaline tokens: Layer 1 primitives (from Graphical) and the Layer 2 roles screens read
  app/patterns.css   # Opaline patterns: controls app/ui doesn't cover, and recurring patterns, each state as a class
  app/preset-extensions.css  # squircle corner utilities and the opal-1…5 names mapped onto Graphical's palette
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
| Text field | `Input`; with an icon, prefix, suffix or button use `InputGroup` + `InputGroupInput` + `InputGroupAddon` |
| Choice | `Select` (item labels are collected for `SelectValue` automatically), `Checkbox`, `DropdownMenu` |
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

## Tokens and styling — Graphical on Tailwind v4

The tokens come from Graphical's theme, named Opaline: `graphical/generated/theme.css`, with every value in [gui/themes.md](gui/themes.md). Follow [GUI.md](GUI.md) and the `graphical-ui` skill for UI work. Change the theme through the development editor or `graphical-adopt`, never by editing `graphical/generated/`.

- **Always** use the theme's tokens: neutrals `neutral-1`…`neutral-10` (surface to strongest text), palette `color-1`…`color-5` (the opal sheen; `color-1` is the brand blue), statuses `success`, `warning`, `error`, each with `-translucent` and `-transparent` levels. Opaline's semantic names (`bg-background`, `text-muted-foreground`, `--dashboardy-*`, `--cost-*` …) stay as aliases of them.
- **Always** set text with a text style: `text-body-{xxs…xxl}` or `text-display-{xxs…xxl}`, which carry size, line height and tracking. Faces are `font-body`, `font-display`, `font-data`; weights `font-regular`, `font-medium`, `font-heavy`. Don't add `leading-*` beside a text style.
- **Always** space with the steps: `p-m`, `gap-l`, `mt-xs` (`zero`, `xxs`…`xxl`). Past XXL, use a multiple such as `gap-[calc(var(--space-xxl)*4/3)]`. Sizes (`w-*`, `h-*`, `size-*`) keep Tailwind's scale.
- **Always** round with `corner-{zero,xs…xl,full}` and stroke with `edge-{none,s,m,l}` (color stays `border-*`). Keep the squircle pair on surfaces: `corner-s squircle:corner-l corner-squircle`.
- **Always** separate surfaces with the hairline shadows `shadow-(--custom-shadow)` and its variants; elevation is `shadow-{s,m,l}`.
- **Never** hard-code a hex, `rgb()` or `oklch()` colour, or an arbitrary text size or spacing value, in `className` or `style`. Data and artwork colours (charts, lanes, syntax, brand art) are the exception; keep them with their data.
- **Always** merge classes with `cn()` from `@/lib/utils`: it knows Graphical's classes. Every component takes `className` and merges it on its root element.
- **Never** bake outer margins into a component. The call site spaces it.
- **Never** add a CSS file for something a utility or a primitive already covers. Feature CSS is for what Tailwind can't express (keyframes, `::part`, shadow-root styles, complex `:has()` chains), and reads the theme's variables.

## Theme

- **Always** read and set the theme through `useTheme()` from `@/app/providers/ThemeProvider` (`system` | `light` | `dark`). **Never** toggle `document.documentElement.classList` yourself.
- **Always** check every screen in light and dark.

## Icons — `@tabler/icons-react`

- **Always** import icons from `@tabler/icons-react`, and prefer the `*Filled` variant when one exists. **Never** add another icon library (lint rejects `lucide-react`).
- **Always** size icons with Tailwind: `size-3.5` by default, `size-3` in dense rows and badges, `size-4` for emphasis. Primitives size their own icons, so don't size an icon inside a `Button`.
- **Never** put a margin on an icon inside a `Button` or `Badge`; they space children with `gap-*`.

## Data

- **Always** call the API through the oRPC TanStack Query utils in `@/lib/orpc`. **Never** `fetch` the API from a component.
- **Never** mirror server data into `useState`; read it from the query.
- **Always** format dates with `date-fns`.

## Known debt (do not copy)

These predate the rules above. Move them onto the tokens when you touch them; don't extend them.

- `--dashboardy-*`, `--cost-*`, `--welcome-*` and `--auth-*` are now aliases of the theme's tokens; new code uses the theme's names directly.
- Feature CSS files (`costs/cost-dashboard*.css`, `app/app-surface.css`, `compass/compass.css`, …) hold hand-written surfaces, borders and colours.
- `className` strings still use `text-[color:var(--dashboardy-*)]`, hex colours and `border` for separation in places.
- Feature islands with their own palette and controls: costs and Compass (`--cost-*`, `.cost-text-button`, `.cost-secondary-button`), onboarding (`--welcome-*`, `.cli-onboarding-primary`, `.cli-onboarding-text-button`), sign-in (`--auth-*`, restyled `Button` and `Input`), and settings (`workspace-settings.css` restyles `Input`, `Select` and `Button`). Moving them onto the primitives changes how they look, so do it one island at a time with before and after screenshots.
- `.toolbar-search` and `.sessions-settings-search` are search fields styled outside `InputGroup`.
