# Exceptions: data paint, artwork, platform

A scale can't hold everything. Five kinds of value are allowed outside the
roles, and nothing else:

| Kind | Examples |
|---|---|
| **data paint** | chart series, syntax colours, diff marks, a model's or tool's brand colour, heat gradients |
| **artwork** | the opal sheen, the star card's split-flap, glows, the dark favicon |
| **platform** | the macOS window glass and vibrancy, traffic-light offsets |
| **native** | a hidden file input, the range input behind a slider: native elements with no primitive |
| **third-party** | the plugin widget restyling the app for its host page |

A value the app happened to ship is never an exception. Snap it to the
nearest role or step.

## How to mark one

Put a per-rule marker on the line above, with the reason starting with its
kind:

```tsx
// design-escape-ok(colour): data paint; the trace lanes' hues
<rect className="fill-[oklch(0.68_0.16_151)]" />

// design-escape-ok(dark): artwork; the opal chip's glow differs per mode
"dark:drop-shadow-none"
```

A marker exempts only the rules it names, on its own line and the next. The
check refuses a marker whose reason starts with "shipped value" or "no role
renders this", and a marker that exempts nothing. Markers are capped by
`markers` in the baseline, so a new one has to replace an old one.

A file that is all data paint (a chart palette, a syntax theme) goes in
`DATA_PAINT` in `tools/design-escapes.ts` with the rules it lifts and why,
instead of a marker on every line.

## Opal colours

`opal-1` to `opal-5` and their `-tint`s are the Opaline sheen: the nav icons,
the category chips and data marks. Use them only for data and artwork, never
for a button, a text colour or a state.
