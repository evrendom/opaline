# Icons

Every icon comes from `@tabler/icons-react`. Never add another icon library:
lint rejects `lucide-react`.

## Outline or filled

```
Which icon style?
 ├── Is it navigation or identity (sidebar and settings nav, reader tabs, a small category mark in a chart, legend or label)? → the *Filled icon
 └── Default: an action, control, row or inline glyph → the outline icon
```

## Size

| Class | Where |
|---|---|
| `size-3.5` (14) | buttons, toolbar pills, inputs; the default |
| `size-3` (12) | badges, dense rows, `icon-sm` buttons |
| `size-4` (16) | menu and select items, emphasis |

Primitives size their own icons. Never size an icon inside a `Button`,
`Badge`, menu item or select item, and never put a margin on it: the
primitive spaces its children with its own gap.

An icon-only `Button` needs an `aria-label`. A decorative icon next to a
label takes `aria-hidden="true"`.

```tsx
// Correct
<Button size="icon" aria-label="Copy run ID"><IconCopy /></Button>

// Incorrect: sized inside a Button, with a margin, and no label
<Button size="icon"><IconCopy className="mr-xs size-5" /></Button>
```
