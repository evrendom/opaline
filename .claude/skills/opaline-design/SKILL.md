---
name: opaline-design
description: Build and extend Opaline's Mac app screens with the Opaline design system. Use whenever you add or change UI in apps/desktop/ui: a screen, a card, a row, a menu, a control, a colour, a state.
---

# Opaline design skill

The design system is documented in `apps/desktop/ui/design/`. **Read
`design/README.md` first, every time**, then only the topic files the task
needs:

- `colors.md`
- `typography.md`
- `space-and-shape.md`
- `buttons.md`
- `forms.md`
- `surfaces.md`
- `icons.md`
- `exceptions.md`

Those files are the rules. This skill only covers how to work.

## Building a screen

1. Pick components from `src/app/ui/`, using the decision trees in the
   topic files. Leave `Button`'s `variant` off unless the button is the one
   main action (`primary`), destructive (`danger`) or inside a sentence
   (`link`).
2. Colour, type, space, corners and shadows come only from the roles and
   steps. Never write a value, an opacity on a role, or `dark:`.
3. `className` on a primitive only places it (margin, size, flex and grid
   placement, position).
4. Run `bun run check:design` (from `apps/desktop/ui`) before you finish. A
   failure means the code is off the system: fix the code. Add a marker only
   for the five kinds in `exceptions.md`.
5. Look at the screen in light and dark.

## When the system doesn't have what you need

Use the nearest role, step or variant and finish the screen. Then say so in
your report: "needed X for Y; used Z". Don't add a role, step, variant or
pattern on your own. A new option is a system change: it goes in
`theme.css`, `tokens.css` or `src/app/ui/`, on the showcase
(`/dev/design-system`) and in the matching `design/` file, all in one change.

## Levers

A design change is made once, in `theme.css` (a step, a ramp) or `tokens.css`
(a role's value), never at a call site. Check it on `/dev/design-system` in
both modes.
