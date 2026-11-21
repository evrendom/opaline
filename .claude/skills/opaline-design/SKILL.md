---
name: opaline-design
description: Build and extend Opaline's Mac app screens with the Opaline design system. Use whenever you add or change UI in apps/desktop/ui: a screen, a card, a row, a menu, a control, a colour, a state. Pairs with graphical/themes/opaline.json, src/app/tokens.css, src/app/patterns.css and the primitives in src/app/ui.
---

# Opaline design skill

Four files, one system. Load them in this order and never restyle past them.

| File | What it is | How you use it |
|---|---|---|
| `apps/desktop/ui/graphical/themes/opaline.json` | Layer 1, the source of truth: fonts, both type scales, space, corners, strokes, shadows, motion, the neutral ramp, the opal palette, success / warning / error and their tint opacities, in light and dark. | Read it to pick a value. Change it through the Graphical editor or the `graphical-adopt` skill, which regenerates `graphical/generated/theme.css`. Never edit `generated/`. |
| `apps/desktop/ui/src/app/tokens.css` | Layer 2, the roles screens are written against: ground, ink, lines, action, state, elevation. `.dark` swaps Layer 1 and the few roles that change character. | Components and patterns read Layer 2 only. A new role goes here first. |
| `apps/desktop/ui/src/app/ui/` | The primitives: Button (with `toolbar` and `inline`), Input, Select, Card, Dialog, Sheet, Popover, Tooltip, Table, Badge, Avatar, Empty, TouchTarget, Bones. | Reach for a primitive before anything else. A recurring look is a variant here, not feature CSS. |
| `apps/desktop/ui/src/app/patterns.css` | Opaline's recurring elements as classes, each state as an attribute or class: text button, secondary button, filter chip, toolbar search, form button and field, tab track and pill, surface card, menu, settings group. | Compose from these; add a class, never an inline style. A tab row's sliding pill is `PillTabs pillClassName="tab-pill"` (or `.tab-track` for the track tone); the sign-in forms put `form-button` / `form-input` on Button and Input. |

Tailwind reads the same roles as colours: `bg-surface`, `text-ink-3`, `border-line`, `bg-accent-tint`. Feature CSS reads them as variables: `var(--surface)`, `var(--ink-3)`.

## Build order

