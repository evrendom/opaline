# November 2026 model pricing update

Checked against first-party documentation on November 11, 2026. Rates are USD per million tokens for standard first-party API processing. They are not subscription charges and have not been reconciled against an invoice.

| Model / request date | Context | Uncached input | Cache read | Cache write | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| Claude Fable 5.2, November 9 onward | full 1M | 8 | 0.20 | 10 (5m) / 16 (1h) | 40 |
| Claude Mythos 5.2, November 9 onward | full 1M | 8 | 0.20 | 10 (5m) / 16 (1h) | 40 |
| GPT-6.1 Terra, October 26 onward | up to 272,000 | 1 | 0.05 | 1.25 | 5 |
| GPT-6.1 Terra, October 26 onward | over 272,000 | 2 | 0.10 | 2.50 | 7.50 |

Fable 5.2 and Mythos 5.2 cost less than Fable 5.1 and Mythos 5.1 ($10 / $50). Their cache reads are still 0.025× input. Fast mode doubles every token class ($16 / $80), and cache multipliers stack on top of it. US-only inference (`inference_geo: "us"`) adds 10% to every token class. Fable 5.1 still has no Fast mode, so a Fast request on it stays unpriced.

GPT-6.1 Terra costs half of GPT-6.1 Sol on every token class. Above 272,000 input-context tokens it pays 2× input and cache rates and 1.5× output on the whole request. Fast and Priority double every token class in both bands. OpenAI publishes no Ultrafast rate for Terra, so an Ultrafast request on it stays unpriced.

GPT-6.1 Sol has an Ultrafast tier from October 8. It is 6× every token class in both bands, the same multiplier as GPT-6 Astra's tier.

## Not modeled

On October 20, OpenAI added 12-hour prompt caching. A 12-hour write costs twice the 30-minute write (2.5× input). The rate card has only one OpenAI cache-write column, which holds the 30-minute rate, and Codex usage events don't say how long a write is retained. 12-hour writes are therefore priced at the 30-minute rate.

## Rebuilds

The rate card feeds the run index pricing fingerprint (`RUN_INDEX_PRICING_VERSION`). Merging this change rebuilds the stored run index generations, as every earlier pricing change did.

## Sources

- [Claude Fable 5.2 overview](https://platform.claude.com/docs/en/models/fable-5-2/overview): November 9 release, model ID, token rates and context window.
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing): Fable 5.2 and Mythos 5.2 rows, the 0.025× cache-read footnote, the $16 / $80 Fast mode rates and the US-only inference premium.
- [GPT-6.1 Terra documentation](https://developers.openai.com/api/docs/models/gpt-6.1-terra): model ID, token rates, long-context rule and Fast multiplier.
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing): Terra and Sol rows in every tier, including Sol's Ultrafast rows.
- [OpenAI API changelog](https://developers.openai.com/api/docs/changelog): GPT-6.1 Sol Ultrafast on October 8, 12-hour caching on October 20, and GPT-6.1 Terra released October 26.
