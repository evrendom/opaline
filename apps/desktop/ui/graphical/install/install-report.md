# Graphical install

Rewrote 312 source files and wrote the project files in `graphical`.

## Use sites

| Family | Rewritten | Removed | Skipped | Tokens | Kept | Preserved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| border-width | 248 | 0 | 1 | 0 | 0 | 47 |
| color | 525 | 0 | 1 | 461 | 119 | 1,558 |
| font-family | 119 | 0 | 0 | 0 | 0 | 41 |
| font-size | 751 | 0 | 0 | 0 | 3 | 83 |
| font-weight | 181 | 0 | 0 | 181 | 0 | 19 |
| letter-spacing | 219 | 19 | 0 | 0 | 11 | 6 |
| line-height | 176 | 70 | 0 | 0 | 19 | 79 |
| radius | 736 | 0 | 0 | 1 | 0 | 86 |
| shadow | 0 | 0 | 0 | 27 | 58 | 67 |
| spacing | 2,850 | 0 | 0 | 0 | 0 | 128 |
| token | 386 | 0 | 0 | 0 | 0 | 0 |

Removed: line heights and tracking a text style carries instead. Tokens: uses of the app’s own tokens, such as `bg-background`, which follow the token once it aliases a Graphical one, and classes that already have Graphical’s name, such as `font-medium`. Kept: values the conversion keeps as authored. Preserved: values the analysis preserved, such as content colors, artwork, state recipes and dynamic values.

## Units

| Family | Values | Units | Multiples | Kept |
| --- | ---: | ---: | ---: | ---: |
| Colors | 232 | 18 | 0 | 0 |
| Text sizes | 30 | 10 | 0 | 2 |
| Font weights | 9 | 3 | 0 | 0 |
| Letter spacing | 15 | 4 | 0 | 8 |
| Spacing | 44 | 7 | 10 | 0 |
| Corners | 21 | 5 | 0 | 0 |
| Borders | 9 | 3 | 0 | 0 |
| Shadows | 39 | 3 | 0 | 24 |

## Style coverage

