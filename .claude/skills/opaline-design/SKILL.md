---
name: opaline-design
description: Build and extend Opaline's Mac app screens with the Opaline design system. Use whenever you add or change UI in apps/desktop/ui: a screen, a card, a row, a menu, a control, a colour, a state. Pairs with src/app/theme.css, src/app/tokens.css, src/app/patterns.css and the primitives in src/app/ui.
---

# Opaline design skill

Four files, one system. Load them in this order and never restyle past them.

| File | What it is | How you use it |
|---|---|---|
| `apps/desktop/ui/src/app/theme.css` | Layer 1, the primitives: fonts, both type scales, weights, tracking, space, corners, strokes, motion, the neutral ramp, the opal palette, success / warning / error and their tint opacities, in light (`:root`) and dark (`.dark`), plus the Tailwind utilities that read them. | Read it to pick a step. Screens never read its colours directly. |
| `apps/desktop/ui/src/app/tokens.css` | Layer 2, the roles screens are written against: ground, ink, lines, action, state, shadows, motion. `.dark` swaps Layer 1 and the few roles that change character. | Components and patterns read Layer 2 only. |
| `apps/desktop/ui/src/app/ui/` | The primitives: Button (with `toolbar` and `inline`), Input, Select, Checkbox, Card, Dialog, Sheet, Popover, Tooltip, Table, Badge, Avatar, Empty, TouchTarget, Bones. | Reach for a primitive before anything else. A recurring look is a variant here, not feature CSS. |
| `apps/desktop/ui/src/app/patterns.css` | Opaline's recurring elements as classes, each state as an attribute or class: text button, secondary button, filter chip, toolbar search, form button and field, tab track and pill, surface card, menu, settings group. | Compose from these; add a class, never an inline style. |

Tailwind reads the roles as colours: `bg-surface`, `text-ink-3`, `border-line`, `bg-accent-tint`. Feature CSS reads them as variables: `var(--surface)`, `var(--ink-3)`.

## The role set

This is the whole set. **Don't add roles, steps or shadows.** If nothing fits, use the nearest one.

