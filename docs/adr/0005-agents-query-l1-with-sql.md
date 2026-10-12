# Agents query L1 with read-only SQL over clean views

Agents that analyse sessions find and rank runs by writing read-only SQL over views of L1, and read runs through `read` and the run view. ADR 0002 rejected free SQL because raw fields differed between agents and versions; L1 now normalizes them, and `find`'s fixed sources and groupings could not keep up with retro questions: each new kind of question needed API work, and the plugin skill grew to explain its parameters. With SQL the agent defines outliers, impact orders and groupings per question, which is what a retro across a team needs, since nobody can list its questions in advance.

## Considered Options

- Keep extending `find` with sources and columns: rejected; API work for every new question, and the skill keeps growing.
- SQL over the raw tables: rejected; the agent would have to know storage traps (several builds per session, generations, parser versions), and a query that misses one double-counts silently.
- Embeddings and clustering instead of SQL: rejected as the way to rank and count; embeddings are added for search by meaning, next to SQL, and clustering is not built.

## Consequences

- The views hide the storage traps and have a stable grain: one row per run, request, call, prompt, edge, CI job and received setup file. Run question answers are their own view, versioned, never part of L1, so ADR 0002's rule that interpretations stay out of L1 holds.
- The server adds the workspace filter; the agent never writes it. Queries run as a read-only user with limits on time, memory and rows, because ClickHouse is small (6 cores). Since agent queries share that ClickHouse with ingest and merges, at most four run at once across all API instances and two per workspace (slots leased in Postgres), a workspace runs at most 120 an hour, and a query refused for memory or rows read is refused for good, so the agent does not run it again.
- The schema is shown in steps (view names, then one view's columns with their meaning and traps, then sample values). Results cap each cell and the total size and say when something was cut. Errors point at the failing part and say how to fix it.
- A stored query keeps its SQL and its result, and records the sessions it covered, so account deletion follows ADR 0001 as amended: analyses that quote a deleted member's runs are deleted, and results that only counted their sessions are removed.
- `find` stays until the plugin skill moves to SQL; it gets no new sources.
