# Surfaces and overlays

```
Where does this content live?
 ├── Must the person decide before going on? → Dialog
 ├── A side panel of detail that keeps the page in view? → Sheet
 ├── A small form or settings attached to a control? → Popover
 ├── Actions on a thing (rename, delete, copy link)? → DropdownMenu
 ├── A one-line explanation on hover or focus? → Tooltip
 ├── A grouped block on the page? → Card
 └── Nothing to show yet? → Empty
```

## Card

`src/app/ui/card.tsx`: `Card`, `CardHeader`, `CardTitle`, `CardDescription`
and `CardContent`. Sizes are `md` (24px padding, the default) and `sm` (12px
padding, settings groups). Never build a card by hand from
`bg-surface … shadow-card` on a `div`: that's a Card.

```tsx
// Correct: from workspace-settings-group
<Card size="sm">
  <CardContent>
    <div className="settings-group-rows">{children}</div>
  </CardContent>
</Card>

// Incorrect: a hand-built shell, and padding on the primitive
<div className="corner-l bg-surface p-l shadow-card">…</div>
<Card className="p-xxl">…</Card>
```

Lay out a card's children on a child element, never on `CardContent` itself.
A list of rows inside a card is a child `ul` with `settings-group-rows`: it
draws the hairline between rows. Each row is `flex items-center gap-l py-l`.

## Dialog

`src/app/ui/dialog.tsx`: `Dialog`, `DialogContent`, `DialogHeader`,
`DialogTitle`, `DialogDescription` and `DialogFooter`. It always has a
`DialogTitle`, and `showCloseButton` defaults to true. The footer holds at
most one `primary` (or one `danger`), plus a `secondary` Cancel, all
`size="lg"`.

## Sheet

`src/app/ui/sheet.tsx`. `side` is `right` (the default), `left`, `top` or
`bottom`. Use `right` for detail panels.

## Popover

`src/app/ui/popover.tsx`: `Popover`, `PopoverTrigger`, `PopoverContent` and
`PopoverTitle`. Set the width on `PopoverContent` (`className="w-[23rem]"` is
placement, which is allowed); the surface, padding and shadow are its own.

## DropdownMenu

`src/app/ui/dropdown-menu.tsx`: `DropdownMenu`, `DropdownMenuTrigger`,
`DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem` and
`DropdownMenuSeparator`. An item's variant is `default` or `danger`, and
`danger` is for destructive items only, placed last after a separator. A
delete that can't be undone opens a Dialog to confirm (a `danger` button and
a `secondary` Cancel); one that can be undone just happens, with a toast. Set
a width on `DropdownMenuContent` (`className="w-40"`) when the trigger is an
icon: by default the menu is as wide as its trigger.

## Tooltip

`src/app/ui/tooltip.tsx`: `Tooltip`, `TooltipTrigger` and `TooltipContent`.
`side` defaults to `top`. A tooltip holds one short line and never holds the
only copy of essential information: what a person must know stays on the
page.

## Badge

`src/app/ui/badge.tsx`. Use it for every status word on a pill: "Shared",
"Owner", "Up to date", "Failed". Never hand-build a status chip from a
`span` with a pill corner and a tint: that's a Badge.

Variants are `neutral`, `outline`, `success`, `warning` and `error`. Nothing
else exists.

```
Which tone?
 ├── Did it fail, or is it invalid or destructive? → variant="error"
 ├── Does it need attention, or was it interrupted by a fault? → variant="warning"
 ├── Is it paused, off or a draft on purpose? → neutral (no colour: nothing's wrong)
 ├── Is it done, passed or healthy? → variant="success"
 ├── Is it a secondary label on a card (Private, Draft)? → variant="outline"
 └── Default, including in progress (add a spinner icon) → leave variant off (neutral)
```

```tsx
// Correct
<Badge variant="error"><IconAlertTriangle aria-hidden="true" />Failed</Badge>
<Badge><IconLoader2 aria-hidden="true" className="animate-spin" />Syncing</Badge>

// Incorrect: a hand-built status chip
<span className="corner-full bg-error-tint px-m text-error">Failed</span>
```

## Avatar

`src/app/ui/avatar.tsx`: `Avatar`, `AvatarImage`, `AvatarFallback`,
`AvatarGroup` and `AvatarGroupCount`. Sizes are `md` (32px, the default) and
`sm` (24px, inside a table row).

## Empty

`src/app/ui/empty.tsx`: `Empty`, `EmptyHeader`, `EmptyMedia` (variants
`default` and `icon`), `EmptyTitle`, `EmptyDescription` and `EmptyContent`.
Use it when a list or panel has nothing to show. Say what's missing and what
to do next, in one line each.

## Skeleton

`src/app/ui/skeleton.tsx`. A bone takes the shape of what it stands in for,
so its `className` may set size and corner. Match the real element's size,
so the layout doesn't jump when data arrives.

## Separator and Table

`Separator` is a `line` hairline. `Table`, `TableHeader`, `TableBody`,
`TableRow`, `TableHead` and `TableCell` make a data table: column headers in
`text-body-m text-ink-3`, cells in `text-body-m`.
