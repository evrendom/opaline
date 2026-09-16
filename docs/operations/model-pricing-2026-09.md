# September 2026 model identity and pricing update

Verified against first-party documentation on September 16, 2026. These are USD per million tokens for standard first-party API processing, not subscription charges or an invoice reconciliation.

| Model / request date | Uncached input | Cache read | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Sol, June 26–August 20 | 5 | 0.50 | 6.25 | 30 |
| GPT-5.6 Sol, August 21 onward | 4 | 0.40 | 5 | 20 |
| GPT-6 Astra, September 3 onward | 10 | 1 | 12.50 | 50 |
| Claude Fable 5.1, September 1 onward | 10 | 0.25 | 12.50 (5m) / 20 (1h) | 50 |

Sol and Astra requests above 272,000 input-context tokens use 2× input/cache rates and 1.5× output rates for the full request. Exactly 272,000 stays in the base band. The implementation supports Astra Fast/Priority at 2× in either band and the current Sol long-context Fast/Priority rates. Fable 5.1 has no long-context surcharge; US-only inference adds 10% to every token class. Original Fable 5 continues to use its own $1 cache-read rate; a 5.1 model ID never matches the Fable 5 pattern.

## Sources and date precision

- [OpenAI API changelog](https://developers.openai.com/api/docs/changelog): Sol's reduction announced August 21, 2026; Astra released September 3, 2026.
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing): current Sol and Astra standard, long-context, caching and Fast rates.
- [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra): token rates and context threshold.
- [Fable 5.1 documentation](https://platform.claude.com/docs/en/models/fable-5-1/overview): September 1 release and token rates.
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): Fable 5 versus 5.1 cache rates, full-context pricing and US inference premium.

The providers publish calendar dates, not an exact intraday billing cutover time in these sources. The existing pricing engine normalizes each request timestamp to a UTC date; tests pin this convention at midnight and with timezone offsets. Do not claim sub-day invoice accuracy from these announcements. Sol's promotion is available **at least through November 21**, not confirmed to end that day. The catalog therefore does not invent a November 22 price increase; reverify when the provider announces another change.

Prices are selected by each usage event's date, never the session's start, upload, or viewing date. Sessions spanning August 20–21 sum old-rate and new-rate requests independently. No price is inferred before a model's release, from another model, or from a session display label. Existing Sol periods remain in the catalog through August 20.

## Required request information

To estimate correctly, retain the provider/model ID, timestamp, uncached input, cached input, separate cache-write classes, output tokens (reasoning tokens must not be counted again), full input-context size, processing tier, inference speed, and billing geography. Unsupported rates, conflicting model/provider evidence or unsupported billing dimensions remain unknown, not zero. Missing dimensions retain the existing standard-processing/default-region assumptions; these estimates do not include subscription billing, negotiated discounts or tool fees. Published Batch/Flex discounts and OpenAI regional-processing rules are not added by this scoped update; explicit unsupported dimensions continue to return unknown.

## Request-level Fast billing

Both overview and detail estimates apply the recorded billing dimensions for each request. Codex reads `info.service_tier`, falling back to the token-count payload's `service_tier`; `default` on the response wins over a requested Fast setting. The tier is not carried forward to a later request that lacks it. [OpenAI renamed Priority processing to Fast mode on July 30, 2026](https://developers.openai.com/api/docs/guides/fast-mode); both `priority` and `fast` identify the same premium, applied once. Astra and current Sol Fast rates are 2× standard in each supported context band, with the base rate still selected by the request's UTC date.

Claude uses `usage.speed` to identify Fast mode. Its `service_tier: priority` does not itself apply the OpenAI premium. Detail calculations also preserve Claude's inference geography and Codex's recorded model provider, so those dimensions are no longer silently lost. Unsupported Fast rates (including Fable 5.1), unknown tiers, malformed billing fields and unsupported providers remain unpriced in detail. Claude's documented `not_available` geography sentinel retains the existing default-region estimate.

A transcript without billing metadata still produces a standard-rate estimate. It is not proof that Fast was disabled, and current account settings cannot establish the tier used by old requests. The reported September 12 Astra example contains no recorded tier or speed, so its $791.94 estimate remains based on standard rates.

## Existing sessions and display

The overview now displays a recorded main model even if its price is unknown. Synthetic, missing and conflicting usage records do not provide a model identity. Detail summaries recover a recorded primary model when analytics metadata contains a blank or `unknown`/`<synthetic>` placeholder.

For stored `unresolved` events, the read query resolves the preserved raw model against the current dated catalog, then applies the existing timestamp, provider, billing-quality and receipt-consistency checks. This makes existing Astra and Fable 5.1 events priceable without rewriting transcripts, re-uploading sessions or running a database backfill. New ingestion also recognizes those models through the updated catalog version. An unknown future model still displays its recorded identity and remains unpriced.

The daily rollup uses a left ANY metadata join plus a tenant-match filter. This preserves each usage date on the left while retaining one metadata match; the previous inner ANY join could collapse multiple usage dates for one session. Tests cover the two sides of Sol's price change both in a session total and as separate daily rows.
