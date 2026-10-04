# Trends data

## Stored sources (production)

Production does not build from the third parties directly. The API's daily
cron (`/api/cron/trends-sources`, 04:00 UTC, after Slopalytics publishes its
day) fetches Artificial Analysis, Slopalytics' T3 Code snapshot and Opaline's
own usage aggregate, and stores each capture that passes its checks in
Postgres (`trends_source`, one row per source). `GET /api/trends/sources`
serves the stored captures, and the marketing build reads them with
`TRENDS_SOURCES_FETCH=1` (`TRENDS_SOURCES_API_URL`, default
`https://opaline.so`).

- A failed fetch, a block or an error keeps the stored capture.
- Artificial Analysis: a release replaces the stored one unless it lost more
  than half of its models (a broken page, not news).
- Slopalytics publishes a rolling 30-day window; each capture is merged into
  the stored days rather than replacing them. Days that left the window stay,
  a day both report takes the newer (revised) figures, and a row that comes
  back empty never replaces one that was reported. A capture without both
  Claude Code and Codex turns is rejected whole.
- Opaline usage replaces the stored aggregate unless it published no models or
  lost more than half its all-time runs.
- The cron answers 503 when any source was kept, naming the reason per source.

A source the API has not stored yet (the first deploy, before the cron ran)
falls back to that source's own direct fetch below when its flag is set, and
otherwise to preview data. The page reflects the stored data as of its last
build; the cron alone does not rebuild it.


`bun run trends:fetch-aa` reads Artificial Analysis's public `/models` page and
the model payload referenced by its RSC manifest. It makes two sequential,
identified HTTP requests, with a 30-second timeout each and no retries. A valid
release fetched on the same UTC day is reused without network requests. Run this
command once daily in the build host; do not commit or upload its generated file
as a repository artifact. No paid API or credentials are used.

The public page currently supplies an AES-GCM key alongside a `/data/*.txt`
manifest. The browser decodes that public payload into gzipped JSON. The ingester
implements that transport using Bun/Web Crypto, validates identities and the
known metric shapes with Zod, and atomically writes
`apps/marketing/src/trends/generated/aa-release.json` (gitignored). Provider-offer
data is deliberately not requested. `sourceSha256` hashes the raw model payload
bytes before decoding, not the normalized release. Per-task metrics and full-index
totals remain independent source observations. Missing metrics become null.

## Build controls

- `TRENDS_AA_FETCH=1 bun run --cwd apps/marketing build` refreshes before building.
- Default builds do not fetch. They use a valid local release when present,
  otherwise the preview benchmark fixture.
- `TRENDS_BENCHMARK_SOURCE=preview` is the kill switch: bypasses fetching and
  ignores any local release. `artificial_analysis` selects the public-site release
  with preview fallback if absent/invalid. An empty/unset value selects automatically.
- An enabled fetch that fails logs the failure and forces preview benchmarks for
  that build, even if an older local file exists. Standalone ingestion fails loudly.
- Configure the build host's daily schedule to run the opted-in marketing build
  and deploy its output. This repository does not provision a deployment schedule.
  Repeated builds on ephemeral hosts need a private persisted release cache to
  avoid repeating that day's fetch; never place it in public Git or public CI artifacts.

Both variables pass through the marketing Turbo build; that build is uncached so
the ignored release and source switch cannot leave stale cached output. Client
rendering receives the same build-time snapshot as SSR and makes no AA requests.

## In the wild: Opaline usage

`GET /api/trends/usage` (API, public, no authentication) returns the aggregate
In the wild dataset of all time (`scope: "all_time"`): every run from the first
through the last complete UTC day, across every workspace, with no prior period
(so no rank movement), plus the last 30 days for the harness balance and the
last 13 whole weeks for the weekly share. Totals include sessions, runs,
developers and workspaces. It holds per-model totals, rates and p50/p90/p99
quantiles only, no user, workspace, session or repository identity, and lists a
model only once it clears `TRENDS_MIN_RUNS` (default 100),
`TRENDS_MIN_DEVELOPERS` (3), `TRENDS_MIN_WORKSPACES` (2) and 1% of all runs.
Each API process computes it at most once an hour; responses are
`Cache-Control: public, max-age=3600`.

Sources (`apps/api/src/services/trends-usage.service.ts`):

