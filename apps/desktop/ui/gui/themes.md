# Opaline theme reference

The installed theme, as `graphical/generated/theme.css` defines it. Graphical's import wrote it from Opaline's own values; edit the theme through the editor or `graphical-adopt`, never this file or `generated/`. Dark mode is the `dark` class on `<html>`, set by Opaline's `ThemeProvider`.

Files: active theme `graphical/themes/opaline.json` (named Opaline), role map `graphical/role-map.json`, generated CSS `graphical/generated/theme.css` (imported by `src/index.css`), Tailwind classes `graphical/generated/tailwind-theme.css`, tailwind-merge classes `graphical/generated/tailwind-merge.cjs` (used by `cn()` in `src/lib/utils.ts`).

## Colors

| Variable | Light | Dark |
| --- | --- | --- |
| `--color-1` | `#2e70ff` | `#2e70ff` |
| `--color-2` | `#a847ff` | `#a847ff` |
| `--color-3` | `#6d58ff` | `#6d58ff` |
| `--color-4` | `#e03bf0` | `#e03bf0` |
| `--color-5` | `#ff3dc0` | `#ff3dc0` |
| `--neutral-1` | `#ffffff` | `#0f0f0f` |
| `--neutral-2` | `#fafafa` | `#171717` |
| `--neutral-3` | `#f5f5f5` | `#262626` |
| `--neutral-4` | `#e5e5e5` | `#404040` |
| `--neutral-5` | `#d4d4d4` | `#525252` |
| `--neutral-6` | `#a1a1a1` | `#737373` |
| `--neutral-7` | `#737373` | `#a1a1a1` |
| `--neutral-8` | `#525252` | `#d4d4d4` |
| `--neutral-9` | `#262626` | `#e5e5e5` |
| `--neutral-10` | `#0a0a0a` | `#fafafa` |
| `--success` | `#16a34a` | `#00bc7d` |
| `--warning` | `#f54900` | `#fe9a00` |
| `--error` | `#e7000b` | `#ff6467` |

Every color also has `-translucent` (stronger) and `-transparent` (lighter) levels, and `--on-<color>` for readable text on it. Tailwind: `bg-neutral-3`, `text-neutral-7`, `border-neutral-10-transparent`, `bg-color-1`, `text-error`.

Palette: color-1 is Opaline's brand blue (opal-1); colors 2–5 are the rest of the opal sheen, ordered by use (opal-3, opal-2, opal-4, opal-5). Statuses are success, warning and error. Opaline's own token names stay as aliases of these (`--background` → `--neutral-1`, `--muted-foreground` → `--neutral-7`, `--dashboardy-heading` → `--neutral-10` …); `graphical/role-map.json` lists every one. Kept as authored (`fixed`): `--sidebar`, `--dashboard-01-chrome-surface`, `--dashboard-01-chrome-backdrop-fill`, `--dashboard-01-rail-active`, `--chart-1`, `--chart-2`, `--chart-3`, `--chart-4`, `--chart-5`, `--active-turn-rail`, `--bone-shine`, `--input`, `--control-hover`, `--trace-code-primary`, `--trace-code-secondary`, `--trace-code-tertiary`, `--welcome-field`, `--dashboardy-subsurface`, `--dashboardy-subsurface-strong`, `--dashboardy-surface`, `--constellation-tree-primary`, `--constellation-tree-secondary`, `--constellation-tree-tertiary`, `--session-menu-checkbox-border`, `--dashboard-01-insights-subsurface`, plus data and artwork colours (charts, lanes, cost heat, syntax, opal art).

## Fonts

| Role | Family | Regular / Medium / Heavy |
| --- | --- | --- |
| Body | `"Inter Variable", sans-serif` | 400 / 500 / 600 |
| Display | `"Nunito", "Inter Variable", sans-serif` | 600 / 700 / 800 |
| Data | `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | 400 / 500 / 600 |

Loaded by `@fontsource-variable/inter` (src/index.css) and `@fontsource/nunito` 600–800 and `@fontsource/geist-mono` 400–600 (src/app/preset-extensions.css). Classes: `font-body`, `font-display`, `font-data`; weights `font-regular`, `font-medium`, `font-heavy`.

## Type

| Step | Body size / line | Display size / line |
| --- | --- | --- |
| xxs | 8px / 12px | 20px / 28px |
| xs | 10px / 14px | 24px / 32px |
| s | 11px / 16px | 30px / 36px |
| m | 12px / 16px | 36px / 40px |
| l | 13px / 20px | 48px / 52px |
| xl | 14px / 20px | 64px / 68px |
| xxl | 16px / 24px | 88px / 88px |

Classes `text-body-{step}` and `text-display-{step}` set size, line height and tracking together; don't add `leading-*` beside them. Each step is one of the sizes Opaline already used: Body M is 12px meta, Body L 13px rows, Body XL 14px interface text, Body XXL 16px headings. Body tracking is 0; XXL and display tighten to −1.5%.

## Spacing, corners, strokes, shadows

| Token | Value |
| --- | --- |
| `--space-zero` | `0px` |
| `--space-xxs` | `2px` |
| `--space-xs` | `4px` |
| `--space-s` | `6px` |
| `--space-m` | `8px` |
| `--space-l` | `12px` |
| `--space-xl` | `16px` |
| `--space-xxl` | `24px` |
| `--radius-zero` | `0px` |
| `--radius-xs` | `6px` |
| `--radius-s` | `8px` |
| `--radius-m` | `10px` |
| `--radius-l` | `14px` |
| `--radius-xl` | `22px` |
| `--radius-full` | `9999px` |
| `--border-none` | `0px` |
| `--border-s` | `0.5px` |
| `--border-m` | `1px` |
| `--border-l` | `2px` |
| `--shadow-s` | `0px 1px 2px 0px #0a0a0a0d` |
| `--shadow-m` | `0px 2px 8px -2px #0a0a0a14` |
| `--shadow-l` | `0px 10px 15px -3px #0a0a0a1a` |

Classes: `p-m`, `gap-l`, `mt-xs`; spacing past XXL is a multiple, `gap-[calc(var(--space-xxl)*4/3)]` (32px). Corners `corner-{step}` (Tailwind's `rounded-*` keep their own meaning), strokes `edge-{step}` with `border-*` for color, elevation `shadow-{s,m,l}`. Opaline's squircle pairs: cards `corner-m squircle:corner-xl corner-squircle` (10 → 22), menus and popovers `corner-s squircle:corner-l corner-squircle` (8 → 14). Geometry (`w-*`, `h-*`, `size-*`) keeps Tailwind's scale.

## Opaline's components

The primitives in `src/app/ui` read these tokens (see `FRONTEND.md`): `Button` variants, `Card` (`[data-slot="card"]`, the Cards region), `Input`, `Select`, `Badge`, `Table`, menus and popovers. Their hairline edges stay Opaline's `--custom-shadow` family (edge shadows are kept as authored). Appearance regions: cards `[data-slot="card"], .settings-section-surface, .dashboardy-card`; groups `.workspace-settings-group`; navigation `[data-slot="sidebar-container"], [data-sidebar="sidebar"]`, whose translucent `--sidebar` is kept for macOS vibrancy.
