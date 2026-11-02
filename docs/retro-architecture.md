# Team retros across many sessions

Goal: a retro across a team's sessions that costs about a tenth of the tokens a local agent spends reading transcripts, and is more accurate: real counts, and every finding traced to runs. Terms are defined in `CONTEXT.md`.

A retro is: find where the team lost the most, understand why, propose a setup fix, and later check that it worked. Opaline makes each part cheap and leaves the thinking to the agent asking the question. There are no signals, clusters, embeddings or other layers between the data and the agent.

## The pieces

### 1. One row per run

Every run is one row with everything countable about it:

- **Facts** from L1: time, cost, tokens, searches, reads, failures, denials, re-asks, skills used, commits, pushes, PRs, and CI checked or not.
- **Run question answers**: the probability of yes for each run question (for example "Did the agent struggle to find the right file?"), answered by SubQ Snap (Jev as a fallback).

The agent answers "where did we lose the most, and on what" with one SQL query over this row.

### 2. Run questions

- Yes/no questions only, each answered as a probability. Open questions such as "what was the run trying to do" are not asked; a yes/no question per topic covers them.
- Opaline sets the questions in an internal settings form. Workspaces do not write or remove them.
- Each question can be tested on 20 runs before it is turned on.
- Answers are stored facts, bought when an agent (`run_questions`) or the internal form asks. Precomputing them for every new run (`precompute.ts`) and the history cron's backfill are paused; `backfill:run-questions` still answers past runs by hand. A rebuild or another upload of the same transcript pays nothing again.
- For runs without answers, the analysing agent can still pick questions and runs (default: the last 4 weeks) and sees the cost before they run; answering needs the estimate's token, so only what was priced is bought. Answers are kept and reused by later analyses.
- SubQ Snap answers (Jev, with the same API, as a fallback): each run is sent once with all its questions, as the run's full text after the secret filter; a run larger than the provider takes is sent as its compact run note, and each answer records which it read.
- An answer belongs to the transcript it was given for: once a session is uploaded again with changes, its runs are answered anew. Answers are kept per provider and model version, so providers can be compared on the same runs.
- Changing a question's wording makes a new question; old answers keep the wording they answered.
- Facts L1 already records exactly (CI not checked, denied calls, shell edits) never become run questions.
- An answer only says where to read. A finding needs the runs read.
- The dashboard shows the answers in a workspace whose runs are answered (`RUN_QUESTIONS_CUSTOMER_WORKSPACES`, else Opaline's own workspaces) and that is on the tags rollout (`RUN_QUESTION_TAGS_WORKSPACES`; unset, only Opaline's own workspace): a question answered yes (probability 0.5 or more) is a tag on the run in the session reader, matched to the reader's turn by the prompt's time, and on the session in the sessions list with the number of runs answered yes. Each question carries a short tag name set in the internal form; without one the tag shows the wording cut short. Other workspaces are told `enabled: false` and nothing is read.
- The Agent traces page (`analytics.sessions.agentRuns`), open only to the workspaces `AGENT_TRACES_WORKSPACES` lists (unset: nobody) or switched on in `/admin/features`, lists every run of the committed run index builds that started in the date range, newest first, with the newest answer per question and its probability. Its filter menu takes a confidence range (0–100%) per question that is on, any number at once, applied in ClickHouse to the newest answer for the run's committed revision, so a run without an answer to a filtered question is left out. Where the workspace's answers are not shown (same gate as the tags), runs are listed without answers and filters are ignored; members of an own-sessions-only workspace see only their own runs. Main-transcript runs fold out into the reader's waterfall, matched to the reader's turn by the prompt's time.

### 3. SQL for the agent

- Read-only SQL over clean views at a stable grain: one row per run, request, call, prompt, edge, CI job and received setup file. The views hide the storage traps (several builds per session, generations, versions).
- The workspace filter is added by the server; the agent never writes it.
- Schema is shown in steps: view names, then one view's columns with their meaning and traps, then sample values.
- Every query has limits on time, memory and rows. Results cap each cell and the total size, and say when something was cut ("cut rows are not missing data; aggregate or page").
- Errors point at the failing part of the query and say how to fix it.

### Tools

