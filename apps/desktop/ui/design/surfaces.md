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
`danger` is for destructive items only, placed last after a separator.

## Tooltip

`src/app/ui/tooltip.tsx`: `Tooltip`, `TooltipTrigger` and `TooltipContent`.
`side` defaults to `top`. A tooltip holds one short line and never holds the
only copy of essential information: what a person must know stays on the
page.

## Badge

`src/app/ui/badge.tsx`. Variants are `secondary` (a field chip, the default)
and `outline` (a card-shadow chip). Use it for a status word ("Shared",
"Owner"). For a state colour, use a span with the state roles
(`bg-success-tint text-success`); see [colors.md](colors.md).

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
