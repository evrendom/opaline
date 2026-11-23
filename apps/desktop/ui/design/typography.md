# Typography

One face, Inter, for everything; Geist Mono for data: code, IDs, hashes,
paths and aligned numbers. Sizes come only from the steps below, which are
set in `src/app/theme.css`. Each step carries its own line height, so pair
it with nothing.

## Steps

| Class | Size / line | Use for |
|---|---|---|
| `text-body-xxs` | 8 / 12 | avatar initials, dense tags only |
| `text-body-xs` | 10 / 14 | chart ticks, file badges |
| `text-body-s` | 11 / 16 | meta lines, group labels, timestamps |
| `text-body-m` | 12 / 16 | chips, menus, secondary rows, table cells |
| `text-body-l` | 13 / 20 | list rows, card titles, prose in dense panels |
| `text-body-xl` | 14 / 20 | the body: buttons, settings rows, dialog text |
| `text-body-xxl` | 16 / 24 | the shell header's page title, the reader's lead |
| `text-display-xxs` | 20 / 28 | a report title, a skill mark |
| `text-display-xs` | 24 / 32 | a settings page title |
| `text-display-s` | 30 / 36 | the 404 and invite pages |
| `text-display-xxl` | 88 / 88 | the skill card's big glyph only |

That's the complete set. `text-sm`, `text-xs`, `text-[13px]` and every other
size are errors. Never go below 10px (`text-body-xs`) for anything a person
reads: `text-body-xxs` is only for initials and dense tags.

```
What size is this text?
 ├── Is it a page or dialog title? → text-body-xxl (shell header) or text-display-xs (a settings page)
 ├── Is it the main reading text of a screen or dialog? → text-body-xl
 ├── Is it a row in a list, or a card title? → text-body-l
 ├── Is it a chip, menu item or secondary row? → text-body-m
 ├── Is it a meta line, a label or a timestamp? → text-body-s
 └── Is it a chart tick or a badge? → text-body-xs
```

## Weight

`font-regular` (400), `font-medium` (500) and `font-heavy` (600). Nothing else
exists: `font-semibold`, `font-bold` and `font-[650]` are errors. Medium is
for titles, labels and buttons; heavy is for a figure that has to dominate
(a stat card's number). Body copy is always regular.

## Line and tracking

- `line-solid` (line height 1) centres a label in a fixed-height chip, bar or
  cell. `line-tight` (1.2) is the dense line of a figure row. Never use
  `leading-*`.
- Tracking: `tracking-xs` (-0.015em) for display sizes, and `tracking-xl`
  (0.02em) for uppercase labels. Don't set tracking on body text: every
  body step's tracking is 0.

## Fonts

| Class | Use for |
|---|---|
| `font-body` | everything (the default, so leave it unset) |
| `font-data` | code, IDs, hashes, paths, durations and numbers that line up in a column |

Use `font-data`, not `font-mono`: the data font is Geist Mono with Opaline's
weights. For numbers in proportional text that must not jitter while they
change, add `tabular-nums` and keep `font-body`.

```tsx
// Correct: a run ID next to its duration
<span className="font-data text-body-m text-ink-3">1ic31r</span>

// Incorrect: an invented size, a raw weight and the wrong mono
<span className="font-mono text-[11.5px] font-semibold">1ic31r</span>
```