| Tool | What it does |
|---|---|
| `schema(kind, view?, column?)` | In steps: the views, then one view's columns with meaning and traps, then a column's top values. Also lists the approved measures and the run questions with their tested precision. |
| `sql(query, title)` | Read-only SQL to find, rank, count and compare. Each result is stored with an id and says "not evidence; open the runs with `run`". |
| `search(text, mode?, filters?)` | Hybrid search, by meaning (embeddings) and by exact string (keywords) merged into one ranking. Returns run ids, snippets and why each matched. `mode` = hybrid (default), meaning or exact. Also callable inside SQL as `search('…')` to combine with filters. |
| `run(id, expand?, sections?)` | The run view: read one run and drill by id; records give exact text to quote. |
| `estimate_questions(questions, runs)` | Cost and quota of answering run questions over the runs a SQL query selects. Sends nothing. |
| `run_questions(questions, runs)` | Answers them; answers are kept and read back with `sql`. |
| `task(prompt)` | Opaline's own agent, run on demand with read-only `schema`, `sql`, `search` and `run`, for parallel work such as reading 15 runs. Works from Claude Code, Codex and Opaline's app. Returns only a short report: each claim with its run id and the record id to quote. |
| `answers(action, …)`, `save_answer`, `share_answer` | Earlier analyses: search, open one, open one stored result; save and share. |

**Approved measures.** Active time, cost, re-asks, frustration and the other impact measures are defined once, as views, and every analysis uses them before writing its own SQL, so two analyses never compute "time lost" differently and before/after comparisons hold. Until OPL-381 settles what a re-ask is, the measure counts a human prompt in the same session that the word list marks unhappy, right after a run whose agent said it was done.

Taken from PostHog's agent: staged schema, separate find and read with a "list is not evidence" warning, approved metrics before free SQL, hybrid search returning handles, estimate before model-backed scans, and one-shot subagents that return a report rather than raw results. Not taken: modes, since Opaline has one domain.

### 4. The run view

One run, compact, drillable. The default:

```
run r_8f2 · "fix the failing login test" · 42 min · 410k tokens · $3.10
PREV   r_8f1 · "add rate limiting to login" → END "Done, added a limiter in auth.ts"
END    "Fixed! The test now passes."
NEXT   r_8f3 · user: "it still fails"  (unhappy)
SKILLS used: none · available: 14 (incl. "fix-tests", "ci-debug")
GIT    commit a1b2c3 → PR #412 → CI ✗ e2e (failed), lint ✓, unit ✓

id   what happened                              requests  time   tokens   cost
p1   explore: Grep×9, Glob×3, Read×9                14    6 min   88k    $0.61
p2   edit: Edit×2 (auth.ts)                          2    1 min   12k    $0.09
p3   test loop: bun test×4 (3 failed)                9   31 min  290k    $2.20
p4   final answer                                    1    0 min    9k    $0.07
```

- Levels: run → phase → request → call → record. Every line has an id; the agent expands or collapses any list of ids under one character budget.
- Tokens and cost exist per request, not per call; calls show their duration only.
- A call that started a subagent expands into that subagent's run, in the same view.
- A record's own id from a Claude Code transcript (the `uuid` of its JSONL line, `transcript_records.record_uuid` from parser 12) opens the run that holds the record, with the record expanded and a first line naming its session, stream, record and run number. Sessions indexed before parser 12 keep no record ids: unknown, not missing.
- Setup lines open the exact text the agent received (skill, instructions) with its setup file and version.
- **The view is malleable.** It is a list of sections, each a small query over the same views the agent can query with SQL, plus a one-line format. The default sections change by config, with no data change; the agent can ask for only some sections; the phase rule is versioned and runs are re-cut when it changes.

### 5. The retro playbook

The plugin skill, rewritten around SQL and the run view:

1. Look for an earlier analysis of the same question; if there is one, update it.
2. SQL: rank where the team lost the most. The agent picks the order (time, cost, frustration, re-asks, members) and says which it used. Group time is shown two ways: the runs that contain it and its own calls.
3. Read the top 10 to 15 runs in the run view, expanding only what decides the question.
4. Propose a fix per finding in the setup that let it happen, against the setup file version the runs used: a navigation pointer, a check, a standard for the reviewer, access the agent lacked, a skill, or a skill update.
5. Save. A later update of the same analysis compares before and after.

