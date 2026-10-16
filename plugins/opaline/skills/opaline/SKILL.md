---
name: opaline
description: "Analyse a team's uploaded coding-agent sessions with Opaline to improve its agent setup: where agents get stuck, fail or waste time and money, recurring mistakes, cost, and earlier saved answers. Use only for questions that analyse those sessions, or to show the Opaline dashboard. Do not use for Opaline product support, account or billing questions, general coding help, or actions Opaline does not offer."
---

# Opaline

Opaline helps a team run retros on its coding-agent sessions: find where the agents lost the most, read the runs that show why, and fix the setup that let it happen (instructions, skills, docs, scripts, hooks, lint and CI config). Answers are about setups, never a judgement of people. Don't single out or rank people in answers; describe team patterns and setup fixes.

**Scope.** Use this skill only for questions that analyse the team's uploaded sessions and for showing the dashboard. It does not cover Opaline product support, account or billing questions, unrelated coding help, or actions Opaline does not offer (deleting sessions, changing plans, reaching other workspaces); say so plainly and point to opaline.so where it helps.

**Answer only from Opaline.** Every fact comes from the Opaline tools. Never read local files, the working directory or git state to work out what the user means, and never run shell commands; take repository names from the `repository` column or the dashboard, and ask the user if it is still ambiguous. Never read raw transcripts run by run: Opaline counts, ranks and finds, and you open only the runs that decide the question.

Every member sees every member's sessions in the workspace, personal setup included: a team retro needs everyone's runs. That access is for learning from the sessions; findings still name setups, not people. `user_id` columns are for telling a team-wide pattern from one setup's, never for ranking members. For one person's numbers, point to the dashboard's member view.

No tool changes or deletes sessions. `sql` (and `find`/`read`) record their calls in a private draft of the current answer, which only `save_answer` publishes; `share_answer` shares a saved answer. Hosts may ask the user once to allow these; "always allow" is fine.

**Call `schema` first.** Before any other analysis tool, call `schema` once with no arguments. If `schema` is not among your tools, or it answers that the retro tools are not enabled for this workspace yet, do not call `sql`, `search`, `run`, `estimate_questions` or `run_questions` in this conversation: follow "Classic flow (find and read)" below instead. Otherwise follow the retro playbook.

## Tools

- `answers` (read-only): earlier analyses. `action=search` (`text`, or none for the most recent), `action=open` (`analysis`: its steps, findings, stored result ids, cutoff = the last day its data covers), `action=result` (`id`: one stored result, an sql result `sr_…` included; says when it is stale or unavailable).
- `schema` (read-only), in steps: no arguments lists the views, the **approved measures** and the run questions with their tested precision; `view=` gives that view's columns with meaning and traps; `view=` + `column=` gives the column's 20 most common values over the last 30 days. Call it once per analysis, then for each view you query.
- `sql`: one read-only `SELECT` (or `WITH … SELECT`) over the views `runs`, `calls`, `events`, `prompts`, `git_events`, `edges`, `ci_jobs`, `session_links`, `finding_runs`, `run_answers`, with a short `title`. The server adds the workspace: never filter by it. Up to 200 rows, cells cut at 300 characters, 10 seconds and 512 MiB per query, and a workspace quota that `run` counts in too; a query refused for memory or rows read is refused for good, so narrow it instead of retrying. Each result is stored (`sql result=sr_…`) and ends with a "not evidence" notice: rows say where to look, never why. Errors say `error, recoverable` with the failing part and a fix, or `refused, do not retry`. The last line is `trace analysis=<id> step=<id> query=<id>`.
  - `search('text'[, 'hybrid'|'meaning'|'exact'[, days]])` is a table inside sql (columns run_id, user_id, session_id, agent_id, turn_idx, started_at, score, why, snippet; up to 200 runs; at most 3 per query): join it to `runs USING (run_id)` to filter and rank matches by impact.
  - `events` has a run's API errors, retries, refusals, stop hooks, compactions and notices, one row each with its `record_idx` and time `at`, so a run's time can be split around them; per run they add up to the `runs` counts (`api_errors`, `retry_attempts`, `refusals`, `hook_count`, `compactions`).
  - `calls`, `events` and `prompts` must keep their time range in their own `WHERE` (`started_at >= …` for calls, `at >= …` for events and prompts, joined with `AND`), or every session is read and the query may hit the limits. Command text reads a lot: about a week of a busy workspace fits, a month may not.
  - `session_links` has one row per link between two sessions (`from_session_id` → `to_session_id`; `kind` parent_thread, fork or delegation; `basis` says what recorded it): join it to `runs` at both ends to follow a task across a Codex subagent thread, a fork or one agent starting the other, or to credit a fix made in another session. A resumed session keeps its session_id, so it needs no link.
  - Never alias a result with a column's name (`sum(cost_usd) AS cost_usd`): ClickHouse then reads the alias wherever the query names that column, and the query fails or counts the wrong thing.
  - `setup_snapshots` is what each session evidence capture found on the member's machine, one row per capture and item: instruction, skill, memory, command and config files with their hash, each hook, permission rule, MCP server, plugin and setting of each settings file, and runtime versions. `setup_item` names a file as `setup_files.setup_file` does. Use it to date a setup change (consecutive captures of a member) and to split runs by whether their session started with it (`lifecycle = 'start' AND at_session_time`; a capture with `at_session_time` false is a later sweep).
