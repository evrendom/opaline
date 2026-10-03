# Convex stores analyses

Saved analyses (question, steps, queries with exact results, findings, final answer) live in Convex, not in Postgres or ClickHouse. Convex was chosen because team analyses will become multiplayer (people watching and challenging an analysis as it forms) and because reuse needs vector search over questions and step sub-questions; Convex provides both, so we avoid building on Postgres now and migrating later. Postgres with pgvector was the alternative: simpler deletion (foreign-key cascade) and auth (better-auth already there), but no reactive queries.

## Considered Options

- Postgres + pgvector behind a storage module, migrating to Convex when multiplayer ships.
- ClickHouse: rejected; analyses are point lookups and documents, not analytics.

## Consequences

- Only our API writes to Convex (server key); agents never talk to it directly. Owner and workspace checks are enforced inside the Convex functions.
- Deleting a workspace deletes all its analyses. Deleting an account deletes its own analyses and every analysis, by any author in any workspace, that read one of its sessions; nothing is redacted line by line. Both run in the durable purge and again in its follow-up pass, which catches analyses that read the account's sessions meanwhile. Each stored query therefore records the sessions (and transcript generations) it read. A re-uploaded session deletes nothing: queries that read an older generation are flagged as changed when opened.
- Retention: an analysis (question, steps, findings, final answer) stays until its author or workspace deletes it; exact query results expire after 90 days (a year for analyses that are shared or pinned), while their arguments stay so they can be rerun.
- Region is open: the EU region (AWS eu-west-1) is intended but not yet available to us. Development runs on a local or US deployment with our own data only; the region, a DPA and a subprocessor review are decided before customer data is stored. EU region means data location, not EU jurisdiction.
- Embeddings come from OpenAI `text-embedding-3-small`, called by our backend, and only for questions, step sub-questions and topic words, never transcripts or query results.
