# Buttons and clickable things

Three ways to make something clickable, and exactly one is right:

```
What is it?
 ├── Does it go to another page or route? → <Link> (render a Button through it only if it must look like one)
 ├── Is it an action, a toggle or an icon button? → <Button>
 └── Is a whole row, tile, bar, chip or disclosure clickable? → <Pressable>
```

A raw `<button>` in a screen is an error.

## Button

`src/app/ui/button.tsx`. Use it for every action and toggle.

Variants: `primary`, `secondary`, `danger` and `link`. Nothing else exists:
`default`, `outline`, `ghost`, `quiet`, `destructive` and `toolbar` are
gone, and an unlisted variant is a type error.

- `secondary` is **the default**, so leave `variant` off. Use it for Cancel,
  Retry, Copy, row actions, close and remove icons, and toggles.
- `primary` is the screen's single main action: Save, Connect, Apply, Sign in,
  Create. **One per view**: two primaries means the screen has no hierarchy.
  It's also the toolbar's pills (date range, Sorted by, Filter), with
  `aria-pressed`, `data-active` or `data-popup-open` for their states.
- `danger` is for destructive or hard-to-undo actions only: Delete, Disconnect,
  Revoke.
- `link` is for an action inside a sentence ("Couldn't load. Try again"),
  with `size="inline"`.

```
Which variant?
 ├── Is it destructive, or hard to undo? → variant="danger"
 ├── Is it inside a sentence? → variant="link" size="inline"
 ├── Is it the one main action of this view, or a toolbar pill? → variant="primary"
 └── Default → leave variant off (secondary)
```

Sizes: `sm` (24px), `md` (32px, the default), `lg` (36px), `icon-sm`
(24px square), `icon` (32px square) and `inline`. Use `lg` for a dialog's
footer and sign-in. An icon-only button needs an `aria-label`.

```tsx
// Correct: a dialog footer, from DeleteWorkspaceDialog
<Button onClick={onClose}>Cancel</Button>
<Button variant="danger" size="lg" onClick={confirm}>Delete workspace</Button>

// Incorrect: an invented variant, a primary for Cancel, and a restyle
<Button variant="ghost">Cancel</Button>
<Button variant="primary">Cancel</Button>
<Button className="bg-error text-white">Delete</Button>
```

A button that navigates renders the link and stays a Button:

```tsx
<Button variant="primary" nativeButton={false} render={<Link to={href} />}>
  Open dashboard
</Button>
```

## Pressable

`src/app/ui/pressable.tsx`. Use it for a whole clickable surface: a list row,
a tile, a chart bar, a crumb, a disclosure, a legend item. It brings the
button semantics, the keyboard focus mark and the disabled state, but has no
look. Its `className` is free, and the row or tile owns its look there.

**Anything shaped like a button is a `Button`, never a `Pressable`.** If you
find yourself giving a Pressable padding, a pill corner and a fill, it's a
Button.

```tsx
// Correct: a clickable list row
<Pressable onClick={() => open(run.id)} className="flex w-full items-center gap-m px-l py-m hover:bg-hover">
  …
</Pressable>

// Incorrect: a button look built on Pressable
<Pressable className="corner-full bg-surface px-l shadow-card">Save</Pressable>
```

## text-button (pattern)

`.text-button` in `src/app/patterns.css` is plain text that firms on hover.
It's only for elements that must render their own tag and can't be a
`Button`: a row of text tabs (`role="tab"`), a `<Link>` that reads as an
action, or a menu or popover trigger (`PopoverTrigger`, `Menu.Trigger`). If
the element can be a `<Button>`, it is one.