- **Ground:** `canvas` (the window's content), `surface` (cards, panels, popovers, menus, controls), `inset` (a recessed area: wells, code, rails), `field` (inputs, chips, segmented tracks), `hover` (a row under the pointer, and any soft tint), `hover-strong` (pressed, open, selected, and any firmer tint).
- **Ink:** `ink` (titles, body, values), `ink-2` (secondary copy), `ink-3` (meta, labels, icons), `ink-4` (the quietest: disabled text, placeholders, separators, faint meta), `ink-inverse`.
- **Lines:** `line` (hairlines, dividers, inputs, rails), `line-soft` (chart grids, quiet dividers).
- **Action:** `primary`, `primary-hover`, `primary-fg` (the filled button and a checked checkbox), `focus`, `focus-ring` (the soft ring around a focused field), `accent` (Opaline blue: links, selection, info), `accent-tint`, `accent-line`, `accent-fg` (text on an accent fill, white in both modes).
- **State:** `success`, `warning`, `error`, each with `-tint` (a fill) and `-line` (an edge or ring).
- **Shadows:** `shadow-card` (anything resting on a ground: cards, panels, menus, controls, a window), `shadow-raised` (pressed or picked: a pressed toolbar pill, a lifted card), `shadow-inset` (the inner hairline of a well), `shadow-float` (free of any surface: sheets, toasts, flyouts; dark keeps only its ring, drawn at the call site).
- **Motion:** the theme's `--motion-duration` (150ms) with `--motion-easing`, and `--motion-large-duration` (300ms) with `--motion-large-easing`; the roles `--motion-quick-duration` (100ms), `--motion-medium-duration` (200ms), `--motion-slow-duration` (650ms); the easings `ease-base`, `ease-large`, `ease-strong`, `ease-drawer`, `ease-wave`.

There are no shades: no `text-ink/70`, no `bg-error/10`, no `line/50`. An opacity on a role is snapped to the role that holds it (see below).

## The steps

- **Body type** `text-body-{xxs 8, xs 10, s 11, m 12, l 13, xl 14, xxl 16}` and **display** `text-display-{xxs 20, xs 24, s 30, xxl 88}` carry size, line height and tracking together. Never a font size or a `leading-*` beside a step. A label set solid in a fixed-height chip, bar or cell takes `line-solid` (1); a dense figure row or a 10 / 12 tag takes `line-tight` (1.2). These are the only line utilities.

   | Body step | Size / line | Used for |
   |---|---|---|
   | `xxs` | 8 / 12 | avatar initials, overflow counts |
   | `xs` | 10 / 14 | micro labels, axis ticks |
   | `s` | 11 / 16 | chips, badges, pills |
   | `m` | 12 / 16 | meta, timestamps, captions |
   | `l` | 13 / 20 | dense rows, tables, menus |
   | `xl` | 14 / 20 | body copy, card and row titles |
   | `xxl` | 16 / 24 | card headings, emphasised values |

- **Weights** `font-regular`, `font-medium`, `font-heavy` (600; Tailwind's `font-bold` and `font-semibold` snap here).
- **Tracking** `tracking-{xs, s, m, l, xl}`: `xs` tightens a large title (−1.5%), `xl` opens an uppercase label (+2%).
- **Space** `zero`, `xxs` 2, `xs` 4, `s` 6, `m` 8, `l` 12, `xl` 16, `xxl` 24: `gap-m`, `px-l`, `mt-xs`. Past 24px, a multiple: `gap-[calc(var(--space-xxl)*4/3)]` for 32. Sizes (`w-*`, `h-*`, `size-*`) keep Tailwind's scale.
- **Corners** `corner-{zero, xs 6, s 8, m 10, l 14, xl 22, full}`, plus `corner-{s,l,xl}-inset` (1px inside a surface), `corner-xl-inner` (18, a space step inside an xl squircle) and `corner-xl-outer` (26, a space step outside one).
- **Strokes** `edge-{none, s 0.5, m 1, l 2}`; the colour is `border-line` or `border-line-soft`.

## Build order

1. Tokens load once from `src/index.css`: `theme.css`, then `tokens.css`, then `patterns.css`. Dark is the `dark` class on `<html>`, set by `ThemeProvider`. Roles flip with the mode, so a component rarely needs `dark:`.
2. A primitive from `src/app/ui`, then a pattern from `patterns.css`. Reuse before you draw.
3. Type, space, corners and motion only through the steps above.
4. Icons are Tabler (`@tabler/icons-react`), outline by default; the `*Filled` variant is for navigation and identity (sidebar and settings nav, reader tabs, small category marks). Sizes go by place, and primitives size their own: 14 (`size-3.5`) in buttons, toolbar pills, inputs and as the default; 12 (`size-3`) in badges, dense rows and `icon-xs` buttons; 16 (`size-4`) in menu and select items. Don't size an icon inside a primitive.

## How to pick a role

Every value lands on a role or a step. Read the table top to bottom and take the first row that matches.

| What you have | Take |
|---|---|
| `ink` with an opacity, or any near-black text (`#111`, `#292a2f`, `oklch(0.205 0 0)` …) | 80% or more: `ink`; 50 to 79%: `ink-2`; below 50%: `ink-3` |
| `ink-2` with an opacity | 80% or more: `ink-2`; else `ink-3` |
| `ink-3` with an opacity, or a mid grey (`#5d5d5d`, `#828387`, `#acaeb2` …) | 70% or more: `ink-3`; below: `ink-4`. A mid grey takes the nearest of `ink-2`, `ink-3`, `ink-4` by lightness, in both modes |
| A translucent fill (`field/50`, `hover/…`, `ink/5`, `black/5`, `white/10` …) | a soft tint (about 2 to 5% ink): `hover`; a firmer one (6 to 12%), a scrim, a skeleton bone: `hover-strong` |
| An opaque light fill (`#f4f4f5`, `field/80` …) | `field`, or `inset` if it's lighter than `field` |
| An edge with an opacity (`line/50`, `border/60` …), or a literal edge | 60% or more: `line`; else `line-soft` |
| Red, amber, orange or green for a state (invalid, negative, warning, success, an owner's crown) | `error`, `warning`, `success`; a fill takes its `-tint`, an edge or ring its `-line` |
| Blue for a link, selection or info | `accent`, `accent-tint`, `accent-line` |
| A filled near-black button or check | `primary` on `primary-fg`, hovering to `primary-hover` |
| A text size off the scale | the nearest body or display step; on a tie, the smaller (15px is `body-xl`) |
| `leading-*` or an arbitrary line height | drop it (the step carries its line), or `line-solid` / `line-tight`; in CSS, the step's `var(--line-*)` |
| Arbitrary tracking | drop it, or the nearest `tracking-*` (an uppercase label: `tracking-xl`) |
| Font weight 600 or 700 | `font-heavy` |
| Off-scale space (5, 10, 14, 20 …) | the nearest step; on a tie, the one that keeps the element aligned with its neighbours |
| `rounded-*` or an off-scale radius | the nearest corner: 2px is `corner-zero`, 4 to 5px `corner-xs`, 12px `corner-m`, 16 to 18px `corner-l`, a 40px squircle `corner-xl-outer` |
| A literal shadow | `shadow-card` (resting), `shadow-raised` (pressed or lifted), `shadow-inset` (a well), `shadow-float` (free-floating) |
| A literal duration or easing | the nearest duration role (50–110ms quick, 120–170 base, 180–250 medium, 280–400 large, 500–800 slow) or easing (`ease`/`ease-out` base, `ease-in-out` wave, a strong ease-out strong, a drawer curve drawer); a loop's period (1s or longer) and `linear` stay literal |
| A direct Layer 1 read (`neutral-N`, `color-N`) | the role that holds it (`neutral-3` is `field`, `neutral-6` is `ink-4` …) |
| A colour in feature CSS | the same table, written `var(--role)`; a CSS rule that now repeats a pattern or primitive is deleted in favour of it |

A filter or mask that needs a colour takes a role variable too: `drop-shadow(0 0 0.5px var(--line))`.

## Rules that keep the craft

1. **Neutral is the primary action.** One filled `Button` per view, filled with `primary`. Colour never says “click me”.
2. **Colour means state.** `accent` marks selection, links and information; success / warning / error mark outcomes. A sentiment chip is `bg-{state}-tint text-{state}`; an invalid control is `border-error` with `ring-error-line`.
3. **Data paint is data.** Chart series, activity lanes, event dots, cost heat, model tones, syntax colours, diff marks, a language's or tool's brand colour and the opal sheen carry meaning. They stay as authored and never take a theme role: two categories must never share a colour.
4. **Four inks, no shades.** `ink` for what you read, `ink-2` for secondary copy, `ink-3` for meta, labels and icons, `ink-4` for the quietest things: disabled text, placeholders, separators. No literal grey and no opacity on an ink.
5. **White space first, a line next, a card last.** Separate with space; then a `line`; a card (`shadow-card` on `surface`) only when the group is independently actionable.
6. **Squircles on surfaces, pills on controls.** Cards and panels `corner-m squircle:corner-xl corner-squircle`, menus and popovers `corner-s squircle:corner-l corner-squircle`. Toolbar buttons, badges and avatars are `corner-full`; chips, checkboxes and skeleton bars are `corner-xs`.
7. **Data in the data face.** Money, times, counts, percentages and code are Geist Mono (`font-data`) with `tabular-nums`. Everything else is Inter: a page title is `text-display-xs font-medium`.
8. **Controls have fixed heights.** Toolbar pills 32 (`Button variant="toolbar"`), inputs 36, buttons 24 / 32 / 36 by size, menu rows 32. Toolbar controls hold a choice with `aria-pressed` or `data-active`. Keyboard focus is one mark: `focus-outline` on Button and anything clickable; fields keep `focus-visible:border-focus` with `ring-focus-ring`.
9. **It's a Mac app.** No pointer cursor on controls. The sidebar stays translucent so the window's vibrancy shows through (`src/app/app-surface.css`). Small controls get a `TouchTarget`.
10. **Motion is quiet.** Buttons press to .97, menus share the fluid hover highlight, numbers count with `FlowNumber`, skeletons reveal with `Bones`. Popups zoom in from 95%. Respect reduced motion. Time every transition with a motion role, never a literal.

## Adding a pattern

- Start from the nearest primitive or pattern and keep its height, padding and corners.
- Feature CSS never reaches into a primitive with `[data-slot=…]`. A recurring look is a variant or prop on the primitive or a pattern; a one-off is a `className` at the call site. The two exceptions are themes over every primitive of a kind: `patterns.css`'s settings group, and the plugin host mode in `src/widget/plugin.css`.
- Name states as attributes (`aria-pressed`, `aria-selected`, `data-active`, `data-popup-open`) or classes, so every state renders at rest for review.
- Backgrounds from the grounds, text from the inks, edges from the lines or a role shadow. Never a hex, `rgb()` or `oklch()` outside a token definition or data paint.
- Add it to the system page, `/dev/design-system` in development (`src/app/system/DesignSystemPage.tsx`), with each state at rest, light beside dark. The page is the spec.

## The check and its markers

`bun run check:design` (`tools/design-escapes.ts`) reads every class string and CSS declaration under `src` and lists each escape by rule: `type`, `space`, `radius`, `colour`, `shadow`, `opacity`, `motion`, `base` and `marker`. `--path <prefix>` and `--rule <name>` narrow what it prints. The counts are held at 0 by `tools/design-escapes.baseline.json`, with a ceiling on the number of markers that only goes down.

A marker excuses only what a scale can't hold:

- **data paint:** chart series, syntax colours, diff marks, a model's or tool's brand colour, heat gradients;
- **artwork:** the opal sheen, the star card's split flap, glows;
- **the platform:** the macOS window glass and vibrancy;
- **third-party code.**

Write it as `design-escape-ok(<rule>[,<rule>…]): <what it is>; <detail>`, in a comment on the line or the line above, for example `design-escape-ok(colour): data paint; the trace lanes' hues`. It lifts only the named rules. A file that is all data paint goes in `DATA_PAINT` in `tools/design-escapes.ts`, with its reason and the rules it lifts.

The check refuses a marker whose reason starts with `shipped value` or `no role renders this`: a value the app happened to ship is snapped onto the system, not kept. Such a marker is itself a `marker` escape and exempts nothing. So is a bare `design-escape-ok:`, a marker naming an unknown rule, and a marker with nothing left to exempt.

## Levers

A design change is made once, in `theme.css` (a step, a ramp, a tint opacity) or `tokens.css` (a role's value), never at a call site. Check it on the system page in both modes.