- `search` (read-only): runs by meaning and exact string in one ranking (`text`; `mode` hybrid, meaning or exact; `filters` since, until, source, kinds; 30 days by default, at most 180). Returns up to 20 runs with run_id, why each matched and a snippet, coverage (sessions not yet indexed are unknown, not absent), the OpenAI quota and a rewrite to try when nothing matched. Not recorded in the draft: to keep matches as evidence, use `search('…')` in sql.
- `run` (read-only): one run, compact. `id` is a run_id from sql or search, or a PREV/NEXT/subagent id the view shows. Default sections: the header (prompt, minutes, tokens, cost), PREV (the run before and how it ended), END (how this one ended), NEXT (the user's next prompt and its reaction) and the phases (exploring, editing, running checks, git and CI, talking to the user) with requests, time, tokens and cost. `expand` takes up to 20 ids: a phase `p2` opens its requests, a request `q153` its calls, a call `c154` or record `r160` its exact text, and a call that started a subagent opens that subagent's run. `sections` keeps only some (header, prev, end, next, phases); `maxChars` 1000-40000, default 12000. Rows of `calls`, `events` and `prompts` carry `record_idx`: expand it as `r<record_idx>` to quote it.
- `run_answers` and run questions: where the workspace has run questions, every run is answered for every yes/no question that is on (listed by `schema`, with tested precision) as the probability of yes, by SubQ Snap, within minutes of being indexed and older runs by a backfill: filter and rank with sql over `run_answers` (one `provider`), no wait or cost. A run without a row is not answered (yet), which is not no. Only for runs without answers, `estimate_questions` (sends nothing) gives the runs a `runs` SELECT returns (`session_id, agent_id, turn_idx`; default every run of the last 4 weeks; at most 5,000), the answers already stored (reused, free), the most it can cost, the quota left and a token; `run_questions` takes the same questions (up to 10 ids), the same `runs` and that token within 15 minutes, and sends each run's text, secrets removed, to the answering service. Answers arrive within minutes in `run_answers`.
- `save_answer`, `share_answer`: see "Save" below.
- `get_dashboard` shows the dashboard in the chat (cost by default; sessions, signals, agent runs, merged pull requests, CI failures per pull request). `list_workspaces` lists the user's workspaces and slugs, `default: true` on the one tools use.
- `find` (fixed sources such as `source=weekly` nightly week totals) and `read` (runs by `{sessionId, agentId, turn}`, `depth=record` for exact text): fallbacks when `run` says a run's requests are not indexed yet or a question needs what only they show, and the whole flow where the retro tools are not enabled (see "Classic flow (find and read)"). The older names `search_answers`, `get_answer` and `get_answer_evidence` are `answers` actions.

## The retro playbook

Every analysis question goes through these steps, in order. Dashboard requests skip them.

1. **Earlier analysis.** `answers action=search` with the question's words. If one covers it, `answers action=open` and say its findings and cutoff in one sentence; this analysis updates it.
2. **Rank where the team lost the most.** With the views and measures `schema` listed (call it again with `view=` for each view you query), `sql` with the approved measures (`active_time`, `cost`, `tokens`, `runs`, `members`, `re_asks`, `frustration`, `group_run_time`, `group_call_time`), never your own version of them. Pick the impact order that fits the question (active time, cost, frustration, re-asks, runs, members) and state it. Show a group of calls' time both ways: the runs that contain it (`group_run_time`) and its own calls (`group_call_time`); neither is "time lost" until those runs are read. The time window the user asked for wins (default: the last 30 days); compute every total over the whole window, also in updates.
3. **Find by topic.** When the question names a topic, flag, file or error, use `search` or `search('…')` in sql.
4. **Run questions.** For meaning facts cannot give ("did the agent struggle to find the file?"), rank with sql over `run_answers` (one `provider`): answers to the questions that are on are already there. Only if the runs you need have no answers, `estimate_questions` over a SQL-selected set, state the cost and runs, then `run_questions` if worth it. A probability only says where to read.
5. **Read the top 10-15 runs** with `run`, expanding only the phases, requests and records that decide the question, and quote exact records (`r…`). Say "read N of M". Unread runs stay "not attributed".
6. **Propose a fix** in the setup that let each problem happen, quoting the setup text the run received where it matters (`prompts` with `kind = 'injected_context'`, subtype `agents_md`, `skill_body`, `system_instruction`). Name the fix type:
   - **navigation pointer**: a line in the instructions or a doc that says where something lives;
   - **automated check**: a lint rule, type, test, hook or CI step that catches the mistake;
   - **reviewer standard**: a rule the reviewer (person or review agent) checks when it cannot be automated;
   - **slim the instructions**: cut instructions that are long, contradictory or ignored;
   - **streamline a tool**: a script or command agents keep fighting (flags, output, defaults);
   - **delete no-op steering**: instructions the runs show change nothing;
   - **widen access**: a permission, credential, service or MCP server the agent lacked;
   - **skill / skill update**: a recurring request done by hand, or a skill whose text is outdated.

   State the fix channel honestly: instructions and skills may reduce a problem, never guarantee; a check, hook, script, doc or config is a mechanism; taste iterations and model limits are not fixable. Say how to re-check each finding.
7. **Save**, then answer (below). A later update compares before and after: recompute the same measures over the new window and sum the earlier findings' runs from `finding_runs`.

Ask once, after the first `sql` and before reading, when the window, the order or the scope is ambiguous: offer options with real counts and mark a default. If the user said "just do it" or nobody can answer (a scheduled run), use the defaults and state them on the first line.

Never:
- conclude from counts, probabilities or search hits alone;
- extrapolate from the runs read to the unread ones;
- compare rates between groups ("2.7% vs 1.5%"); the same team's rate before and after a fix, over the runs that record the fact, is a trend;
- estimate savings or invent numbers;
- single out or rank people.

Unknown is not zero: say what is unknown (NULL facts and `unrecorded_facts`, `coverage_gaps` such as `github_link` or `setup_snapshot`, unpriced runs, sessions search has not indexed, cut results) and the coverage behind each number.

## Save and answer

- The first `sql` leaves out `analysis` and starts a draft; pass `analysis` from the trace line to every later `sql`.
- Before saving, give each finding a `sql` step whose rows are exactly the runs it rests on, with `session_id, agent_id, turn_idx` (for example the runs you read that showed it): `finding_runs` then records their cost, tokens and active time, which later updates compare.
- `save_answer` once: `analysis`; `question`, a short title (not the user's words, no personal data, up to 120 characters, such as "Where our agents lost time"); `finalAnswer`, complete; `findings`, one per step, each `{step, finding}` naming a step or query id from a trace line; up to 8 `topics`. Updating an earlier answer: also `updates` = its id and `changes`, one `{step, change, evidence}` for every finding saved now (`confirmed`, `strengthened`, `weakened`, `new`) plus a `dropped` item, with a step id of the earlier answer, for each earlier finding that no longer holds. A refused save saves nothing: fix it and save again. A saved answer never changes; to revise it, start a new draft and save it with `updates`. Reuse an earlier finding's runs only after `answers action=result` shows its stored result is still available and not stale; read new runs only after its cutoff.
- `share_answer` only when the user asks, right after saving. Tell the user first: Sharing shows the answer, its findings and the stored results behind it (which can include short excerpts from the sessions that were read) to members of your workspace; a workspace limited to own sessions may show those results only to admins and the session's owner.
- Your last message is the saved final answer, complete (callers often see only the last message). Lead with the answer and its evidence (run ids, short quotes), the window, the impact order and the coverage. For an update add "updated from the earlier answer '<title>' (data up to <cutoff>)". If you shared, add one line from the actual `share_answer` result.

## Worked examples

Dates are made up: the window is 2026-09-12 to 2026-10-12, so a range ends `< '2026-10-13'`. Every example starts with `answers action=search` and ends with the save above.

**"Where did our agents lose the most time this month?"** `schema`, then rank by active time (stated), with cost, frustration, re-asks and members beside it:

```sql
SELECT repository, count() AS runs, round(sum(active_minutes)) AS active_min,
  round(sum(cost_usd), 2) AS usd, countIf(cost_usd IS NULL) AS unpriced,
  countIf(frustrated) AS frustrated_runs, countIf(reasked) AS reasked_runs, uniqExact(user_id) AS members
FROM runs
WHERE started_at >= '2026-09-12' AND started_at < '2026-10-13'
GROUP BY repository ORDER BY active_min DESC LIMIT 20
```

Then the longest runs of the top repository, to read:

```sql
SELECT run_id, session_id, agent_id, turn_idx, round(active_minutes) AS active_min,
  cost_usd, failed_calls, not_found, frustrated, prompt_head
FROM runs
WHERE started_at >= '2026-09-12' AND started_at < '2026-10-13'
  AND repository = 'web-app' AND agent_id = ''
ORDER BY active_minutes DESC LIMIT 15
```

`run id=<run_id>` for each; where a "running checks" phase dominates, `expand=["p3"]`, then the failing request and the record with the error. Finding: "9 of the 15 runs read spent most of their time in a test loop on e2e tests that need a running server; the setup never says how to start it. Fix: navigation pointer in the instructions plus a script (mechanism)."

**"Which commands keep failing, and what do they cost?"** A week of calls, grouped:

```sql
SELECT command_prefix, count() AS calls, countIf(failed = 1) AS failures,
  round(sum(call_minutes)) AS call_min, uniqExact(run_id) AS runs,
  uniqExact(user_id) AS members, any(command) AS example
FROM calls
WHERE started_at >= '2026-10-06' AND started_at < '2026-10-13' AND command_from = 'command'
GROUP BY command_prefix ORDER BY failures DESC LIMIT 20
```

The top group's time both ways: `group_call_time` is `call_min` above; `group_run_time`:

```sql
SELECT count() AS runs, round(sum(active_minutes)) AS run_min
FROM runs
WHERE run_id IN (SELECT run_id FROM calls
  WHERE started_at >= '2026-10-06' AND started_at < '2026-10-13'
    AND command_prefix = 'bun test' AND failed = 1)
```

Read the runs before calling any of it time lost; the fix is usually an automated check or a streamlined tool.

**"What could have been a skill?"** Recurring requests across sessions and members:

```sql
SELECT lower(substring(text, 1, 50)) AS opening, count() AS prompts,
  uniqExact(session_id) AS sessions, uniqExact(user_id) AS members
FROM prompts
WHERE at >= '2026-09-12' AND at < '2026-10-13' AND genuine = 1
GROUP BY opening HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 30
```

For a recurring kind of request, find its runs by meaning and rank them by time, with the skills each used:

```sql
SELECT r.run_id, r.session_id, r.agent_id, r.turn_idx, round(r.active_minutes) AS active_min,
  r.skills, r.reasked, s.why
FROM search('prepare the release notes from merged pull requests', 'meaning', 30) AS s
JOIN runs AS r USING (run_id)
WHERE r.agent_id = ''
ORDER BY r.active_minutes DESC LIMIT 15
```

Read the top runs: the same steps done by hand in several members' runs, with no skill used, is a **skill**; re-asks after "done" point at missing know-how.

**"Which skill is outdated?"** Runs per skill used, ranked by frustration (stated):

```sql
SELECT arrayJoin(skills) AS skill, count() AS runs, round(sum(active_minutes)) AS active_min,
  countIf(frustrated) AS frustrated_runs, countIf(reasked) AS reasked_runs,
  sum(failed_calls) AS failures, uniqExact(user_id) AS members
FROM runs
WHERE started_at >= '2026-09-12' AND started_at < '2026-10-13'
GROUP BY skill ORDER BY frustrated_runs DESC LIMIT 20
```

Then the skill text those runs received, to quote and compare versions:

```sql
SELECT run_id, session_id, agent_id, turn_idx, record_idx, at, text_chars, substring(text, 1, 120) AS head
FROM prompts
WHERE at >= '2026-09-12' AND at < '2026-10-13' AND kind = 'injected_context'
  AND subtype = 'skill_body' AND positionCaseInsensitive(text, 'deploy') > 0
ORDER BY at DESC LIMIT 20
```

`run` the frustrated runs and expand `r<record_idx>` for the exact skill text; a step that names a script or path that no longer exists is a **skill update**.

**"How can I make files easier to find for the agent?"** Navigation facts per repository (`not_found` is NULL where it cannot be recorded, such as Claude Code subagents; report those as unknown):

```sql
SELECT repository, count() AS runs, sum(searches) AS search_calls, sum(not_found) AS not_found_calls,
  countIf(not_found IS NULL) AS not_found_unknown, round(sum(active_minutes)) AS active_min
FROM runs
WHERE started_at >= '2026-09-12' AND started_at < '2026-10-13'
GROUP BY repository ORDER BY not_found_calls DESC LIMIT 20
```

The paths agents keep missing:

```sql
SELECT file_path, count() AS calls, uniqExact(session_id) AS sessions, uniqExact(user_id) AS members
FROM calls
WHERE started_at >= '2026-10-06' AND started_at < '2026-10-13' AND file_path != '' AND failed = 1
GROUP BY file_path ORDER BY sessions DESC LIMIT 20
```

Add `search` text "the agent could not find the file it needed" for runs the facts miss, then read the exploring phases (`expand=["p1"]`). Fixes: a **navigation pointer** (where things live), or **slim the instructions** when the pointer exists but is buried.

**"Did the fix we shipped on 2026-09-21 work?"** The earlier answer's findings and their runs:

```sql
SELECT step_id, any(finding) AS finding_text, count() AS cited_runs,
  round(sum(active_minutes)) AS active_min, round(sum(cost_usd), 2) AS usd
FROM finding_runs
WHERE analysis_id = 'an_123'
GROUP BY step_id
```

The same measure per week, before and after, over the runs a member answers (the definition `schema` gives for rates):

```sql
SELECT toMonday(started_at) AS week, count() AS runs, countIf(frustrated) AS frustrated_runs,
  countIf(reasked) AS reasked_runs, round(sum(active_minutes)) AS active_min
FROM runs
WHERE started_at >= '2026-08-17' AND started_at < '2026-10-13'
  AND agent_id = '' AND ifNull(thread_source, '') != 'subagent'
GROUP BY week ORDER BY week
```

When the fix is in the setup (a hook, a permission rule, a skill, an instruction), split by whether each session started with it rather than by date, since members pick it up at different times. Runs whose session has no start capture are unknown (`coverage_gaps` has `setup_snapshot`), not without the fix:

```sql
WITH started AS (
  SELECT user_id, session_id,
    countIf(kind = 'hook' AND name = 'PreToolUse' AND value LIKE '%guard.sh%') > 0 AS has_guard
  FROM setup_snapshots
  WHERE lifecycle = 'start' AND at_session_time AND captured_at >= '2026-08-17'
  GROUP BY user_id, session_id
)
SELECT has_guard, count() AS runs, countIf(frustrated) AS frustrated_runs,
  round(sum(active_minutes)) AS active_min
FROM runs INNER JOIN started USING (user_id, session_id)
WHERE started_at >= '2026-08-17' AND started_at < '2026-10-13'
  AND agent_id = '' AND ifNull(thread_source, '') != 'subagent'
GROUP BY has_guard
```

Read a few runs after the fix to check the cause is gone, not only the count. For run questions on the same runs: `estimate_questions questions=["<id from schema>"] runs="SELECT session_id, agent_id, turn_idx FROM runs WHERE …"`, say the cost, then `run_questions` with the token.

## Classic flow (find and read)

Where `schema` is not among your tools or says the retro tools are not enabled for this workspace, answer with `find` and `read`. `save_answer`, `share_answer`, `get_dashboard` and `list_workspaces` work as above; for earlier answers use `answers`, or where it is not among your tools its older names `search_answers` (search), `get_answer` (open) and `get_answer_evidence` (one stored result). Findings name the `find` and `read` steps from their trace lines.

**`find`: where something happened.** Cheap and deterministic: call it before `read`. It says *where*, never *why*. `source` picks what to look at:

- `source=runs`: one row per run (one prompt and the agent's work until the next): ref, startedAt, minutes, activeMinutes (gaps over 5 minutes left out), costUsd, model, repository, agent, edits, toolCalls, failedCalls, readCalls, searchCalls, notFound (null where it cannot be recorded, never 0), nextReaction, rawChars, parentSessionId, promptHead. `groupBy=week|model|repository|agent|session` gives totals; `refs=[…]` returns exactly those runs with their summed minutes and cost (price the runs you read); `sort=startedAt|minutes|costUsd|failedCalls|rawChars`; `latest=N` keeps the newest N sessions.
- `source=tool`: failed tool calls grouped by tool group, kind, cause and detail, with example refs. Kinds: friction (a hook or policy blocked it), mistake (wrong path, stale patch, bad flag), validation (tests, types, lint or build), environment (missing tool or service), noise (expected failures, hidden unless `includeNoise`), other. Filter with `toolGroup`, `commandClass`, `kind`, `cause`, `detail`.
- `source=user`: unhappy prompts (`reaction=negative`), strongly worded ones (`reaction=swear`) and agent apologies (`reaction=apology`), each with the origin run that caused it. Word-list candidates: read before concluding.
- `source=git`: commits, pushes, PR links and CI status reads, with the pull requests and CI runs GitHub links to them and whether CI was checked after a push; `pullRequest=owner/name#133` gives the sessions that touched that pull request. Null counts and unlinked statuses are unknown, not zero.
- `source=calls`: shell commands, Codex scripts and written script files with their `argv0`, `prefix`, `fingerprint` and `simhash`; `groupBy=commandFingerprint|commandArgv0|commandPrefix` counts calls, sessions and failures per key. Check a group's examples before calling them the same command.
- `source=weekly`: totals per ISO week, member and agent from a nightly snapshot, months in one call, for trends and before/after checks; `groupBy=week|member|agent`. Compare a fact over its known runs (`deniedCalls / deniedCallsKnownRuns`), never the raw count; the newest week is partial.

Filters: `from` and `to` (UTC days; totals and rankings cover the whole window), `repository`, `agent`, `model`, `sessionId`. The header gives coverage, cost and unpriced runs: repeat them. Paging: `limit` 1-200 (default 50, 20 for `source=tool`); when the header has a `more: pass cursor=…` line, call `find` again with the same arguments plus that `cursor`, and don't split the date range into many calls. The last header line is `trace analysis=<id> step=<id> query=<id>`.

**`read`: what actually happened.** Reads 1-10 runs by ref under one `maxChars` budget (default 12000, max 40000); `[cut]` marks what was left out. A ref is `{sessionId, agentId, turn}`: `agentId` `''` is the main transcript, `turn` starts at 1.

- `depth=exchange` (default): the prompt, files edited, checks after the last edit and their outcome (still running is no pass), failed calls with their error, subagent threads, the final message and how the next prompt reacted.
- `depth=turn`: every record of the run, compact, with record numbers.
- `depth=record`: the exact text of one record (`record`, optionally `block`, `fromChar`, `toChar`), to quote as evidence.

Never reconstruct a whole session run by run; subagent runs and Codex subagent threads are part of their parent's work.

**The analysis cycle.**

1. **Earlier answer.** `answers action=search`; if one covers the question, `action=open` and say its findings and cutoff in one sentence; check a finding you reuse with `action=result`.
2. **Plan.** The window the user asked for wins (default: the last 30 days); compute totals fresh over the whole window; with an earlier answer, read new runs only after its cutoff.
3. **Evidence.** `find` for the right source (the first call starts a draft; pass `analysis` from the trace line to every later `find` and `read`), then `read` the runs that decide the question, up to 15 per pattern, and say "read N of M". Price what they showed with `find source=runs refs=[…]` and rank patterns by time and cost, not by count.
4. **Save and answer** as in "Save and answer", then propose setup fixes as in the playbook.

Ask once, after the first `find` and before any `read`, when the window, the order or the scope is ambiguous. The "Never" rules above apply unchanged.

## Conventions

- Dates are UTC `YYYY-MM-DD`. Resolve "this month" and "last week" to explicit dates and say which range you used.
- Every tool works in one workspace: without `workspace`, the default in the plugin settings, else the one the user last opened. If results look empty, call `list_workspaces` and pass the slug.
- Cost is estimated API cost in USD; NULL cost is unpriced or unknown, never free: say how many runs.
- Subagent runs (`agent_id` not empty, or a Codex thread with `thread_source = 'subagent'`) are part of their parent's work, never separate work.
- If a tool refuses a read or says the quota is used, say so instead of retrying.

## When there is no data

If `list_workspaces` shows `sessionsLast365Days: 0` or the views hold no runs, there are no sessions to analyse yet. Tell the user to open https://opaline.so, sign in and follow the steps there to connect their coding agents; each teammate connects their own. Then check again with `list_workspaces`. Don't run any commands for them.
