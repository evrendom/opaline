# Surfaces and overlays

```
Where does this content live?
 ├── Must the person decide before going on? → Dialog
 ├── A side panel of detail that keeps the page in view? → Sheet
 ├── A small form or settings attached to a control? → Popover
 ├── Actions on a thing (rename, delete, copy link)? → DropdownMenu
 ├── A one-line explanation on hover or focus? → Tooltip
 ├── A grouped block on the page? → Card
 ├── Rows of things (rules, members, runs)? → List
 ├── Figures with labels (a total, a count)? → StatGroup of Stat
 └── Nothing to show yet? → Empty
```

## Card

`src/app/ui/card.tsx`: `Card`, `CardHeader`, `CardTitle`, `CardDescription`
and `CardContent`. Sizes are `md` (24px padding, the default: prose,
explanations) and `sm` (12px padding: a card that holds a List, figures or
form rows). Never build a card by hand from
`bg-surface … shadow-card` on a `div`: that's a Card.

```tsx
// Correct
<Card size="sm">
  <CardContent>
    <List>{rows}</List>
  </CardContent>
</Card>

// Incorrect: a hand-built shell, and padding on the primitive
<div className="corner-l bg-surface p-l shadow-card">…</div>
<Card className="p-xxl">…</Card>
```

Lay out a card's children on a child element, never on `CardContent` itself.
Rows inside a card are a `List`; figures are a `StatGroup`. A form in a card
ends with its actions right-aligned after the last row (`flex justify-end
gap-m` on a child); Save stays disabled until something changes, and a
successful save confirms with a toast (`toast.success("Saved")` from
`sonner`).

The settings pages have their own group (`WorkspaceSettingsGroup` and the
`settings-*` classes in `patterns.css`). Use it on a settings page only;
anywhere else, a group of settings is a Card of `List` rows.

## List

`src/app/ui/list.tsx`: `List` and `ListItem`. Rows of things with a hairline
between them: rules, members, runs. A `ListItem` is a 12px-padded flex row
with a 12px gap; its className may only place it, so lay out what's inside
(a name over its meta, a Badge, a label-left/control-right setting) on its
children, and put a row menu at the end with `ml-auto`. A row's icon
button is `size="icon"`.

```tsx
// Correct
<List>
  {rules.map((rule) => (
    <ListItem key={rule.id}>
      <div className="flex min-w-0 flex-1 flex-col gap-xxs">
        <span className="text-body-l font-medium">{rule.name}</span>
        <span className="text-body-s text-ink-3">{rule.schedule}</span>
      </div>
      <Badge variant="success">Active</Badge>
    </ListItem>
  ))}
</List>

// Incorrect: hand-drawn dividers
<ul className="divide-y divide-line">…</ul>
```

## Stat

`src/app/ui/stat.tsx`: `StatGroup` and `Stat`. A figure with its label: a
total, a count, a cost. `Stat` takes `label`, `value` and an optional `unit`;
a `null` value shows `—` in ink-3. Put several in a `StatGroup`, which lays
them out in a wrapping row.

```tsx
<StatGroup>
  <Stat label="Sessions" value="1,204" />
  <Stat label="Cost" value="$84" unit="this week" />
  <Stat label="Cache hit" value={null} />
</StatGroup>
```

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
icon: by default the menu is as wide as its trigger. The trigger is a Button
through `render`: `<DropdownMenuTrigger render={<Button size="icon"
aria-label="Run actions" />}>`. An item that navigates renders a Link:
`<DropdownMenuItem render={<Link to={href} />}>Open</DropdownMenuItem>`.

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

## Tag

`src/app/ui/tag.tsx`. A small, square-cornered label on a thing in a row: the
tool, file or subagent a step touched, a count of something it holds, "Plan",
"MCP". A row's model, tokens and time are meta text, not tags.

```
Badge or Tag?
 ├── Is it the status of the thing (Failed, Shared, Up to date)? → Badge
 └── Is it what the thing is, touches or contains (a tool, a file, a count)? → Tag
```

`tone` is `neutral` (the default), `success`, `warning` or `error`, and a tone
only ever means state (a frustrated turn is `error`, a positive one
`success`). `size` is `sm` (18px, the default: a session row, a waterfall) or
`md` (20px: beside body text, a trace step). An icon goes first as a child;
it's sized and coloured for you. Never build a tag from a `span` with
`corner-xs` and a fill: that's a Tag.

```tsx
// Correct
<Tag><IconTool aria-hidden="true" />Edit</Tag>
<Tag tone="error">3 frustrated</Tag>

// Incorrect: a hand-built tag
<span className="corner-xs bg-field px-s text-body-xs text-ink-3">Plan</span>
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
