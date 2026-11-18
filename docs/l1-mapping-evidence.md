# L1 mapping evidence

`unreviewed` is the default for every source without an explicit semantic judgement. Each agent entry exposes `sourceMappings`: a path, its **primary/context** role, its own relation and justification. The `sources` compatibility projection contains primary paths only; gaps retain their own per-path judgements. The entry's relation is a conservative summary of its current primary paths. Context fields neither cover a fact source nor supply confidence evidence. Catalog constructors inherit a common judgement for homogeneous primary paths, avoiding repeated prose; heterogeneous paths and context roles are explicit on the entry, never in an external override table.

The 115 independent mapping agreements are recorded with concrete reviewer witnesses after parser checks. Binding judgements resolve the specified disagreements; unspecified disagreements and the three unwitnessed Claude compaction facts remain unreviewed. The search-query ruling is conditional: there is no type-filtered search extractor today, so Codex `search_query` stays close; `parsed_cmd_read_paths` is exact because the parser already requires `type=read` and a string path. Claude `mode.mode` has only `normal` witnessed and stays observed.

## Parser issue verification (Task B)

All **122 unique flagged mappings** were checked: **63 flagged by both reviewers**, then **59 single-reviewer flags**. Exactly one class each: **104 catalog_wording, 13 stored_data_wrong, 5 not_an_issue**. The full compact tables, parser references, parser-9 plans and count-only witnesses are grouped by view: [calls](l1-parser-review-calls.md), [runs](l1-parser-review-runs.md), [prompts](l1-parser-review-prompts.md), [session](l1-parser-review-session.md). No parser behaviour changes. Existing unflagged failure/late-exit defects are retained, not silently repaired.

The runtime transcript-records barrel does not export the catalog. Tests/tooling can use the separate `@rudel/api-routes/fact-catalog` entry. The catalog carries hand-written judgements and source/type/paired references only; census, fixture and LLM evidence and confidence tiers are assembled by `fact-mapping.ts` in tooling/tests. The matrix uses the committed count-only census; the review uses its selected corpus. Review hashes depend on the raw catalog, not volatile corpus evidence.

The catalog is a hub: each agent's sources map **to the fact definition**, not directly to the other agent. Relations borrow SSSOM/ConceptMap distinctions, not their full ontologies. `exact` means the literal value has that meaning; `transform` means the same meaning in another representation, with a named conversion; `close` is a partial, conditional or derived match. `broader` means the source includes meanings beyond the definition; `narrower` covers only part of the definition. These are assertions until corroborated, not scores.

`not_found` is a documented census search, not evidence that a writer cannot emit the fact. `not_emitted` requires writer-source evidence proving absence for the stated version. The 0.162.0 writer proves three exclusions: approved permission prompts (judge ruling), compaction cause and prompt queue lifecycle; the other 33 reviewed Codex absences remain `not_found` (see `l1-codex-absence-review.md`). `derived` lists the catalog facts Opaline computes it from (counts, pricing, hashes and cross-system joins); it is not agent-written. `provenance` is Opaline bookkeeping (clipping/budgets, upload/workspace metadata or externally bound identity), N/A per agent. These kinds are not false absence claims. Requested actions still must not become completed effects.

Derived dependencies include their raw-record provenance, not just bounded scalar projections: `not_found` reads the call-result text behind `result_chars`, never its character count as a not-found predicate. Cost additionally needs the configured rate card, and CI joins need external snapshots. These are application computations, not new literal agent claims.

Confidence is computed, independently of parser storage status:

- **verified**: an explicitly judged mapping with meaning-supporting writer source, published types or a planted-value paired run **and** a positive census or fixture witness.
- **observed**: a positive census or fixture witness, without that semantic authority.
- **asserted**: no positive witness (including LLM-only assertions and census-only absence searches).
- **not_applicable**: derived/provenance; excluded from agent-semantic tier denominators and from judged literal mappings, but counted separately.

Writer path existence alone does not prove a relation. An explicit `supportsMeaning` assessment is required; a source may witness structure while a mapping stays observed. Fixture evidence pins today's parser behaviour, including known bugs, not cross-agent semantic equivalence. There are no paired runs yet. A verified mapping would not certify that every parser source or gap is implemented.

Comparability is derived: two exact sides are direct; exact/transform sides are comparable after their named transforms; close/broader/narrower yield a caveat. Absence yields one-sided/no observed counterpart. Explicit semantic conflicts override these rules: `is_error` and `failed_calls` must not equate Codex's nonzero exit predicate with Claude's explicit failure flag and return-code interpretation.

The matrix and review page report tier shares (denominator: literal agent mappings, including searched absences, excluding derived/provenance), aggregate and primary-path relation counts, excluded context paths and conflicts. Judged literal counts exclude searched absences and application kinds. A primary path needs its own semantic authority to participate in a verified mapping; a proved context ID cannot verify a value field. Fixture tests count explicitly documented contexts separately instead of pretending they are mapped sources. Observed corpus drift stays distinct from writer residue and semantic confidence. Precision, false absence and canary accuracy are not estimated from reviewer agreement.

`fact-mapping-census.json` contains only paths and occurrence counts, never transcript text or tool values. Regenerate read-only with `bun packages/api-routes/src/scripts/facts-mapping-census.ts`; its corpus label records actual file/record totals. The catalog's older absence searches keep their original corpus/date. LLM seed/verifier provenance is the existing catalog commits, not a new independent audit. Source patterns may match many witnessed paths; their counts are not summed as distinct records.

Parser behaviour, raw-byte pointers and parser versions are unchanged by this tooling.

## Codex writer residue (Task D)

The compact `codex-residue-review.json` ledger preserves all **305 original review keys** and their corrected serialized paths. Applied **203 agreements**: **113 reasoned ignores**, **47 map_existing paths** attached to 26 existing facts (primary or explicit context; unparsed paths stay gaps), and **43 new_fact paths** grouped into **17 pending families**. Claude counterparts of those families stay pending/unreviewed, not fabricated absences. A wrong mapping may still have a recorded, unparsed gap: explicit skill references and named profile IDs are retained without pretending today's incorrect stored values came from them.

All **102 disagreements** retain both proposals and `pending` status. After serialization correction, two paths are already structurally covered; **100 uncovered writer paths** remain pending review. Structural coverage does not resolve semantic disagreement. The pinned 2,087 writer paths partition into **470 primary-mapped, 1,467 ignored, 50 context-only, 100 pending-review and 0 unassigned**. Context-only is neither mapping nor ignoring, and is visible separately; it cannot inflate coverage or confidence. There is no claim of 100% literal storage or semantic verification.
