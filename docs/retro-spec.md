# Spec: team retros across many sessions and teammates

Linear: OPL-382.


## Problem Statement

Teams run retros on their coding-agent sessions to find what makes agentic engineering slow, expensive or wrong, and to fix their setup so the next run goes better. Today they do it with a local agent that reads raw transcripts (for example Matt Pocock's `/retro`). That retro reads one session of one person at a time, spends most of its tokens reading, cannot count or rank anything across the team, forgets the struggles from the middle of a session and fills the gap with generic advice, and cannot tell whether last month's fix worked.

Opaline already stores every member's uploaded sessions and the literal facts they record (L1), but an agent analysing them works through a narrow `find`/`read` interface whose fixed sources and groupings cannot keep up with retro questions, cannot see the setup a run ran under, cannot search by meaning, and can only open a run as a long digest. Members can read only their own sessions, so a team retro is an admin-only feature.

## Solution

An agent (in Claude Code or Codex through the Opaline MCP server, or Opaline's own agent on demand) runs a retro across many sessions and teammates by:

1. Ranking where the team lost the most with read-only SQL over one row per run that carries every countable fact (time, cost, tokens, searches, failures, denials, re-asks, frustration, skills, commits, PRs, CI) and the answers to run questions.
2. Searching transcripts by meaning and by exact string.
3. Opening only the runs that decide the question in the run view: compact by default, drillable by id down to the exact text it quotes, showing the setup the run actually received.
4. Proposing setup fixes against the exact setup file version the runs used, and saving the analysis so a later update compares before and after.

Every member reads every teammate's sessions and setup, because Opaline is how a team learns from all its sessions, never a performance check. Numbers come from facts; models answer only yes/no questions about meaning, and their answers only say where to read.

## User Stories

1. As a member, I want to ask "where did our agents lose the most time this month?" across the whole team, so that the retro covers everyone's runs, not only mine.
2. As a member, I want to read every teammate's sessions and setup, including personal setup, so that the team learns from all of its sessions.
3. As a member, I want answers to describe setups and patterns and never rank or single out people, so that the tool is trusted as a learning mechanism.
4. As an agent running a retro, I want one row per run with every countable fact, so that one SQL query ranks runs by impact.
5. As an agent, I want to choose the impact order (active time, cost, frustration, re-asks, runs, members) per question, and state which order I used, so that no fixed formula decides what matters.
6. As an agent, I want a group's time shown both as the time of the runs that contain it and the time of its own calls, so that I never present a 2-hour run as time lost to a 3-second call.
7. As an agent, I want approved measures (active time, cost, re-asks, frustration) defined once, so that two analyses never compute "time lost" differently and before/after comparisons hold.
8. As an agent, I want to learn the schema in steps (views, then one view's columns with meaning and traps, then a column's top values), so that I do not load the whole schema into context.
9. As an agent, I want to write read-only SQL over clean views that hide storage traps (several builds per session, generations, parser versions), so that my counts are not silently doubled.
10. As an agent, I want the workspace filter added by the server, so that I cannot read another workspace and never have to write it.
11. As an agent, I want SQL results capped per cell and in total, with a notice when something was cut, so that results stay small and cut rows are not mistaken for missing data.
12. As an agent, I want every SQL result to say it is not evidence and that runs must be opened, so that I never conclude from counts alone.
13. As an agent, I want SQL errors that point at the failing part and say whether and how to fix it, so that I recover without guessing.
14. As an agent, I want every SQL result stored with a title and an id, so that a saved analysis can point at it and a later update can rerun it.
15. As an agent, I want every view to say what is unknown (no system prompt, no setup snapshot, no GitHub link, not embedded yet), so that I report "unknown" instead of reading a gap as zero.
16. As an agent or member, I want to search transcripts by meaning ("agent couldn't find the billing file") and by exact string (`--legacy`, `#412`, `auth.spec.ts`) in one ranked result, so that both kinds of retro searches work.
17. As an agent, I want search results as run ids with snippets and why each matched, and an empty result to suggest a rewrite, so that I can open what matters.
18. As an agent, I want to call search inside SQL, so that I can combine it with filters, joins and impact.
19. As a member, I want a search box in the app over the same search, so that I can find past work across my team's transcripts.
20. As an agent, I want all transcript text searchable (prompts, agent text, tool calls and outputs, file contents, saved large tool outputs, CI logs, review comments, patches, commit messages), so that nothing that happened is unfindable.
21. As an agent, I want to open one run in a compact view showing its prompt, its totals, the previous run (prompt and how it ended), how it ended, the next prompt and the user's reaction, the skills used and offered, and its commit → PR → CI result, so that I understand it without reading the transcript.
22. As an agent, I want the run's phases (exploring, editing, running checks, git and CI, talking to the user) with requests, time, tokens and cost each, so that I see where the run went.
23. As an agent, I want an id on every line and to expand or collapse any list of ids within one character budget, so that I drill only into what decides the question.
24. As an agent, I want expanding a call or record to give its exact text, so that I can quote evidence.
25. As an agent, I want a call that started a subagent to expand into that subagent's run in the same view, so that delegated work counts as part of its parent.
26. As an agent, I want to ask for only some sections of the run view, so that I spend context only on what I need.
27. As an Opaline developer, I want the run view's sections and the phase rule to change by configuration and version, so that we can adjust the view as we learn what agents use, without changing data.
28. As an agent, I want the GIT line to open the failing CI job's log lines, its annotations and the PR's review comments, so that I see why CI failed and what reviewers flagged.
29. As an agent, I want the setup a run received (system prompt, instruction files, skill listing, skill bodies, MCP instructions), each tied to its setup file and setup file version, so that a "why" finding cites the exact file the run used.
30. As an agent, I want the same setup file recognised across teammates' machines (repository and path, plugin and path, or member and path), so that I can compare the version one member's failing run used with the version others use.
31. As an agent, I want uncommitted edits to a setup file treated as a version of that file and named after the member whose checkout holds them, so that local experiments are visible as such.
32. As an agent, I want setup the agent never receives as text (permission settings, hooks, CI and lint config, scripts) taken from the setup snapshot of that session, so that I can see a check that exists but is not connected.
33. As an agent, I want to see which skills were offered in a run and which were used, for Claude Code and Codex, so that I can find work done by hand that a skill already covered.
34. As an agent, I want each run's system prompt version, so that I can see what the harness told the agent and how it changed between versions.
35. As an Opaline operator, I want to add, edit, remove and test run questions on 20 runs in an internal form, so that only questions that answer well reach agents.
36. As an agent, I want the list of run questions with their tested precision in the schema, so that I know which to trust.
37. As an agent, I want an estimate of cost and quota before run questions are answered over the runs a SQL query selects, so that nothing is sent to the model provider without a known cost.
38. As an agent, I want run question answers stored as probabilities, versioned by wording, reused by later analyses and readable with SQL, so that thresholds can change without paying again.
39. As an agent, I want facts L1 already records exactly never asked as run questions, so that a model never guesses what the data knows.
40. As an agent, I want a task that reads many runs in parallel and returns only a short report of claims with run ids and record ids, so that my context stays small; it runs as Opaline's own agent on demand and works from Claude Code, Codex and Opaline's app alike.
41. As an agent, I want to search, open and open one stored result of earlier analyses through one tool with an explicit action, so that a retro starts from what the team already knows and updates it.
42. As an agent, I want each saved finding's cited runs stored with their cost, tokens and active time in a table I can query, so that later questions can sum what retros found and compare before and after.
43. As a member who deletes their account, I want every new kind of data about my sessions (embeddings, setup files, run question answers, GitHub evidence, stored SQL results, finding impact) deleted with it, so that deletion is complete within the promised 7 days.
44. As a member, I want analyses that returned any text from my deleted sessions, or whose findings cite my runs, deleted, and results that only counted my sessions among others (numbers and ids) removed but rerunnable, so that deleting one member does not delete the team's analyses and leaves nothing of what I wrote.
45. As an Opaline operator, I want per-query limits and per-workspace quotas for SQL and OpenAI spend, so that one analysis cannot exhaust ClickHouse or the budget.
46. As an Opaline operator, I want to size ClickHouse from measurements on our own workspaces before embedding customer history, so that the plan fits the data.
47. As a retro user, I want proposed fixes to name the setup that let the problem happen (a navigation pointer, a check, a standard for the reviewer, access the agent lacked, a skill or a skill update), so that the next run goes better.

## Implementation Decisions

Vocabulary is defined in `CONTEXT.md`: run, setup, setup snapshot, setup file, setup file version, received setup, re-ask, recurring request, impact, run question, run view, phase, request, call. Decisions are in ADR 0001 (amended), ADR 0002, ADR 0004 (every member reads every session) and ADR 0005 (agents query L1 with SQL). The architecture write-up is `docs/retro-architecture.md`.

Modules:

1. **Clean views and approved measures.** ClickHouse views at a stable grain: run, request, call, prompt, edge, CI job, job log, check annotation, commit status, commit, PR file, review comment, PR comment, setup file, run question answers, finding impact. They read only each session's committed build and generation. Approved measures (active time, cost, re-asks, frustration and the other impact measures) are defined once as views. Every view carries coverage columns that say what is unknown. Interim re-ask until OPL-381: a human prompt in the same session that the word list marks unhappy, right after a run whose agent said it was done.
2. **SQL gateway.** Accepts read-only SQL over the allowed views only, adds the workspace filter, runs as a read-only user with limits on time, memory and rows and per-workspace quotas, formats results as a compact table with cell and total caps, a "cut" notice and a "not evidence; open the runs" notice, classifies errors as recoverable (with the failing fragment and a fix) or fatal, and stores each result with its title, SQL and the sessions it covered.
3. **Phase cutter.** A pure function from a run's requests and a rule version to its phases, using the existing tool groups; a phase starts when the kind of work changes. Versioned; runs are re-cut when the rule changes.
4. **Requests in the run index.** Each run's requests (one model response and the calls it made) with time and tokens from usage. Tokens exist per request, not per call; calls carry duration only. Codex may record tokens per turn only; check before promising per-request tokens for Codex, and fall back to per-phase or per-run tokens.
5. **Setup file identity.** A pure function from a machine path and the session's context (repository root, plugin directory, member home) to a setup file identity; setup file version is the content hash, and uncommitted content is marked as uncommitted with the member's name.
6. **Received setup extraction.** Parser and backfill: system prompt (Claude Code prompt snapshot; Codex base instructions and developer messages), instruction files, skill listings for both agents, skill bodies and MCP instructions become received setup tied to setup file versions; each distinct text is stored once and referenced by hash. Setup the agent never receives as text comes from the session's setup snapshot. Raise the fact cap that cut 16 of 645 recent system prompt snapshots. Setup the transcript does not record is unknown, never filled in from disk.
7. **Run view renderer.** Renders any id (run, phase, request, call, record) with requested expansions and sections under one character budget. Default sections: header, PREV, END, NEXT, SKILLS, GIT, phases. Sections are configuration, each a small query over the same views SQL reads. Records give exact text. Replaces `read`.
8. **Embeddings and hybrid search.** All transcript text and all text from module 10, after the secret filter, chunked and deduplicated by content hash, embedded at upload with OpenAI-hosted `text-embedding-3-small`, stored in ClickHouse as short quantized vectors (about 512 dimensions, 8-bit). Search merges meaning and exact-string matches into one ranking (mode: hybrid by default, meaning, exact), returns run ids, snippets and why each matched, and is callable inside SQL.
9. **Run questions.** A question catalogue in Postgres, managed only by Opaline in an internal form (add, edit, remove, test on 20 runs). Yes/no only, answered as probabilities by SubQ Snap (Jev as a fallback), which is sent each run's full text after the secret filter (the compact run note when a run is larger than it takes). An estimate (cost, quota, already answered) before any answering, whose token answering requires. Answers stored in ClickHouse keyed by question version, run, transcript revision, provider and model version, reused across analyses. Answered for every new run of a workspace that has run questions, for every question that is on, shortly after the run is indexed (older runs by a paced backfill), so answers are facts agents filter with SQL; agents ask (default window the last 4 weeks) only for runs without answers.
10. **GitHub and capture evidence into ClickHouse.** Everything the GitHub evidence collector gathers except workflow artifacts: job logs, check-run annotations, check runs and suites, commit statuses, PR reviews and review comments, PR conversation comments, PR files with patches, commit details. Plus setup snapshot files and the large tool outputs Claude Code saves beside the transcript. Secret-filtered, joined to runs through the existing edges, backfilled from object storage.
11. **Every member reads everything.** Session visibility, analysis scope and session detail access let every member read every session and setup in the workspace. "Own sessions only, admins all" stays as a workspace option, switched off and not settable in settings. Restricting shared results to admins and the session's owner applies only with that option on.
12. **Analysis log.** Stores SQL results with their title, SQL and covered sessions. Account deletion deletes analyses with a result that returned text from the account's sessions or a finding citing its runs, and removes (keeping the query, without literals that may come from transcripts) results that only counted its sessions.
13. **MCP tools.** `schema(kind, view?, column?)`, `sql(query, title)`, `search(text, mode?, filters?)`, `run(id, expand?, sections?)`, `estimate_questions(questions, runs)`, `run_questions(questions, runs)`, `task(prompt)`, `answers(action, …)`, `save_answer`, `share_answer`. `task` runs Opaline's own agent on demand with read-only `schema`, `sql`, `search` and `run`, and returns only a report of claims with run ids and record ids; it works from Claude Code, Codex and Opaline's app. `find` stays until the plugin skill moves to SQL and gets no new sources; then `find` and `read` are retired.
14. **Retro playbook.** The plugin skill rewritten around these tools: earlier analysis first; SQL to rank by impact with approved measures; search; read the top 10 to 15 runs in the run view, in parallel through `task` when many; propose fixes in the setup that let each problem happen, against the setup file version the runs used; save; later updates compare before and after. It keeps: never conclude from counts or probabilities alone, never estimate savings, never rank people.
15. **Deletion coverage.** The account and workspace purge covers every new table.
16. **Finding impact.** On save, each finding's cited runs with their recorded cost, tokens and active time go to a table readable with SQL. Nothing is estimated.
17. **Capacity.** Measure storage and query speed per 1,000 runs on our own two workspaces, then size the ClickHouse plan. Backfills in order: received setup and requests, GitHub and capture evidence, embeddings of history; each detached and within ClickHouse limits.
18. **Search UI.** A search box in the app over module 8.

Prerequisites already known: `repository` is empty and `not_found` reads 0 on recent runs of our own data workspace, which has no edges yet (OPL-378); Claude Code skill listings were not found in recent numia records.

The privacy policy and the subprocessors page are updated for OpenAI embeddings of session text. ADR 0001 is amended accordingly.

## Testing Decisions

- Build with TDD at the module interfaces above; tests exercise external behaviour only (inputs to a module's interface, its outputs), never internals.
- Every automated test must earn its place: run the suite through a mutation-testing kill matrix and keep a test only if it kills a mutant no other test kills. The repo runs `bun test` and has no mutation tooling yet; the kill matrix needs each mutant run against tests one by one, so the tooling has to support per-test results.
- Modules tested: 1 (views and approved measures: one row per run against fixtures with several builds; coverage columns), 2 (SQL gateway: workspace filter, view allow-list, limits, caps and notices, error classes), 3 (phase cutter), 5 (setup file identity across machines, worktrees, plugins and home directories; uncommitted versions), 7 (run view: ids, expansion, sections, budget, exact text), 9's estimate, 11 (visibility), 15 (purge coverage of every new table).
- Prior art: run index column and component tests, the analysis SQL tests, the output ceiling tests, the visible sessions tests, the MCP tool tests, and the parser fixture tests.

## Out of Scope

- A retro evaluation harness (planted problems, local `/retro` against Opaline).
- A signal or detector catalogue; clustering; separate interpretation layers between the data and the agent.
- Answering run questions for every run at upload; open-ended run questions; run questions written or removed by workspaces.
- Estimating savings or pricing on savings; only the analysed runs' recorded numbers are kept (module 16).
- Typed slash commands starting runs and prompts sent before the agent replies (OPL-380); the full definition of a re-ask (OPL-381).
- Workflow artifacts.
- Agent modes.
- Reading a local checkout or local disk during an analysis.
- Ranking or comparing members; per-member performance views.
- Telling members at connect time that the team can read their sessions.

## Further Notes

- SubQ Snap (or Jev as a fallback) receives the full text of runs, secret-filtered, when run questions are answered; its data-retention and subprocessor terms must be checked before any customer workspace is answered.
- Branch `docs/retro-domain-language` holds `CONTEXT.md`, `docs/retro-architecture.md`, ADRs 0001 (amended), 0004 and 0005, and the legal page updates.
- Inspiration: PostHog's AI agent (staged schema, separate find and read with a "list is not evidence" warning, approved metrics before free SQL, hybrid search returning handles, estimate before model-backed scans, one-shot subagents returning reports).