- `src/app/ui/calendar.tsx:199`: Cannot resolve class helper getDefaultClassNames. Include its source or convert and review this class expression manually. Reviewed: react-day-picker's own default class names; no theme values.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:31`: The class source IconCircleDashed is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:36`: The class source IconCircleX is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:39`: The class source IconCircleDashed is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:42`: The class source IconCircleCheck is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:47`: The class source IconRepeat is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:52`: The class source IconCircleDashed is imported from outside the analyzed files. Include its source root or review its class mapping manually. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/reader-dom.ts:29`: Cannot resolve class helper Object.values. Include its source or convert and review this class expression manually. Reviewed: Layout state variants only; no theme values.
- `src/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips.tsx:268`: Class helper ciTone returns a dynamic value that cannot be safely traced. Convert and review this class expression manually. Reviewed: Waterfall bar and CI tones: data paint.
- `src/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips.tsx:337`: Class helper ciTone returns a dynamic value that cannot be safely traced. Convert and review this class expression manually. Reviewed: Waterfall bar and CI tones: data paint.
- `src/features/sessions/reader/rail/session-reader-turn-rail-row.tsx:360`: Class helper getCostShade returns a dynamic value that cannot be safely traced. Convert and review this class expression manually. Reviewed: Reads the cost heat scale: data paint.
- `src/app/ui/table.tsx:16`: Class value alignClass is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Column alignment classes only; no theme values.
- `src/app/ui/table.tsx:17`: Class value alignClass is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Column alignment classes only; no theme values.
- `src/app/ui/table.tsx:18`: Class value alignClass is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Column alignment classes only; no theme values.
- `src/components/conversation/CodeBlock.tsx:106`: Class value headerIcon is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Language brand colours on code headers: artwork.
- `src/components/pierre/diff-view.tsx:188`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:189`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:190`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:191`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:193`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:193`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:193`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:193`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:195`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:196`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:197`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/components/pierre/diff-view.tsx:198`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Diff addition and removal marks: content colours.
- `src/features/compass/run-lanes-model.ts:201`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/compass/run-lanes-model.ts:201`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/compass/run-lanes-model.ts:202`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/compass/run-lanes-model.ts:202`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/compass/run-lanes-model.ts:203`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/compass/run-lanes-model.ts:203`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Run lane colours: data paint.
- `src/features/repos/repo-reader/repo-page-kit.tsx:188`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/repos/repo-reader/repo-page-kit.tsx:189`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/repos/repo-reader/repo-page-kit.tsx:190`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/repos/repo-reader/repo-page-kit.tsx:191`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/repos/repo-reader/repo-page-kit.tsx:192`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/repos/repo-reader/repo-page-kit.tsx:193`: Class value CHIP_TONE is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Sentiment chip tones keyed by name and typed from the map; kept as authored for this import.
- `src/features/sessions/reader/model/session-reader-model.ts:245`: Class value getCostShade is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Cost heat scale, cheapest to priciest: data paint.
- `src/features/sessions/reader/model/session-reader-model.ts:246`: Class value getCostShade is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Cost heat scale, cheapest to priciest: data paint.
- `src/features/sessions/reader/model/session-reader-model.ts:247`: Class value getCostShade is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Cost heat scale, cheapest to priciest: data paint.
- `src/features/sessions/reader/model/session-reader-model.ts:248`: Class value getCostShade is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Cost heat scale, cheapest to priciest: data paint.
- `src/features/sessions/reader/model/session-reader-model.ts:249`: Class value getCostShade is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Cost heat scale, cheapest to priciest: data paint.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:30`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:35`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:39`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:41`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:46`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:51`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:32`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:37`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:39`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:43`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:48`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:53`: Class value look is also consumed as app data. Separate its class and data uses before conversion. Reviewed: CI outcome tones paired with their icons; kept as authored for this import.
- `src/features/shell/config/shell-routes.tsx:40`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:41`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:44`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:45`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:48`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:49`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:52`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:53`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:56`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/shell/config/shell-routes.tsx:57`: Class value sessionsTone is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Opal nav chip tones: brand artwork.
- `src/features/sessions/reader/detail/waterfall/session-reader-waterfall-step-row.tsx:117`: Class value className is also consumed as app data. Separate its class and data uses before conversion. Reviewed: Waterfall bar and CI tones: data paint.

## Font classes

- `font-sans` → `font-body`
- `font-mono` → `font-data`
- `font-heading` → `font-body`

## Skipped sites

### not-at-line (1)

The recorded text isn’t at its line: the source changed after analysis.

- `src/components/conversation/code-block.css:128` ` {color:color(display-p3 1 1 1)}` (color)

### no-class (1)

Graphical has no class for this utility.

- `src/features/sessions/reader/minimap/session-reader-minimap.tsx:45` `stroke-[6px]` (border-width; stroke widths have no Graphical class)

## Text style overrides

0 already present in source; 32 retained during this conversion.

These stay beside their text style, so the inspector shows each as an override of it.

