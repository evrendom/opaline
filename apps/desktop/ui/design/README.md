# Opaline design system

Opaline is a quiet, neutral Mac app: near-black or near-white ink on soft
greys, colour only for state and data, and one accent blue. Every visual
decision is already made in a role, a step or a component. Screens pick from
those closed sets and never improvise.

Read this file before building any screen. Then read only the topic files the
task needs.

## The three rules that matter most

1. **Roles, never values.** Colours, shadows, type, space and corners come
   from the roles and steps in `src/app/tokens.css` and `src/app/theme.css`.
   Never write a hex, `rgb()`, `oklch()`, a Tailwind palette class
   (`text-gray-500`, `bg-rose-500`), a pixel size (`text-[13px]`,
   `p-[10px]`) or an opacity on a role (`text-ink/70`). There are no shades.
   If no role fits, use the nearest one.
2. **Components, never raw elements.** Screens build from `src/app/ui/`.
   Never write `<button>`, `<input>`, `<select>` or `<textarea>` in a screen:
   use `Button`, `Pressable`, `Input`, `Textarea`, `Select` or `Checkbox`.
3. **Primitives own their look.** `className` on a primitive may only place it:
   margin, width and height, flex and grid placement, position and display.
   Never pass a colour, background, border, shadow, corner, padding, type or
   internal gap. If the look you need doesn't exist, use the nearest variant.
   Don't add a variant for one screen: every variant you add is another
   choice for the next screen to get wrong.

Dark mode is free. The roles flip with the mode, so a screen never writes
`dark:`. If something looks wrong in dark, a role is missing: ask, don't
patch it.

## Layers

```
src/app/theme.css    primitives and steps: the neutral ramp, the opal palette,
                     success/warning/error, type, space, corners, motion
src/app/tokens.css   roles: what screens read (bg-surface, text-ink-3, …)
src/app/patterns.css recurring structures as classes (menus, settings rows)
src/app/ui/          the primitive components
```

Screens read **roles only**. A Layer 1 name (`neutral-7`, `color-1`) in a
screen is an error.

## Topics

| File | Read it when you |
|---|---|
| [colors.md](colors.md) | pick a background, text colour, line or state colour |
| [typography.md](typography.md) | set text: size, weight, line, tracking, font |
| [space-and-shape.md](space-and-shape.md) | set padding, gap, corners, elevation or motion |
| [buttons.md](buttons.md) | add anything clickable |
| [forms.md](forms.md) | add a field, select, checkbox or search box |
| [surfaces.md](surfaces.md) | add a card, dialog, sheet, popover, tooltip, menu, badge, avatar, empty state or skeleton |
| [icons.md](icons.md) | add or size an icon |
| [exceptions.md](exceptions.md) | need data paint (a chart, syntax colour, brand colour) or artwork |

## The check

`bun run check:design` (CI runs it) fails the build on any escape from these
rules. Its rules are type, space, radius, colour, shadow, opacity, motion,
base, dark, element and restyle, plus marker for bad exemptions. The baseline
in `tools/design-escapes.baseline.json` holds every rule at zero except a
known 15 `restyle` selectors in `patterns.css`. When the check fails, fix the
code. Don't add a marker: markers are only for the cases in
[exceptions.md](exceptions.md).

A dev showcase of every role, step and primitive lives at `/dev/design-system`
(`src/app/system/`).
