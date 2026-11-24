# Colours

Every colour is a role from `src/app/tokens.css`, used as a Tailwind class
(`bg-surface`, `text-ink-3`, `border-line`, `ring-accent-line`) or as
`var(--surface)` in CSS. The roles below are the complete set: nothing else
exists. An opacity modifier on a role (`text-ink/70`, `bg-error/10`) is an
error, because there are no shades.

## Grounds

| Role | What it is |
|---|---|
| `canvas` | the window's content: the page itself |
| `surface` | cards, panels and controls on the page |
| `overlay` | anything floating above the page: menus, popovers, select lists, tooltips, hover cards, dialogs, sheets (the components set it). Equal to `surface` in light, a step lighter in dark, where a shadow can't lift it |
| `inset` | a recessed area on the canvas: wells, code, rails |
| `field` | chips, tags, segmented tracks, a selected row in a list |
| `hover` | a row under the pointer, and any soft tint (marks, stripes) |
| `hover-strong` | pressed, open or selected, and any firmer tint |
| `control` | the ground of a text field or select (the primitives set it) |
| `scrim` | behind a dialog or sheet; it darkens in both modes |
| `chrome` | the frame behind the content window (the shell sets it) |

```
What background do I use?
 ├── Is it behind a modal? → scrim (Dialog and Sheet already do it)
 ├── Does it float above the page (a menu, popover, tooltip, hover card,
 │   dialog or sheet)? → overlay (the components already do it)
 ├── Is it a card or a panel on the page? → surface (Card already does it)
 ├── Is it sunk into the page: a code block, a well, a rail? → inset
 ├── Is it a chip, tag, track or a selected row? → field
 ├── Is it a hover, or a soft tint on a mark? → hover
 ├── Is it pressed, open or a firm tint? → hover-strong
 └── Default: the page itself → canvas (leave the background unset)
```

## Ink

| Role | Use for |
|---|---|
| `ink` | titles, body text, values, numbers |
| `ink-2` | secondary prose in a reading flow: a lead paragraph, a quoted reply |
| `ink-3` | a description under a title (CardDescription sets it), meta, labels, icons, column headers, timestamps |
| `ink-4` | the quietest: disabled text, placeholders, separators, ticks, faint meta |
| `ink-inverse` | text on a `primary` fill |
| `ink-chrome` | the window chrome's quiet icons and labels (the shell only) |

```
What text colour do I use?
 ├── Is it disabled, a placeholder, a separator (· /) or an axis tick? → ink-4
 ├── Is it a description under a title, or meta: a label, timestamp, count,
 │   icon or column header? → ink-3
 ├── Is it secondary prose in a reading flow (a lead, a quote)? → ink-2
 └── Default → ink (leave it unset: text inherits ink)
```

Pick a grey by how light it renders, never by percentage. Ink at 50% renders
near `ink-3`, and `ink-3` at 70% renders near `ink-4`.

## Lines

| Role | Use for |
|---|---|
| `line` | hairlines, dividers, input and table edges, rails |
| `line-soft` | chart grids, quiet dividers inside a card |

Prefer white space, then a line, then a card. A border around something
that's already a card is a double edge: never add one.

## Action and state

| Role | Use for |
|---|---|
| `primary`, `primary-hover`, `primary-fg` | owned by Button; never set them by hand |
| `focus`, `focus-ring` | owned by the primitives (`focus-outline`, field rings) |
| `accent`, `accent-tint`, `accent-line`, `accent-fg` | Opaline blue: links, the selection, info, a chart's main series |
| `success`, `success-tint`, `success-line` | done, passed, merged, positive |
| `warning`, `warning-tint`, `warning-line` | needs attention, interrupted, near a limit |
| `error`, `error-tint`, `error-line` | failed, invalid, destructive, negative |

Each state has the same three strengths: text and icons in the base role, a
fill in `-tint`, and an edge or ring in `-line`. Colour means state. Never
colour something just to make it stand out: a neutral screen with one state
colour reads; a colourful one doesn't.

A status on a pill is a `Badge` with a tone (see [surfaces.md](surfaces.md)).
For state colour anywhere else (an icon, a line of text, a chart mark), use
the roles directly:

```tsx
// Correct: an error line under a field
<p className="text-body-m text-error">{message}</p>

// Incorrect: a palette class and an opacity
<p className="text-rose-600/90">{message}</p>
```

## Never

- A hex, `rgb()`, `oklch()` or `color-mix()` in a class string or a style
  prop. If a colour isn't here, it isn't in the system.
- `dark:` in a component. The roles flip with the mode.
- A Layer 1 name (`neutral-7`, `color-1`, `opal-3`) outside data paint (see
  [exceptions.md](exceptions.md)).