- `src/app/system/NotFoundPage.tsx:12` `tracking-[0.18em]` on Body L: a value kept as authored
- `src/app/ui/dialog.tsx:115` `leading-none` on Body XL: leading that sets a box’s height
- `src/app/ui/label.tsx:11` `leading-none` on Body L: leading that sets a box’s height
- `src/app/ui/slider-range-input.css:151` `line-height: 1;` on Body L: leading that sets a box’s height
- `src/components/conversation/code-block.css:216` `line-height: 1;` on Body S: leading that sets a box’s height
- `src/components/conversation/conversation-trace-tree.tsx:1292` `leading-none` on Body XS: leading that sets a box’s height
- `src/components/conversation/conversation-trace-tree.tsx:1292` `tracking-[-0.08em]` on Body XS: a value kept as authored
- `src/features/auth/guest-app.css:89` `letter-spacing: 0.14em;` on Body M: a value kept as authored
- `src/features/auth/guest-app.css:194` `letter-spacing: 0.22em;` on Body XL: a value kept as authored
- `src/features/cli-onboarding/cli-onboarding.css:32` `letter-spacing: -0.035em;` on Display XS: a value kept as authored
- `src/features/cli-onboarding/welcome.css:323` `line-height: 1;` on Body XL: leading that sets a box’s height
- `src/features/compass/compass-run-lanes.tsx:505` `leading-none` on Body XS: leading that sets a box’s height
- `src/features/compass/compass-run-lanes.tsx:660` `leading-none` on Body XS: leading that sets a box’s height
- `src/features/compass/run-lanes-context.tsx:21` `leading-none` on Body XS: leading that sets a box’s height
- `src/features/costs/cost-dashboard.css:247` `line-height: 1;` on Body M: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:83` `letter-spacing: var(--tracking-xl);` on Body M: tracking more than a step from the style’s
- `src/features/dashboard/dashboard-theme.css:419` `letter-spacing: var(--tracking-xl);` on Body M: tracking more than a step from the style’s
- `src/features/dashboard/dashboard-theme.css:433` `line-height: 1;` on Display XS: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:435` `letter-spacing: -0.05em;` on Display XS: a value kept as authored
- `src/features/dashboard/dashboard-theme.css:515` `line-height: 1;` on Body M: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:695` `line-height: 1;` on Body L: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:696` `letter-spacing: var(--tracking-xl);` on Body L: tracking more than a step from the style’s
- `src/features/dashboard/dashboard-theme.css:730` `letter-spacing: var(--tracking-xl);` on Body L: tracking more than a step from the style’s
- `src/features/dashboard/dashboard-theme.css:761` `line-height: 1;` on Body L: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:798` `line-height: 1;` on Body L: leading that sets a box’s height
- `src/features/dashboard/dashboard-theme.css:799` `letter-spacing: var(--tracking-xl);` on Body L: tracking more than a step from the style’s
- `src/features/dashboard/dashboard-theme.css:882` `line-height: 1;` on Body L: leading that sets a box’s height
- `src/features/self-hosted/self-hosted.css:115` `letter-spacing: var(--tracking-xl);` on Body M: tracking more than a step from the style’s
- `src/features/sessions/reader/ci/session-reader-ci-rounds-view.tsx:120` `leading-none` on Body S: leading that sets a box’s height
- `src/features/sessions/reader/files/session-reader-run-trace.tsx:290` `leading-none` on Body S: leading that sets a box’s height
- `src/features/skills/components/skill-cards.tsx:147` `leading-none` on Display L: leading that sets a box’s height
- `src/features/team/TeamInviteAcceptPage.tsx:103` `tracking-[0.24em]` on Body M: a value kept as authored

## Cleanup

Install grouped 182 long class lists by layout, box, type and appearance, then states.

## Spacing multiples

Spacing past the largest step is written as a multiple of it. Name the large ones in a few places for what they are, such as `--page-gutter` or `--toolbar-clearance`: a custom property in a CSS rule beside the layout, with its responsive values, that the layout reads through `var(--page-gutter)`. A multiple used widely is ordinary spacing the scale doesn’t reach: raise it rather than naming it. Steps such as `gap-m` and `px-l` stay as classes.

| Multiple | Value | Uses | Files | Most used as |
| --- | ---: | ---: | ---: | --- |
| XXL × 4/3 | 32px | 82 | 52 | `pr-[calc(var(--space-xxl)*4/3)]` (14), `gap-[calc(var(--space-xxl)*4/3)]` (12), `pb-[calc(var(--space-xxl)*4/3)]` (11), `px-[calc(var(--space-xxl)*4/3)]` (10) |
| XXL × 1.5 | 36px | 19 | 13 | `pl-[calc(var(--space-xxl)*1.5)]` (11), `-ml-[calc(var(--space-xxl)*1.5)]` (3), `[&_th:last-child]:pr-[calc(var(--space-xxl)*1.5)]` (1), `[&_td:last-child]:pr-[calc(var(--space-xxl)*1.5)]` (1) |
| XXL × 5/3 | 40px | 14 | 14 | `py-[calc(var(--space-xxl)*5/3)]` (6), `gap: calc(var(--space-xxl) * 5 / 3)` (5), `padding-block: calc(var(--space-xxl) * 5 / 3)` (1), `padding: calc(var(--space-xxl) * 5 / 3)` (1) |
| XXL × 1.25 | 30px | 13 | 10 | `padding: calc(var(--space-xxl) * 1.25)` (3), `pl-[calc(var(--space-xxl)*1.25)]` (2), `gap: calc(var(--space-xxl) * 1.25)` (2), `margin-bottom: calc(var(--space-xxl) * 1.25)` (1) |
| XXL × 2 | 48px | 9 | 9 | `py-[calc(var(--space-xxl)*2)]` (3), `padding: calc(var(--space-xxl) * 2)` (3), `p-[calc(var(--space-xxl)*2)]` (1), `gap: calc(var(--space-xxl) * 2)` (1) |
| XXL × 3 | 72px | 2 | 2 | `padding-left: calc(var(--space-xxl) * 3)` (2) |
| XXL × 8/3 | 64px | 2 | 2 | `py-[calc(var(--space-xxl)*8/3)]` (1), `padding: calc(var(--space-xxl) * 8 / 3)` (1) |
| XXL × 2.25 | 54px | 2 | 1 | `pl-[calc(var(--space-xxl)*2.25)]` (2) |
| XXL × 11/3 | 88px | 1 | 1 | `padding-left: calc(var(--space-xxl) * 11 / 3)` (1) |
| XXL × 3.25 | 78px | 1 | 1 | `lg:px-[calc(var(--space-xxl)*3.25)]` (1) |

## Kept values

- `0.85em` (font-size): unreadable
- `1px` (font-size): range
- `-0.04em` (letter-spacing): range
- `-0.05em` (letter-spacing): range
- `-0.08em` (letter-spacing): range
- `-0.035em` (letter-spacing): range
- `0.14em` (letter-spacing): range
- `0.18em` (letter-spacing): range
- `0.22em` (letter-spacing): range
- `0.24em` (letter-spacing): range
- `color-mix(in oklch, var(--muted) 50%, var(--card))` (color, `--control-hover`): unreadable
- `lch(54.1 0 282)` (color, `--session-menu-checkbox-border`): unreadable
- `0 0 0 0.5px #0000000f,0 1px 1px -1px #0000001a,0 1px 2px 0#0000000d` (shadow): edge
- `0 0 0 0.5px #ffffff12 inset` (shadow): inset
- `0 0 0 0.5px #ffffff12 inset,0 0 0 0.5px transparent,0 1px 1px -1px transparent,0 1px 2px 0 transparent` (shadow): edge
- `0 0 0 0.5px rgb(0 0 0/0.08),0 1px 2px -0.5px rgb(0 0 0/0.1),0 2px 6px -2px rgb(0 0 0/0.12)` (shadow): edge
- `0 0 0 0.5px rgba(0,0,0,0.06),0 1px 1px -1px rgba(0,0,0,0.1),0 1px 2px 0 rgba(0,0,0,0.05)` (shadow): edge
- `0 0 0 0.5px rgba(255,255,255,0.1)` (shadow): edge
- `0 0 0 0.5px transparent inset,0 0 0 0.5px #0000000f,0 1px 1px -1px #0000001a,0 1px 2px 0 #0000000d` (shadow): edge
- `0 0 0 0.5px transparent inset,0 0 0 0.5px #0000000f,0 1px 1px -1px #0000001a,0 1px 2px 0#0000000d` (shadow): edge
- `0 0 0 0.75px rgba(0,0,0,0.1),0 2px 2px 0 rgba(0,0,0,0.1),0 4px 4px 0 rgba(0,0,0,0.1),0 8px 8px 0 rgba(0,0,0,0.1)` (shadow): edge
- `0 0 0 1px rgb(255 255 255/0.07),0 24px 48px -12px rgb(0 0 0/0.5)` (shadow): edge
- `0 1px 2px rgb(17 24 39/0.08),0 16px 40px -28px rgb(17 24 39/0.32),0 0 0 1px rgb(17 24 39/0.04)` (shadow): edge
- `inset 0 -1px 0 0` (shadow): inset
- `inset 0 0 0 0.5px oklch(0 0 0/0.1),inset 0 1px 0 oklch(1 0 0/0.6)` (shadow): inset
- `inset 0 0 0 0.5px oklch(0 0 0/10%),inset 0 1px 0 oklch(1 0 0/60%)` (shadow): inset
- `inset 0 0 0 0.5px oklch(1 0 0/10%),inset 0 1px 0 oklch(1 0 0/12%)` (shadow): inset
- `inset 0 0 0 0.5px rgb(0 0 0/0.06)` (shadow): inset
- `inset 0 0 0 0.5px rgb(255 255 255/0.06)` (shadow): inset
- `inset 0 0 0 1px rgb(25 23 21/7%),inset 0 1px 0 rgb(255 255 255/32%)` (shadow): inset
- `inset 0 0 0 1px rgb(255 255 255/0.24)` (shadow): inset
- `inset 0 0 0 1px rgb(255 255 255/9%),inset 0 1px 0 rgb(255 255 255/5%)` (shadow): inset
- `inset 0 0 0 1px transparent` (shadow): inset
- `inset 0 0 1px #00000012,inset 0 1px 1px #00000012,inset 0 -1px 0 #ffffff0a` (shadow): inset
- `inset 0 0.75px 0 0 rgba(255,255,255,0.03),inset 0 0 0 0.75px rgba(255,255,255,0.03)` (shadow): inset
- `inset 0 1px 0 oklch(1 0 0/0.82),inset 0-1px 0 oklch(0.18 0.012 275/0.1),0 0 0 0.75px oklch(0.18 0.012 275/0.16),0 1px 2px oklch(0.18 0.012 275/0.2),0 5px 10px -3px oklch(0.18 0.018 275/0.2),0 14px 30px -9px oklch(0.18 0.022 275/0.18),0 32px 68px -20px oklch(0.18 0.026 275/0.16),0 64px 128px -42px oklch(0.18 0.03 275/0.14)` (shadow): unreadable
- `oklch(0.922 0 0)` (color, `--input`): unsafe
- `#000000df` (color, `--trace-code-primary`): unsafe
- `#0000009b` (color, `--trace-code-secondary`): unsafe
- `#00000072` (color, `--trace-code-tertiary`): unsafe
- `#ffffffa3` (color, `--welcome-field`): unsafe
- `rgba(245, 247, 250, 0.96)` (color, `--dashboardy-subsurface`): unsafe
- `rgba(240, 243, 247, 0.98)` (color, `--dashboardy-subsurface-strong`): unsafe
- `rgba(255, 255, 255, 0.92)` (color, `--dashboardy-surface`): unsafe
- `#000000df` (color, `--constellation-tree-primary`): unsafe
- `#0000009b` (color, `--constellation-tree-secondary`): unsafe
- `#00000072` (color, `--constellation-tree-tertiary`): unsafe
- `rgba(244, 246, 248, 0.9)` (color, `--dashboard-01-insights-subsurface`): unsafe

## Warnings

- Install found no Prettier, so the files it rewrote keep its own formatting. Run the project’s formatter on them.

## Left to the agent

- Load `graphical/generated/theme.css` before the app’s styles. Install rewrote the token definitions written in CSS as aliases; also load `graphical/generated/aliases.css`, which supplies JavaScript-defined tokens and backing values for mode-pinned CSS tokens. Remove the original JavaScript definitions it replaces. Semantic names such as `bg-background` stay as aliases.
- Import `graphical/generated/tailwind-theme.css` right after `@import "tailwindcss"`.
- Pass `graphical/generated/tailwind-merge.cjs` to the app’s `extendTailwindMerge`, and have every `cn()` use that merger.
- Resolve the skipped sites, install the theme’s fonts and mount the editor.
- Check the running app. This report and `graphical-install --check` read source, so they show the conversion is complete, not that the app runs. Load the home page and one other page with the dev server: each renders with the editor mounted, and the browser console and the framework’s error overlay show no errors. A page can answer HTTP 200 while a client error stops the editor from loading.
