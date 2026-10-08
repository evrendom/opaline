# October 2026 model pricing update

Verified against first-party documentation on October 8, 2026. These are USD per million tokens for standard first-party API processing, not subscription charges or an invoice reconciliation.

| Model / request date | Prompt | Uncached input | Cache read | Cache write | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| Claude Haiku 5.5, October 7 onward | up to 100,000 tokens | 0.10 | 0.01 | 0.125 (5m) / 0.20 (1h) | 0.50 |
| Claude Haiku 5.5, October 7 onward | over 100,000 tokens | 0.50 | 0.05 | 0.625 (5m) / 1 (1h) | 2.50 |

Claude Haiku 5.5 is the only current Claude model priced by prompt length. A request whose full input context (uncached input plus cache reads plus both cache-write classes) is over 100,000 tokens pays the higher rates on every token class of that request, output included. Exactly 100,000 stays in the base band. Cache reads are 0.1× input and cache writes 1.25× (5m) / 2× (1h) in both bands. US-only inference (`inference_geo: "us"`) adds 10% to every token class in either band. Haiku 5.5 has no Fast mode, so a Fast request on it stays unpriced.

## Per-model long-context thresholds

Long bands used to share one threshold: OpenAI's 272,000 input-context tokens. A long rate-card row can now set `longContextAboveTokens`; Haiku 5.5's long row sets 100,000 and every other model keeps 272,000. Request-level estimates (`resolveModelPricing`), the request-context SQL from `buildEstimatedCostSql`, and the usage-event analytics band all read the threshold of the event's canonical model. The analytics band is still chosen before grouping, from the same pricing identity the catalog later resolves, so existing unresolved Haiku 5.5 events become priceable at read time without a backfill.

## Token counts

Haiku 5.5 uses the newer tokenizer (introduced with Claude Opus 4.7): the same text counts as about 30% more tokens than on Claude Haiku 4.5. Estimates price the recorded token counts, so nothing changes in the pricing engine, but a workload that moves from Haiku 4.5 to 5.5 shows more tokens for the same prompts, and that also brings some prompts over the 100,000-token threshold sooner.

## Sources

- [Claude Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview): October 7 release, model ID, both rate cards and the 100,000-token threshold.
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): both Haiku 5.5 rate cards, long-context pricing, the cache multipliers and the US-only inference premium for Claude 4.6 and later models.