- runs, replies, reactions, run time, developers, workspaces, weekly share:
  `session_language_signals.agent_runs`; a run's model is its last request's
- output tokens and cost per run: `usage_events`, priced exactly like the
  dashboard; each request belongs to the latest run that started at or before
  it, so a run owns its subagents' work. Runs with an unpriced request are left
  out of cost; requests before a model's rate-card date are unpriced
- tool calls and failures: committed `transcript_records` generations, owned by
  the run in progress
- apologies, top apology, swears and prompts: per session, attributed to the
  session's most-used run model

A figure is null when no run carried its data; that model is left out of that
chart and of its rank movement, never drawn at zero. Reasoning effort is not
recorded per run, so the benchmark join uses the vendor default effort.

`bun run trends:fetch-usage` stores one response in
`apps/marketing/src/trends/generated/opaline-usage.json` (gitignored);
`TRENDS_USAGE_API_URL` points it at another API. `TRENDS_USAGE_FETCH=1`
refreshes before the marketing build and falls back to synthetic usage if the
fetch fails; `TRENDS_USAGE_SOURCE=preview` is the kill switch. Applying real
usage re-selects the benchmark groups, since In use follows the usage models.

## Claude Code vs Codex (T3 Code via Slopalytics)

`bun run trends:fetch-t3` makes one identified request (30-second timeout, no
retries) for Slopalytics' public `/data/t3-usage.json`, T3 Code's daily PostHog
usage export. A valid capture fetched on the same UTC day is reused. It validates
the fields the balance uses and atomically writes the Claude Code (`claudeAgent`)
and Codex rows to `apps/marketing/src/trends/generated/t3-usage.json`
(gitignored); `sourceSha256` hashes the raw response.

The balance shows Slopalytics' numbers as published, nothing re-derived or
re-priced: prompts are sent turns, tokens are input plus output, spend is their
`estimatedCost`. As on Slopalytics, tokens and spend are blank on a day either
harness has no token or priced report. Every other In the wild chart keeps the
usage population.

- `TRENDS_T3_FETCH=1` refreshes before the marketing build; a failed fetch logs
  and falls back to the usage population for that build.
- `TRENDS_HARNESS_SOURCE=usage` is the kill switch; `t3_code` or empty uses a
  valid local capture when present.

## Identity and usage

`packages/api-routes/src/model-registry.ts` uses canonical rate-card ids, explicit
AA aliases and exact UUID/slug effort overrides. UUID overrides precede slug
overrides, which precede effort parsing. Duplicate family/effort observations
resolve deterministically to cost-observed, then highest-intelligence, then UUID
order; ingestion and the raw hash still cover the full release. Known AA defaults resolve to their actual effort
via overrides. Unknown `default` observations remain in tables, but are excluded
from connected lines and ranges if the family also has named efforts, even when
those named efforts are unchecked. Geometry uses canonical effort order, never
AA's unspecified/default order.
A sole unspecified reasoning setting, such as Haiku's, remains a standalone
benchmark point when there are no named reasoning efforts to connect.
Non-reasoning baselines remain visible but are not connected to named reasoning
efforts: in the fetched release Luna's non-reasoning cost is higher than low,
which caused the visible bottom-left bend even without an unspecified default.
Named reasoning lines also break at any cost/time or intelligence reversal;
all points remain visible and every table observation is retained. Direct labels
above twelve selected series show the top eight by intelligence (five on narrow
plots), plus focused/hovered families, with the existing collision placement.
Grouped bars adapt to readable per-family ranges above twelve selected models;
ranking and tables remain complete, and the plot explains the adaptation.
Range rows and axes share one grid and reserve gutters from formatted value
lengths so precise low costs never clip at the panel edge.
Curated UUID/slug pairs are identity mappings, not benchmark observations. The
registry keeps published AA release dates for matched historical families;
unverified dates remain null rather than using price-effective dates as releases.
The
vendor fallback effort is separate from `aaBaseEffort` (AA often tests max at the
base slug). Current Claude defaults use the official effort documentation;
GPT-6 and GPT-5.6 fallback efforts use the official OpenAI reasoning documentation.

