# Convex stores analyses

Saved analyses (question, steps, queries with exact results, findings, final answer) live in Convex, not in Postgres or ClickHouse. Convex was chosen because team analyses will become multiplayer (people watching and challenging an analysis as it forms) and because reuse needs vector search over questions and step sub-questions; Convex provides both, so we avoid building on Postgres now and migrating later. Postgres with pgvector was the alternative: simpler deletion (foreign-key cascade) and auth (better-auth already there), but no reactive queries.

## Considered Options

- Postgres + pgvector behind a storage module, migrating to Convex when multiplayer ships.
- ClickHouse: rejected; analyses are point lookups and documents, not analytics.

## Consequences

- Only our API writes to Convex (server key); agents never talk to it directly. Owner and workspace checks are enforced inside the Convex functions.
- Deleting a workspace deletes all its analyses. Deleting an account deletes its own analyses and every analysis, by any author in any workspace, that quotes one of its runs (opened them with `read` or the run view); nothing is redacted line by line. A stored SQL result that only counted its sessions among others is removed (marked `removed`, its query kept so it can be rerun), and the analysis stays (amended by ADR 0005). Both run in the durable purge and again in its follow-up pass, which catches analyses that read the account's sessions meanwhile. Each stored query therefore records the sessions (and transcript generations) it read. A re-uploaded session deletes nothing: queries that read an older generation are flagged as changed when opened.
- Retention: an analysis (question, steps, findings, final answer) stays until its author or workspace deletes it; exact query results expire after 90 days (a year for analyses that are shared or pinned), while their arguments stay so they can be rerun. Until it is saved, an analysis is a private draft that no one can open, deleted 7 days after it was started; a saved analysis is never changed, and a revision is a new analysis linked with `updates`.
- Region is open: the EU region (AWS eu-west-1) is intended but not yet available to us. Development runs on a local or US deployment with our own data only; the region, a DPA and a subprocessor review are decided before customer data is stored. EU region means data location, not EU jurisdiction.
- Embeddings come from OpenAI `text-embedding-3-small`, called by our backend. For saved analyses, only the question title and topic words are embedded, when the analysis is saved, never its query results. Session text is embedded with the same model when a session is uploaded, so sessions can be searched by meaning (amended 2026-10-12; see `docs/retro-architecture.md`).
- Restricting a shared analysis's results to admins and the session's owner applies only to workspaces with the own-sessions-only option on, which is off (amended by ADR 0004).
