# Forms

One component per HTML element. Never create a type-specific control
(`EmailInput`, `PasswordField`, `SearchInput`): the type is a prop. A raw
`<input>`, `<select>` or `<textarea>` in a screen is an error.

```
Which control?
 ├── Pick one of 2 to 5 options that should all stay in view? → RadioGroup
 ├── Pick one of a longer list, or a secondary choice? → Select
 ├── A date range? → AnalyticsDateRangePicker (never Input type="date")
 ├── On / off for one thing? → Checkbox
 ├── More than one line of text? → Textarea
 ├── One line of text with an icon or a button inside the field (search, copy)? → InputGroup
 └── One line of text, any type (text, email, password, search, number)? → Input
```

## Input

`src/app/ui/input.tsx`. A 36px field on the `control` ground and shadow, with
the placeholder in `ink-4` and a `readOnly` value in `ink-3`.

Variants: `default` and `plain`. Nothing else exists.
- `default` is everywhere: settings, sign-in, forms.
- `plain` is the filled pill inside a dialog (the type-to-confirm field).

```tsx
// Correct: from DeleteWorkspaceDialog
<Field>
  <FieldLabel htmlFor="delete-workspace-confirm">Type {name} to confirm</FieldLabel>
  <Input variant="plain" id="delete-workspace-confirm" … />
</Field>

// Incorrect: a type-specific component and a restyle
<PasswordInput className="h-12 border-line bg-field" />
```

## Textarea

`src/app/ui/textarea.tsx`. The same field as Input, multi-line, growing with
its content from 80px. Use it for notes, descriptions and messages.

## Select

`src/app/ui/select.tsx`: `Select`, `SelectTrigger`, `SelectValue`,
`SelectContent` and `SelectItem`. Trigger sizes are `sm` (32px) and `md`
(36px, the default). Use `sm` inside a table row.

```tsx
// Correct: from WorkspaceMembersTable
<SelectTrigger size="sm" aria-label={`Role for ${member.user.name}`}>
  <SelectValue />
</SelectTrigger>
```

## RadioGroup

`src/app/ui/radio-group.tsx`: `RadioGroup` and `RadioGroupItem`. Each item
carries its own visible label as its children. The group takes `value` and
`onValueChange` (or `defaultValue`) and an `aria-label` or
`aria-labelledby`. `orientation` is `vertical` (the default) or
`horizontal` (two or three short options on one line). Its visible label is
a `FieldLabel` with an `id`, and the group points at it with
`aria-labelledby`. Never build a choice
from a row of Pressables or toggled Buttons: that's a RadioGroup.

```tsx
// Correct
<RadioGroup value={range} onValueChange={setRange} orientation="horizontal" aria-label="Range">
  <RadioGroupItem value="7d">7 days</RadioGroupItem>
  <RadioGroupItem value="30d">30 days</RadioGroupItem>
</RadioGroup>

// Incorrect: a hand-built segmented choice
<div className="flex">{options.map((o) => <Button aria-pressed={o === range} …>{o}</Button>)}</div>
```

## Date range

`src/features/analytics/date-range/components/AnalyticsDateRangePicker.tsx`:
a trigger that opens the range calendar in a Popover. It takes `startDate`,
`endDate` (as `yyyy-MM-dd`) and `onDateRangeApply`. Presets like "Last 7
days" sit beside it as a RadioGroup or a Select. There is no single-date
picker yet: if a screen needs one, say so in your report.

## Checkbox

`src/app/ui/checkbox.tsx`. Always give it a visible `<Label>` or an
`aria-label`. For an action that applies at once, use a Checkbox in a row,
not a Button toggle.

## InputGroup

`src/app/ui/input-group.tsx`: `InputGroup`, `InputGroupAddon`,
`InputGroupInput` and `InputGroupButton`. It's a field with an icon or a
button inside it.
- `InputGroupButton` sizes are `sm`, `md`, `icon-sm` and `icon`. Its variant
  is a Button variant, defaulting to `secondary`.
- `variant="toolbar"` on InputGroup is the page toolbar's search pill.

```tsx
// Correct: from RepositorySearchField
<InputGroup>
  <InputGroupAddon><IconSearch aria-hidden="true" /></InputGroupAddon>
  <InputGroupInput type="search" name={name} placeholder="Search repositories" />
</InputGroup>
```

## Field and Label

`Field` (orientations `vertical`, the default, `horizontal` and
`responsive`) stacks a `FieldLabel` with its control. Use `Label` for a
checkbox's label. Every control has a label, either visible or as an
`aria-label`: a placeholder is not a label. A group of checkboxes sits in a
`<fieldset>` with `aria-labelledby` pointing at its `FieldLabel`'s `id`, the
same as a RadioGroup. Mark an optional field with
"Optional" after its label, in `font-regular text-ink-3`; never mark the
required ones.

## Validation

Set `aria-invalid` on the control. The primitives draw the error edge and
ring themselves; never colour a field red by hand. Put the message under the
field in `text-body-m text-error`.