One page model set is derived from the current usage population, with all three
snapshot publication thresholds applied before rounding and a >=1% share of all
period agent runs. In-use families are ordered by run share and selected by
default in both datasets. The picker shows run share and weekly sparklines in
both modes. Selection is shared across modes; each group has an All toggle,
search matches name/lab and `/` opens and focuses it outside editable controls
and dialogs. Group All acts on the whole group even while search is filtered.
Reset restores In use only and clears search. Extra selections survive switching
to In the wild and editing its In use selection, but never introduce usage rows.

## Comparison registry policy

`packages/api-routes/src/model-registry-aa.ts` is the maintained identity catalogue:
exact variant UUID/slug overrides, verified release dates, explicit `line` values,
the names/ids-only slopalytics frontier/notable list captured October 1, 2026,
and `CODING_MODEL_LINES` with one-line rationales and primary-source references.
The source list's size tiers, default exclusions and benchmark values are unused.
The fetched release alone supplies AA scores and cost observations.

`selectBenchmarkModels` assigns each family once, first match wins:

1. **In use:** unchanged usage-derived population/order; selected by default.
2. **Frontier:** cost-observed curated families union the release's top twenty
   families by best intelligence among cost-observed variants; ordered by score.
   Every release recomputes this, including previously uncatalogued winners.
   Those winners get exact release-slug + creator-UUID family identities and
   exact source variant UUID/slugs, never a fuzzy name match or guessed lineage.
3. **Coding tools:** newest cost-observed generation with a verified release date
   per registry coding line, then remove families claimed above; at most fifteen.
   The October 1 release contributes ten remaining families from nineteen
   cost-eligible coding lines. Grok Code and Cursor Composer are absent from AA;
   Devstral 2 is listed but lacks cost data. Do not manufacture those entries.
   Mercury is AA's general model, not Kilo's distinct Mercury Edit product.
4. **Earlier versions:** anchor each explicit lab/line to its newest In use
   generation; find strictly older cost-observed, dated, non-In-use generations;
   take two per line before first-match exclusions, order newest first globally.
   Already-in-use generations never consume a predecessor slot. A predecessor
   claimed by Frontier remains there, rather than pulling a third older version.
   Astra/Haiku have no cost-observed predecessors in this release.

All three extra groups are benchmark-only and unchecked by default. Preview
benchmarks are seeded synthetic observations and use the same grouping policy,
not a cached or relabeled AA release. Their ranks/group membership may differ.
Header totals always refer to the full usage population, including any families
that fail publication or the share cutoff. Weekly charts continue to normalize
among selected in-use families and display each family without an Other bucket.

Snapshot provenance is independent for `sources.benchmarks` and `sources.usage`.
Real AA benchmarks do not turn synthetic usage into Opaline observations. The
usage-to-benchmark join references `familyId` + `benchmarkEffort`; it never carries
an independent intelligence score. Preview efforts are explicitly declared;
unknown real usage effort should use the registry's vendor default. Missing
tested efforts remain missing, not substituted with the highest score.

`preview-population.ts` creates seeded daily day/harness/family observations with
count-weighted per-run distributions and synthetic developer/workspace identities.
`trends-usage.ts` derives monthly metrics, previous calendar month, empirical
p50/p90/p99, developer/workspace counts, harness runs/tokens/spend and 13 complete
Monday–Sunday weeks ending before the usage period end. Monthly totals are not
compared with a differently bounded weekly window. Monthly model summaries expose
token/cost sums; medians are not used to reconstruct totals. These pure derivations
can move to a shared package when the real snapshot job is built.

## Verification and caveats

Run `bun run trends:test`. Scraped values are not embedded in tests. Fresh live
captures and discovery notes belong only in gitignored `.context/aa/`.
`bun scripts/trends/audit-more-models.ts` independently reconciles the local AA
release against the curated union, top twenty, coding lineage, predecessor cap,
exact overrides, source hash, all 128 effort subsets on both connected axes,
and the existing usage/quantile/weekly/Pareto checks. It writes the evidence to
`.context/aa/more-models-audit-results.json`; no requests or scraped test fixtures.

The public site's Flight transport, manifest layout and metric names are not a
versioned API. A drift fails validation and invokes the build fallback. Unmapped
variants are reported on every fetch/cache hit for registry review. Keep the source
switch available: robots allowance is not a substitute for reviewing AA's terms
and attribution requirements. No legal text or methodology rewrite is included.