1. Tokens load once from `src/index.css`: Graphical's `theme.css` (Layer 1), then `tokens.css` (Layer 2), then `patterns.css`. Dark is the `dark` class on `<html>`, set by `ThemeProvider`. Roles flip with the mode, so a component doesn't check it: a `dark:` that swaps one role for another means a role is missing, so add the role. A primitive keeps a `dark:` pair only where the value differs by an opacity step no role holds (Button's primary hover, its destructive fill), with a comment saying so.
2. A primitive from `src/app/ui`, then a pattern from `patterns.css`. Reuse before you draw.
3. Type only through the scales: `text-body-{xxs…xxl}` and `text-display-{xxs…xxl}` carry size, line height and tracking together; weight is `font-regular`, `font-medium`, `font-heavy`. Never a font size or a `leading-*` beside a text style.

   | Body step | Size / line | Used for |
   |---|---|---|
   | `xxs` | 8 / 12 | avatar initials, overflow counts |
   | `xs` | 10 / 14 | micro labels, axis ticks |
   | `s` | 11 / 16 | chips, badges, pills |
   | `m` | 12 / 16 | meta, timestamps, captions |
   | `l` | 13 / 20 | dense rows, tables, menus |
   | `xl` | 14 / 20 | body copy, card and row titles |
   | `xxl` | 16 / 24 | card headings, emphasised values |

   A label set solid to centre in a fixed-height chip, bar or cell takes `line-solid` (line height 1) beside its step; a dense figure row or a 10 / 12 tag takes `line-tight` (1.2). An uppercase eyebrow takes `tracking-caps`. These are the only line and tracking utilities; never `leading-*` or a `tracking-[…]`.

   Display: `xxs` 20 / 28, `xs` 24 / 32 (page titles), `s` 30 / 36, up to `xxl` 88 for artwork glyphs. Body tracking is 0 from `xs` to `xl`; `xxs` opens to +2%, and `xxl` and display tighten to −1.5%.
4. Space only through the steps: `gap-m`, `px-l`, `mt-xs` (`zero` 0, `xxs` 2, `xs` 4, `s` 6, `m` 8, `l` 12, `xl` 16, `xxl` 24). Past 24px, a multiple: `gap-[calc(var(--space-xxl)*4/3)]` for 32.
5. Icons are Tabler (`@tabler/icons-react`), outline by default: actions, controls, rows and inline glyphs. The `*Filled` variant is for navigation and identity: sidebar and settings nav, reader tabs, and the small category marks in charts, legends and labels, where a solid shape reads at 12–14px. Sizes go by place, and primitives size their own: 14 (`size-3.5`) in buttons, toolbar pills, inputs and as the default; 12 (`size-3`) in badges, dense rows and `icon-xs` buttons (11 in `xs` buttons); 16 (`size-4`) in menu and select items and for emphasis. Don't size an icon inside a primitive.

## The layers

- **Layer 1** is what Graphical's theme defines: ten neutrals (`neutral-1` page to `neutral-10` strongest text), the opal palette (`color-1` Opaline blue, then the rest of the sheen), success / warning / error, each with a `-transparent` and `-translucent` level; body and display type steps; space; corners; strokes; three shadows; motion.
- **Layer 2** is what screens are written against:
  - ground: `canvas` (the window's content), `surface` / `card` (cards, panels, menus, controls), `card-soft` (a card on a recessed ground: a tab's active pill, a picked row; a translucent ink wash in dark), `inset` (wells, code, rails), `field` (inputs, chips), `track` (a segmented track and the tone sliding along it), `shelf` (a list's expanded row and its frozen cap: field in light, card in dark), `hover`, `hover-strong`, `wash` (a soft tint on any ground), `mark-fill` (model marks, run tags, placeholder bars; firmer in dark);
  - ink: `ink`, `ink-2`, `ink-3`, plus `ink-disabled` and `ink-inverse`; two that change character in dark: `ink-soft` (secondary icons: ink-2, quieting to ink-3 in dark) and `ink-meta` (the activity panels' meta: ink-3, opal-tinted in dark);
  - lines: `line` (hairlines, dividers, rails), `line-strong` (opaque edges), `line-soft` (chart grids, quiet dividers), `line-faint` (the faint ring around a small avatar or logo);
  - action: `primary`, `primary-hover`, `primary-fg`, `focus`, `focus-ring` (the soft ring around a focused control: `focus-visible:ring-focus-ring`); `accent`, `accent-tint`, `accent-line`, `accent-fg` (text and icons on an accent fill, white in both modes);
  - state: `success`, `warning`, `error`, each with `-tint` (a pastel fill) and `-line` (its edge);
  - elevation: `card` (cards, panels, tooltips), `control` (buttons, inputs, toolbar pills), `raised` (a pressed or active control), `overlay` (menus, popovers, dialogs), `primary` and `destructive` (those buttons), `chip` (chips, tags, pills, the reader's light cards), `selected` (a picked row lifted off its shelf), `inset` (a shelf's inner hairline), `label` (a small label floating over content), `float` (something free of any surface: a floating button, a toast; dark keeps only its ring), `sheet` (a sheet sliding in from an edge), `contact` (the contact shadow under a checkbox), `window` (a window or lens over a chart; dark keeps its ring), `jump` (a small round button floating over a scrolling list; dark trades the drop for a faint ink ring), `flyout` (a translucent flyout dropping from a strip; dark deepens it). Tailwind reads each as `shadow-<role>` (`shadow-card`, `aria-pressed:shadow-raised`), CSS as `var(--shadow-<role>)`. A recurring shadow is a role, not a `shadow-[…]`; Tailwind's `shadow-sm…xl` and the theme's `shadow-s/m/l` are not used in screens.
- Dark is not an inversion. Roles keep their names; Layer 1 swaps the ramp, `surface` steps one up from `canvas`, `line-strong` becomes the translucent `line`, and every shadow trades its soft drop for an inset highlight edge.
- The role shadows live in `tokens.css`, not the theme: each is a stack of hairline, contact and ambient layers, and dark swaps in inset highlights over black drops. A theme shadow is one layer coloured from one neutral that flips with the mode, so it can't hold them; the theme's `shadow-s/m/l` stay as Graphical emits them, unused. `shadow-destructive` mixes from `--error`.
- Plugin mode (the widget build, `src/widget/plugin.css`) overrides two roles with other roles for the chat host: `primary` is `ink`, and `card` is `canvas`. Every other role keeps its app value.

## Rules that keep the craft

1. **Neutral is the primary action.** One filled `Button` per view, filled with `primary`. Colour never says “click me”.
2. **Colour means state.** `accent` marks selection, links and information; success / warning / error mark outcomes. A sentiment chip is `bg-{state}-tint text-{state}`.
3. **Data paint is data.** Chart series, activity lanes, event dots, cost heat, model tones, syntax colours, a language's brand colour and the opal sheen carry meaning. They stay as authored and never take a theme role: two categories must never share a colour.
4. **Three inks.** `ink` for what you read, `ink-2` for secondary copy, `ink-3` for meta, labels, icons and placeholders. `ink-disabled` is disabled text and the faintest hints (an empty value's dash, a separator glyph). No literal grey, no fourth ink, and no opacity on an ink: `text-ink-3/50` is a fourth grey, so it takes `ink-disabled`. See the snapping table below.
5. **White space first, a line next, a card last.** Separate with space; then a `line`; a `surface-card` only when the group is independently actionable. Edges are hairline shadows (`shadow-card`, `shadow-control`), not borders.
6. **Squircles on surfaces, pills on controls.** Corners are `xs` 6, `s` 8, `m` 10, `l` 14, `xl` 22. A squircle needs a larger radius to read as round as an arc, so the pair goes together: cards and panels `corner-m squircle:corner-xl corner-squircle`, menus and popovers `corner-s squircle:corner-l corner-squircle`. Toolbar buttons, badges and avatars are `corner-full`; chips are `corner-xs`. A child drawn 1px inside a surface (a hover or focus overlay on a tile) keeps the corners concentric with `corner-s-inset squircle:corner-xl-inset`; one drawn a space step (4px) inside an xl squircle (a row highlight in a card) takes `squircle:corner-xl-inner` (18), and an outline 4px outside one (a drop target around a shelf) `squircle:corner-xl-outer` (26). A skeleton bar too small for `xs` still takes `corner-xs`.
7. **Data in the data face.** Money, times, counts, percentages and code are Geist Mono (`font-data`) with `tabular-nums`. Everything else, headings and page titles included, is Inter: a page title is `text-display-xs font-medium`. The theme's display face, Nunito (`font-display`), has one use, the conversation trace's heading; don't reach for it elsewhere.
8. **Controls have fixed heights.** Toolbar pills 32 (`Button variant="toolbar"`), inputs 36, buttons 24 / 28 / 32 by size, menu rows 32. Toolbar controls hold a choice with `aria-pressed` or `data-active`.
   Keyboard focus is one mark: `focus-outline` (a 2px accent outline just outside the control) on Button and on anything clickable that isn't a Button; fields keep `focus-visible:border-focus` with `ring-focus-ring`. An icon-only button is `Button size="icon" | "icon-sm" | "icon-xs"` with an `aria-label`, never a raw `<button>` with its own focus style.
9. **It's a Mac app.** No pointer cursor on controls. The sidebar stays translucent so the window's vibrancy shows through: that translucency (`src/app/app-surface.css`, the shell's chrome) is the one literal colour family kept there, each value behind a per-rule marker; the sidebar primitive's other names (`--sidebar-foreground`, `--sidebar-accent` …) come from `tokens.css`. Small controls get a `TouchTarget`.
10. **Motion is quiet.** Buttons press to .97, menus share the fluid hover highlight, numbers count with `FlowNumber`, skeletons reveal with `Bones`. Popups zoom in from 95% and out to it (`zoom-in-95` / `zoom-out-95`, in the primitives); the theme's `--motion-popup-scale` is not read. Respect reduced motion. Time every transition with a motion role, never a literal; a loop's period (a spinner, a shimmer, a pulse: 1s or longer) is the one literal duration, and `linear` the one literal easing:

   | Role | Value | Used for |
   |---|---|---|
   | `--motion-quick-duration` | 100ms | hover tints, a check appearing, flyouts |
   | `--motion-duration` (theme) | 150ms | small changes, with `--motion-easing` |
   | `--motion-medium-duration` | 200ms | fades, sheets, a panel's width |
   | `--motion-large-duration` (theme) | 300ms | large changes, with `--motion-large-easing` |
   | `--motion-slow-duration` | 650ms | a chart drawing in, a skeleton leaving |
   | `--motion-easing` (`ease-base`) | cubic-bezier(.2, .8, .2, 1) | the default ease-out for small changes |
   | `--motion-large-easing` (`ease-large`) | cubic-bezier(.16, 1, .3, 1) | large changes |
   | `--motion-strong-easing` (`ease-strong`) | cubic-bezier(.23, 1, .32, 1) | presses, things entering |
   | `--motion-drawer-easing` (`ease-drawer`) | cubic-bezier(.32, .72, 0, 1) | drawers, rails, rings settling |
   | `--motion-wave-easing` (`ease-wave`) | cubic-bezier(.455, .03, .515, .955) | strips growing, loops |

   The theme holds only its two timings, so the others are Layer 2 roles in `tokens.css` (with literal values, like the role shadows). In Tailwind: `duration-(--motion-medium-duration) ease-strong`.

## Snapping table

How an escape maps onto the system. Nothing may visibly change: take the role or step only when it renders the same in both modes (within about 1px, or a colour difference you can't see; a motion timing may snap, since motion isn't a look at rest). When the nearest role would visibly change something, keep the value and mark it, `design-escape-ok(<rule>): no role renders this; <value>` (see the check), rather than force a snap or invent a role.

| Escape | Becomes |
|---|---|
| text `ink/90`, `ink/95` | `ink` |
| text `ink/70`–`ink/80` | `ink-2` |
| text `ink/60`, `ink-2/…` | `ink-3` |
| text `ink-3/40`–`ink-3/70` | `ink-disabled` |
| fill `ink/3`–`ink/5`, `ink-3/10` | `wash` (or `hover` when it is a pointer state) |
| fill `ink/6`–`ink/10`, `ink-3/15`–`ink-3/20` | `hover-strong` |
| edge `ink/6`–`ink/15`, `ink-3/20`–`ink-3/30` | `line` |
| edge or fill `ink/20`–`ink/30`, `ink-3/40` | `line-strong` |
| `line/40`–`line/60` | `line-soft` |
| `line/70`+, `line-strong/30`–`line-strong/50` | `line` |
| `hover/50`–`hover/80` | `hover` |
| `field/35`–`field/60` | `inset`; `field/70`+ is `field` |
| `focus/40`, `focus/50` | `focus-ring` |
| `{success,warning,error}/5`–`/15`, `accent/10`–`/20` | `{state}-tint`, `accent-tint` |
| `{success,warning,error}/20`–`/50` as an edge or bar, `accent/30`+ | `{state}-line`, `accent-line` |
| `text-{state}/…` | `text-{state}` |
| `var(--neutral-N)`, `bg-neutral-N`, `color-N` outside data paint | the role that holds it (`neutral-3` is `field`, `neutral-6` is `ink-disabled` …) |
| duration 50–110ms | `--motion-quick-duration` (100) |
| duration 120–170ms | `--motion-duration` (150) |
| duration 180–250ms | `--motion-medium-duration` (200) |
| duration 280–400ms | `--motion-large-duration` (300) |
| duration 500–800ms | `--motion-slow-duration` (650) |
| `ease`, `ease-out`, `ease-in` (CSS or Tailwind) | `ease-base` / `var(--motion-easing)` |
| `ease-in-out` | `ease-wave` |
| `cubic-bezier(.22, 1, .36, 1)` and other strong ease-outs | `ease-strong` |
| `cubic-bezier(.2, 0, 0, 1)` and other drawer curves | `ease-drawer` |
| `delay-300` | `delay-(--motion-large-duration)` |
| `leading-none`, set solid | `line-solid` |
| 10 / 12, 13 / 16, 9 / 12 | the body step plus `line-tight` |
| `tracking-[0.18em]`…`[0.24em]` | `tracking-caps` |
| 18px / 26px squircle | `corner-xl-inner` / `corner-xl-outer` |
| 4px skeleton corner | `corner-xs` |
| CSS `font-size` / `line-height` literal | the body step's variables (`var(--size-m)` with `var(--line-m)` …) or the utility class on the element |
| CSS `font-family` literal | `var(--font-body)`, `var(--font-display)`, `var(--font-data)` |
| CSS colour literal | a role variable; data paint stays, in a `DATA_PAINT` file or behind a marker |

## Adding a pattern

- Start from the nearest primitive or pattern and keep its height, padding and corners.
- Feature CSS never reaches into a primitive with `[data-slot=…]`. A recurring look is a variant or prop on the primitive (`InputGroup variant="toolbar"`, `Sidebar rootClassName`) or a pattern (`.form-button`, `.form-input`, `.tab-pill`); a one-off is a `className` at the call site. The two exceptions are themes over every primitive of a kind: `patterns.css`'s settings group, and the plugin host mode in `src/widget/plugin.css`.
- Name states as attributes (`aria-pressed`, `aria-selected`, `data-active`, `data-popup-open`, `data-inactive`) or classes, so every state renders at rest for review.
- A new colour is a new role first: in `tokens.css` on a Layer 1 token, registered as a Tailwind colour, and in Graphical's role map (`graphical/role-map.json`, and `graphical/install/import.mjs` for re-imports) so the editor's theme edits reach it. A new shadow is a role in `tokens.css` (light in `:root`, dark in `.dark`), registered in its `@theme inline reference` block and in `ROLE_SHADOWS` in `src/lib/utils.ts` so `cn()` merges it.
- Backgrounds from the ground roles, text from the inks, edges from the lines or a role shadow. Never a hex, `rgb()` or `oklch()` outside a token definition or data paint.
- Add it to the system page, `/dev/design-system` in development (`src/app/system/DesignSystemPage.tsx`), with each state at rest; it shows light beside dark, each in its own frame. The page is the spec.
- Review it in light and dark before merging.

## The check

`bun run check:design` (from the repo root or `apps/desktop/ui`; `tools/design-escapes.ts`) reads the class strings under `src` and lists every escape: Tailwind's default type (`text-sm`, `text-[13px]`, `leading-*`, `tracking-wide`), spacing (`p-3`, `gap-[10px]`), every `rounded-*`, palette colours (`bg-rose-500`, `text-white`), a hex, `rgb()` or `oklch()` in a class, and Tailwind's or literal shadows. It enforces all of `src/` (`ENFORCED`). It also reads every CSS declaration: colour, font and motion literals, an opacity modifier on a theme colour, and a direct Layer 1 read (`neutral-N`, `color-N`). Data paint passes by a whole-file entry in `DATA_PAINT` (with its reason and the rules it lifts) or a per-rule marker, `design-escape-ok(<rule>[,<rule>…]): <reason>`, in a comment on the line or the line above; it lifts only the named rules. A bare `design-escape-ok:` exempts nothing and is itself flagged, as is a marker with nothing left to exempt. Counts are held by a ratchet in `tools/design-escapes.baseline.json`: every rule sits at 0, and the number of markers is a ceiling that only goes down (after removing markers, `bun run check:design --update-baseline` lowers it; never raise it by hand to make room for a new escape). Most markers read `no role renders this; <value>`: a near-miss kept so the look doesn't change, and the place to start when the system grows a role for it; `--path <prefix>` and `--rule <name>` narrow what it prints. The web tests and CI run it.

## Levers

The Graphical editor's Theme panel tunes the whole system at once: Size and Spacing (density), Character (corners, strokes, weights), the palette and each colour's tint and translucent opacity. Anything else is a design change: make it in the theme or in `tokens.css`, never at a call site.
