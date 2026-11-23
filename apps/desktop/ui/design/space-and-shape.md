# Space, corners, elevation, motion

## Space

Padding, margin and gap take a step: `p-m`, `gap-l`, `mt-xs`, `space-y-s`.

| Step | `zero` | `xxs` | `xs` | `s` | `m` | `l` | `xl` | `xxl` | `xxxl` |
|---|---|---|---|---|---|---|---|---|---|
| px | 0 | 2 | 4 | 6 | 8 | 12 | 16 | 24 | 32 |

Tailwind's number scale (`p-3`, `gap-2.5`), pixel values (`p-[10px]`) and
`calc()` multiples of steps (`p-[calc(var(--space-xs)*5)]`) are errors.
There's no 10px or 20px step: use 8 or 12, and 16 or 24. On a tie, pick the
one that keeps the element aligned with its neighbours.

A `calc()` that adds a step to a runtime measure is layout, and allowed, for
example an indent `pl-[calc(var(--depth)*var(--space-m))]` or the safe area
`env(safe-area-inset-bottom)`.

```
How much space?
 ├── Inside a chip or tag, or between an icon and its label? → xs (4) or s (6)
 ├── Between rows in a dense list, or inside a control? → m (8)
 ├── Between items in a group, or a card's inner padding (sm)? → l (12) or xl (16)
 ├── Between groups or sections? → xxl (24)
 └── Page padding, or between major regions? → xxxl (32)
```

Width and height (`w-*`, `h-*`, `size-*`) use Tailwind's scale. They're
layout, not space.

A page of rows, forms or prose reads in a centred column,
`mx-auto w-full max-w-3xl px-xxl py-xxxl`, as ReportPage does, with its
sections `gap-xxl` apart. A page of charts or tables fills the width.

## Corners

`corner-zero`, `corner-xs` (6), `corner-s` (8), `corner-m` (10), `corner-l`
(14), `corner-xl` (22) and `corner-full`. Every `rounded-*` class is an
error.

- Surfaces use the squircle: `corner-l squircle:corner-xl corner-squircle`
  (Card already does it).
- A child drawn inside a surface keeps the curve concentric with
  `corner-*-inset`, `corner-xl-inner` or `corner-xl-outer`.
- Pills, avatars and buttons use `corner-full`.

## Elevation

| Class | Use for |
|---|---|
| `shadow-card` | anything resting on a ground: cards, panels, chips, pills |
| `shadow-raised` | pressed or picked: an active toolbar pill, a selected row |
| `shadow-control` | text fields and selects (the primitives set it) |
| `shadow-inset` | the inner hairline of a well |
| `shadow-float` | free-floating: a toast, a floating button, a scrub label. Pair it with `ring-1 ring-line` (dark keeps only the ring) |

The shadow is the border: a card has `shadow-card` and no `border`. Literal
shadows (`shadow-[…]`) and Tailwind's sizes (`shadow-sm`, `shadow-lg`) are
errors.

## Motion

| Duration | Use for |
|---|---|
| `duration-(--motion-quick-duration)` 100ms | hover tints, a check appearing, flyouts |
| `duration-(--motion-duration)` 150ms | small changes: the default |
| `duration-(--motion-medium-duration)` 200ms | fades, sheets, a panel's width |
| `duration-(--motion-large-duration)` 300ms | large changes |
| `duration-(--motion-slow-duration)` 650ms | a chart drawing in, a skeleton leaving |

The easings are `ease-base` (default), `ease-large`, `ease-strong` (presses,
things entering), `ease-drawer` (drawers, rails) and `ease-wave` (loops). A
numeric duration (`duration-200`) or a raw `ease-in-out` is an error.
Durations of 1s or more are loop periods and are allowed.
