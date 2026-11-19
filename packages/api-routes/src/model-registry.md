# Trends comparison registry

`model-registry.ts` owns canonical family ids and vendor defaults.
`model-registry-aa.ts` stores exact AA UUID/slug identities, published dates,
explicit lineage, the slopalytics names/ids-only union, and the coding-line list.
No benchmark values are stored in either registry.

Group priority is In use → Frontier → Coding tools → Earlier versions.
Only In use is checked by default. Non-use families must have cost data in the
release. Frontier recomputes twenty distinct families by best cost-observed
Intelligence Index on every release, then unions the verified curated ids.
An unregistered winner resolves by exact creator UUID + release slug and variant
UUID/slug from that release. It has no inferred historical/coding lineage.

Coding tools selects the newest dated, cost-observed generation per maintained
line. First-match exclusions leave roughly 8–15 families (hard cap fifteen),
not duplicate copies of the coding families already in Frontier. The rule and
one-line rationale/source for every entry live in `CODING_MODEL_LINES`.

The October 1, 2026 catalogue covers Gemini Pro/Flash, Grok/general and Code,
Kimi/general and Code, GLM/full and Flash, DeepSeek Pro/Flash, Qwen Coder/Max/
Flash/open flagship, MiniMax, Mistral Medium/Large/Small and Devstral, Nemotron
Ultra, Mercury, and Cursor Composer. Grok Code and Composer are not listed in
this AA release; Devstral has no cost observation, so all three are omitted.
Mercury is the general AA model, not a measurement of Mercury Edit.

Earlier versions uses explicit same-lab `line` membership and published dates,
anchored to the newest In use generation. Take the two newest older non-In-use,
cost-observed generations per line, then apply group priority; never fill a
third predecessor because a newer one already belongs to Frontier. In-use
predecessors are not selectable extra copies and do not consume the cap.
Dates are release dates, never price-effective dates or parsed version strings.

Known defaults canonicalize by exact override. Unknown defaults remain in
tables but never join named effort geometry. Non-reasoning baselines remain
detached. Named lines split at axis reversals, preserving every observation.
Duplicate family/effort entries prefer cost observations, then intelligence,
then stable UUID order, so rankings are independent of source-record order.

The preview fallback uses independent seeded synthetic observations and this
same policy, with its own ranks. AA and usage provenance remain separate.