## Additions to the data stack

| Addition | Why |
|---|---|
| Clean SQL views over `run_index` and the other L1 tables | The agent cannot be trusted to know storage traps |
| Requests with their time and tokens; phases | The run view's middle levels |
| Received setup: the text the agent got, tied to setup file and version, uncommitted edits named after the member | "Why" findings and fixes point at the exact file the run used |
| Skills offered per run, as a list, for Claude Code and Codex | "A skill existed and was not used" |
| All GitHub evidence the collector gathers, from R2 into ClickHouse, except workflow artifacts: job logs, check-run annotations, check runs and suites, commit statuses, PR reviews and review comments, PR conversation comments, PR files with patches, commit details. Secret-filtered, embedded, joined to runs through the edges | Why CI failed, what tools and reviewers flagged on agent PRs, which files agent work touched |
| Setup snapshot files (instructions, skills, settings, file list, uncommitted diffs) and the large tool outputs Claude Code saves beside the transcript, from object storage into ClickHouse | Setup the agent never received as text; complete text for embedding and exact quotes |
| Run question answers | Meaning that facts cannot give |
| The system prompt in effect for each run, stored once per distinct version and referenced by hash, as part of received setup (Claude Code `prompt_snapshot`, Codex base instructions and developer messages); raise the fact cap that cut 16 of 645 snapshots | The run view and "why" findings show exactly what the harness told the agent; diffs between versions |
| Embeddings of all transcript text after the secret filter: prompts, the agent's text, tool calls and outputs, file contents. Chunked, deduplicated by content hash (a file read 30 times is embedded once), stored in ClickHouse as short quantized vectors (about 512 dimensions, 8-bit) because full vectors for one heavy user's history alone would be around 45 GB. Computed at upload | People and agents search transcripts by meaning |
| Every member reads every session (ADR 0004) | Team retros need everyone's runs |
| Finding impact: when an analysis is saved, each finding's cited runs with their cost, tokens and active time, in a table the agent can query with SQL | The cost of what retros found, for later before/after questions and the case for pricing. Nothing is estimated: only the analysed runs' recorded numbers |
| Coverage columns on every view: no system prompt, no setup snapshot, no GitHub link, not embedded yet | The agent says "unknown" instead of reading a gap as zero |
| Every new table (embeddings, setup files, run question answers, GitHub evidence, stored SQL results, finding impact) covered by the account and workspace purge | The privacy policy promises deletion within 7 days |
| A search box in the app over the same hybrid search | People search their team's transcripts, not only agents |

Gaps seen in production while checking this (2026-10-12): `repository` is empty and `not_found` is 0 on recent runs of the Evren+data workspace, which also has no edges yet (OPL-378); Claude Code skill listings were not found in recent acme records.

## Capacity and backfills

- Every SQL query runs as a read-only user with limits on time, memory and rows; each workspace has quotas for SQL and for OpenAI spend.
- Size ClickHouse by measuring first: embed our own two workspaces (deduplicated, quantized), measure storage and query speed per 1,000 runs, then pick the plan. Storing vectors outside ClickHouse would add a provider and a second system.
- Backfills, in order: received setup and requests (parser bump), GitHub and capture evidence from object storage, embeddings of history. Each runs detached and within the ClickHouse limits.
- Codex may record tokens per turn rather than per model request; if so, Codex requests show time and its tokens are shown per phase or run. Check before the run view promises tokens per request for both agents.

## Open

- In the backlog: typed slash commands starting runs, and prompts sent before the agent replies (OPL-380); the exact meaning of a re-ask (OPL-381).
- Run questions send the full text of runs (secret-filtered) to SubQ Snap, or Jev as a fallback, which ADR 0001 did not cover (it allows only analysis titles to leave the stack); check the provider's data-retention and subprocessor terms before any customer workspace is answered.

Decided: embeddings are computed by OpenAI-hosted `text-embedding-3-small` (privacy policy and subprocessors page updated); agents query L1 with SQL (ADR 0005); everyone reads every session (ADR 0004), with ADR 0001 adapted to both.
