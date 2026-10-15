# Moments, observations and patterns: rules find, a model reads a span, words group

Run questions (a cheap model answering yes/no questions over a whole run) didn't help engineers reflect on how they work with agents. The questions SQL could answer were filters, not insight. The others came back with too many false positives to act on, because a run is long and the question is vague. What a retro needs is the part in between: where in a run something went sideways, what actually happened there, and whether it keeps happening across the team. We split that into three steps, each doing only what it does reliably:

1. **Moments**: deterministic rules over L1 (`run_index` and `transcript_records`) mark spans of a run, a range of record numbers, where something observable went sideways. Rules don't judge; they point.
2. **Observations**: on request, a strong model reads only that span (±2 records, at most 60,000 characters) and the run's prompt head. It writes what happened, quotes evidence by record number, names the layer a fix belongs to (environment: navigation, checks, reviewer rules, steering files, tools, information access; practice: prompt, hand-off, steering timing, task size, verification), and gives one concrete lesson. It may say the rule matched normal work. Short input and a closed set of layers keep it precise; the false-positive answer keeps the rules honest.
3. **Patterns**: observations of a range are grouped per layer by the words of their lessons, and a team records the fix it made against a pattern. The pattern then shows its weekly rate before and since the fix, which closes the loop the retro is for.

## Considered Options

- Better run questions: rejected; a yes/no over a whole run can't say where or why, and its answer is a probability, not a reading.
- A model over whole runs or sessions: rejected; it costs too much per run and gets vaguer as runs get longer, and it mostly writes what a rule could have found.
- Clustering with embeddings: deferred. TF-IDF within a layer is enough while each workspace has hundreds of observations, needs no external call, and is explainable. `OPENAI_API_KEY` embeddings can replace `tfidf` behind `groupObservations` when patterns start to blur.
- Precomputing observations for every moment: rejected for now. Observations are made on request within a daily limit per workspace, so cost follows use, and the switch that allows sending spans to Anthropic is separate from the one that shows moments.

## Consequences

- They live on their own page, Compass, an inbox: what was noticed on the left, everything about the selected run (its flags, observation and every record) on the right; Agent traces stays the plain table of runs it was.
- Moments are computed at read time from the committed builds (one query per page, at most 5,000 runs) and never stored, so a rule change applies to history at once and deletion has nothing to clean in ClickHouse.
- Observations, votes and fixes are Postgres rows that cascade from the workspace and the member. An observation is keyed by the moment, the transcript revision and the prompt version, so a new upload or a new prompt observes again and an old note is never shown for different text.
- Span text (already secret-filtered at ingest) goes to Anthropic only for workspaces with `moment_observations` on. That makes Anthropic a subprocessor for those workspaces, and the switch stays off until that is settled for a customer.

## Not built yet: derivations and a resident worker

Moments, run index builds, run question answers and git observations are each a derivation of an L1 generation, and each has its own queue, census, receipt and backfill. The next step is one derivation framework:

- **Declared derivations.** Each derivation declares its input (a session's committed transcript-records generation, or a run of it), its version, its output table and its cost class (pure SQL, in process, external model). The framework owns the receipt (`input generation × derivation version`), the census of what is missing or stale, retries, the deletion fence and backfill. A new derivation is a declaration and a function, not a new queue.
- **A resident worker.** Derivations run in one long-lived worker process beside the API rather than in cron-invoked functions, so that they can hold models' rate limits and budgets per workspace, run external-model derivations (observations made ahead of time where a workspace allows it, run questions) at a steady rate, and drain backfills without the 800-second function ceiling. Cron stays as the wake-up and census, not the executor.
- **Observations become a derivation.** Moments would be stored as a derivation of the run index, so patterns and the weekly digest can read them without recomputing. Observations would be made ahead of time for the workspaces that allow it, within their budget.

That is a change to how every derived table is built, so it gets its own ADR when it starts. This ADR only fixes the shape moments, observations and patterns should keep when it does: they are already keyed by generation and versioned the way a derivation needs.

## Revision: flags per run, workspace settings, one SubQ question

Moments became flags on runs. A team reads "this run was expensive, reverted work and ended with a frustrated reply" more easily than three separate moments, and a model reading a run should see all its flags at once. So:

- Compass lists **noticeable runs**: a run shows when at least one flag marks it, with every flag it has. Flags added since the first version: expensive and long runs (the range's top percent), edit churn, CI failed, git reverted, model apology. "Unhappy reply" became "User frustrated".
- Each flag can be turned off and its value changed per workspace (the settings button beside Compass's filters), because thresholds that suit one team flag everything or nothing in another. The defaults stay until the census (`audit:moments`) on real data says otherwise.
- **One SubQ question**, "Is the user frustrated?", about the member's prompt that follows a run, with the agent's last message. It reads a few hundred tokens, is answered once per prompt text and stored, and counts only where a workspace has the `frustration_check` switch. It is the narrow, cheap question SubQ answers well, unlike the whole-run run questions; everything else stays deterministic. Sending those prompts to SubQ makes SubQ a subprocessor for the workspaces that turn the check on.
- Observations are made per run, over the span from its first flag to its last, so earlier per-moment notes are no longer read.
