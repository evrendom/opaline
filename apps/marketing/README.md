# Marketing product demo

The hero embeds `/product-demo/demo.html`: build-time React HTML from the actual
product shell, session table, rows, controls, and avatars. It is not a screenshot
or a separate marketing implementation of the product UI.

The document includes 30 initial rows, three local avatars, and the real total and
metric maxima. Only HTML, CSS, visible assets, and a tiny activation listener load
initially. No React app chunks, authentication, or live data requests run before
Explore. The seed contains no transcripts, authentication tokens, or credentials.

Chrome continuously resizes the existing frame with the original easing and
WebGL sweep. Desktop Safari/WebKit uses a separate transition: one destination
layout and a transformed window. The iframe fills that moving window throughout
entry and exit, so its paint viewport never cuts off a still-expanded app.
Nested transforms animate the inner pane, sidebar, header, and scroll clips.
Content immediately inside the scroll clip counter-scales as a group;
visible cells animate their widths and positions without giving every fixed-width
cell a separate compensation layer. Text and icons keep their proportions. Labels whose
width or wrapping changes briefly blend two unscaled presentations inside the
moving cell. These presentation spans are hidden from assistive technology and
removed before first hydration or on cancellation. If the initial app download
finishes during a quick exit, Safari waits for this cleanup before committing
hydration, preserving the existing elements throughout the transition.
Window and content animations share
one start instant across the two documents' time origins. Geometry/style reads,
DOM/style writes, and animation creation run in separate batches. Temporary
labels copy only text and box-layout properties; each presentation combines its
transform and opacity in one animation using the same sampled easing.
Its lighter gradient sweep uses transform/opacity animations. The iframe and app
return to normal responsive layout when motion finishes or is cancelled.
WebKit also prepares layers for the demo's masked/filtered icons at first paint,
retaining their existing masks, shadows and colors while avoiding repeated
effect painting during motion. Chrome does not receive this layer hint.
Both browsers use the original 180ms lead-in and 620ms resize curve, with a
1150ms full transition. Safari prepares its content before creating the sweep,
then aligns the sweep, demo bar, and CTA fades with the window's start time.
This replaces the previous Safari-only 400ms preparation delay.

The Safari geometry path applies to desktop bounds of at least 768px and a
same-origin embed; mobile and cross-origin embeds retain continuous resizing.
Reduced motion skips both paths' animation. Browser selection is isolated in
`demo-browser.ts`; desktop Chromium is explicitly excluded.

Safari's landing preview has a transparent input surface above the iframe.
This keeps wheel events in the landing document for Lenis; `pointer-events: none`
on the iframe alone does not reliably do this in WebKit. The surface is absent
during demo entry, interaction, and exit, and returns when the landing state is
restored. It does not change the hero or gradient animation.

Safari scrolls the landing inside a viewport-height container while the root
document stays at zero. This prevents the white document edge from moving behind
Safari's translucent toolbar. Lenis retains the same easing on that container;
the hero fade, navigation handover, and gradient read its scroll position. Demo
entry preserves the landing's scroll range while the window leaves normal flow,
and exit restores the offset and refreshes the reveal state. Chrome retains
document scrolling. Reduced motion keeps the container with native scrolling;
without JavaScript the page falls back to normal document scrolling.

Once both the resize and sweep finish, an origin/source-checked activation
message loads React and hydrates the same tree with identical seed data. All demo
CSS loads with the initial preview, so activation introduces no late stylesheet.
After hydration commits, demo authentication enables live queries. Existing rows
remain mounted when the rest of the 93-session dataset arrives. The router stays
inside the frame, so navigation and exit/re-entry do not reload the document.

Once entry finishes, focus moves into the session scroller (not the Exit button),
so wheel and keyboard scrolling need no extra product click. A slow connection
finishes that handoff once the seeded surface becomes interactive. Escape in the
frame still exits via a source/origin-checked message.

The shared navigation only renders released destinations: Sessions, Team, and
Settings. Dashboard and Skills stay routable for development previews but are not
shown as disabled or Coming soon buttons. Production builds redirect those two
unreleased section entry routes to Sessions. These are UI availability gates, not
API authorization.

## Deployment and local preview

`bun run build:site` builds marketing, the embedded demo, and the product into
`dist-site`. The root Vercel configuration serves the marketing page at `/home`,
onboarding at `/welcome`, and the application at `/{workspace}/sessions`.
Old product links resolve through the application to the current workspace.

The live showcase uses `/api/demo/auth` and `/api/demo/rpc`. Its credentials stay
on the server in `DEMO_ACCOUNT_EMAIL`, `DEMO_ACCOUNT_PASSWORD`, and
`DEMO_ORGANIZATION_ID`. Visitor authentication cookies are never forwarded and
all showcase mutations are rejected.

For a production build preview, set `PREVIEW_API_URL` to a local API and run
`bun scripts/preview-site.ts` from the workspace root. The preview listens on
port 4602 by default (`PREVIEW_PORT` changes it). Demo credentials may refer to
a disposable local showcase account. Browser QA tools under `apps/web/tools`
are separate from the unit test suites and require this running preview.
