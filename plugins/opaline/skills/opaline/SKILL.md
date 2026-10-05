---
name: opaline
description: "Analyse a team's uploaded coding-agent sessions with Opaline to improve its agent setup: where agents get stuck, fail or waste time and money, recurring mistakes, cost, and earlier saved answers. Use only for questions that analyse those sessions, or to show the Opaline dashboard. Do not use for Opaline product support, account or billing questions, general coding help, or actions Opaline does not offer."
---

# Opaline

Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup: instructions and skills, docs, scripts, hooks, lint and CI config. Answers are about the setup, never a judgement of people. Don't single out or rank people in answers; describe team patterns and setup fixes.

Opaline stores the team's uploaded coding agent sessions. No tool changes or deletes sessions. Analyses are written only by `find` and `read` (they record what they looked at in a private draft of the current answer, an "analysis"), `save_answer` (it publishes that draft once) and `share_answer` (it shares a saved answer). The plugin's own default-workspace setting is changed only from the plugin settings page, never by you. Hosts may ask the user once to allow `find`, `read`, `save_answer` and `share_answer`; the user can choose "always allow".

**Scope.** Use this skill only for questions that analyse the team's uploaded coding-agent sessions (cost, time, failures, mistakes, earlier answers) and for showing the dashboard. It does not cover Opaline product support, account or billing questions, unrelated coding help, or actions Opaline does not offer (deleting sessions, changing plans, reaching other workspaces); for those, say so plainly and point to opaline.so where it helps.

Opaline answers by updating earlier answers. Each saved analysis keeps its findings, the exact evidence behind them (the `find` and `read` calls with their results) and the last day its data covers (its cutoff). A new question on the same topic updates it with only the evidence since that day instead of redoing it. A saved analysis never changes: an update is a new analysis that names the earlier one with `updates` when it is saved.

`find` and `read` take only what they need to look up runs, plus `analysis` (the draft's id). They never take the user's question or your sub-questions: each call becomes its own step, labelled from its tool and arguments (for example `find source=tool kind=validation`). The question is given once, as a short title, when `save_answer` saves the answer.

**Answer only from Opaline.** Within that scope, every fact in an answer comes from the Opaline tools. Never inspect local files, the working directory or git state (`git remote`, `git log`, the current branch) to work out which repository the user means: take repository names from the `repository` column of `find` results or the dashboard, and ask the user if it is still ambiguous. This skill never runs shell commands.

## 1. Tools

The model sees nine tools: `search_answers`, `get_answer`, `get_answer_evidence`, `find`, `read`, `save_answer`, `share_answer`, `get_dashboard` and `list_workspaces`.

### Saved answers (read-only)

- `search_answers`: saved analyses by meaning (`text`) or the most recent (no `text`); yours and those shared with the workspace. Columns: id, status, mine, shared, cutoff, updates (the analysis it updates), scope, why it matched, question, the start of its answer.
- `get_answer`: one analysis. The first line is `analysis <id> status=… cutoff=<last data time> updates=<earlier analysis or none> updatedBy=<later analyses or none>`; then its scope, question, each step (its label, its queries with ids and why a result is unavailable, its finding), the changes against the analysis it updates (`change: step <id>: finding (evidence)`) and the final answer.
- `get_answer_evidence`: the exact stored result of one query (`query` = an id from `get_answer`), with `stale=true` when a session it read has a newer transcript since, or `unavailable=expired|removed|restricted`. Results expire after 90 days (a year when shared or pinned); a workspace may restrict a result to admins and the member whose sessions it read.

Drafts never appear. If one of these tools or `save_answer` says history is off for the workspace, go on with `find` and `read` and skip searching and saving.

### `find`: where something happened

Deterministic and cheap: always call it before `read`. It says *where*, never *why*. `source` picks what to look at:

- `runs`: one row per run. A **run** is one user prompt and everything the agent did until the next prompt. Columns: ref, startedAt, minutes (wall-clock span), activeMinutes (gaps over 5 minutes left out, so approval waits and stalls do not count), costUsd, model, models, repository, agent, edits, toolCalls, failedCalls, readCalls, searchCalls, notFound (reads and searches that found nothing), nextReaction (how the next prompt reacted), rawChars (how much text reading the run costs), parentSessionId, depth, promptHead. `groupBy=week|model|repository|agent|session` gives totals instead; `refs=[…]` returns exactly those runs with their summed minutes and cost (use it to price runs you read). `sort=startedAt|minutes|costUsd|failedCalls|rawChars`, `latest=N` keeps the newest N sessions in the range.
- `tool`: failed tool calls grouped by tool group → kind → cause → detail (lint rule, TypeScript code, missing module, stale patch…), with example refs. Kinds: `friction` (a hook or policy blocked the call), `mistake` (the agent's wrong assumption: wrong path, stale patch, bad flag), `validation` (tests, typecheck, lint or build rejected the code), `environment` (missing dependency, service or credential), `noise` (an expected non-zero exit such as a search with no hits; hidden unless `includeNoise`), `other`. Filter with `toolGroup`, `commandClass`, `kind`, `cause`, `detail`.
- `user`: prompts where the user was unhappy with the agent (corrections, complaints; `reaction=negative`), strongly worded ones (`swear`) and agent apologies (`apology`). Each comes with the **origin run** that caused it: for a prompt, the run right before it; for an apology, the run the user was correcting. These are word-list candidates: a complaint can be aimed at a bug rather than the agent, and quoted or pasted text can match too.

The header gives the date range, sessions in scope vs indexed (run facts cover indexed sessions only), minutes, cost, unattributed cost, unpriced runs and notes; repeat coverage and unpriced runs in your answer. A run that used several models lists them in `models`; `model=X` keeps runs whose usage includes X and counts only X's cost. Members see their own sessions; workspace admins see everyone's. There is no per-member filter here: for one person's numbers, admins use the dashboard.

Paging: `limit` 1-200 (default 50, 20 for `source=tool`). If the header has a `more: pass cursor=…` line, call `find` again with the same arguments plus that `cursor`. Don't split the date range into many calls.

The last header line is `trace analysis=<id> step=<id> query=<id>`: the draft's id, this call's step id and this result's id. Findings and changes name a step by either id.

### `read`: what actually happened

Reads 1-10 runs by ref under one `maxChars` budget (default 12000, max 40000); `[cut]` marks what was left out. A **ref** is `{sessionId, agentId, turn}`: `agentId` `''` is the main transcript, otherwise a subagent; `turn` starts at 1. Only session owners and workspace admins can read a session.

- `depth=exchange` (default): the prompt (or a subagent's delegated task) → files the agent edited → checks run after its last edit and whether they passed, failed or were still running when recorded (running is no outcome, never a pass) → failed calls with their error line → Codex subagent threads it spawned or messaged → its final message → how the user's next prompt reacted (a label such as "unhappy" or "no complaint found"; the prompt's text is not returned).
- `depth=turn`: every record of the run, compact, with record numbers.
- `depth=record`: the exact text of one record (`record`, optionally `block`, `fromChar`, `toChar`), to quote as evidence.

There is no way to read a whole session; never reconstruct one run by run.

**Codex subagent threads are subagents too**, even though each is a session of its own: `find` rows carry their `parentSessionId` and `depth`, and `read` shows a thread's parent run and, in the parent, the threads it spawned with their refs and tasks. Count a thread as part of its parent's work, never as separate work.

### `save_answer` and `share_answer`

`save_answer` publishes the draft once. A saved analysis is never changed: a second save is refused and changes nothing. Nothing is published publicly or shared with other workspaces. OpenAI processes the title and topics to build the search index.

`share_answer` shares a saved analysis with the workspace. Sharing shows the answer, its findings and the stored results behind it (which can include short excerpts from the sessions that were read) to members of your workspace; workspaces that restrict results show those results only to admins and the session's owner. It only adds access; the plugin cannot stop sharing, which is done outside the plugin.

### `get_dashboard` and `list_workspaces`

`get_dashboard` shows the Opaline dashboard in the chat (cost by default; also sessions, signals, agent runs, merged pull requests, CI failures per pull request), with top repositories, models and members. `list_workspaces` lists the workspaces the user belongs to and their slugs.

## 2. The analysis cycle

Every question about agent runs goes through the same six steps, in this order. Dashboard requests skip the cycle.

1. **Earlier answer.** Call `search_answers` with the question's words. If a saved analysis covers it, open it with `get_answer` and state its findings and cutoff in one sentence. Trust them unless the data changed. Open a stored result (`get_answer_evidence`) only to check a finding you reuse (step 2) or a step you must quote; never replay all of its queries, which costs as much as redoing the analysis.
2. **Plan.** The time window the user asked for always wins (default: the last 30 days). Totals, counts, costs and rankings are always computed fresh over the whole requested window, never carried over from an earlier answer. With an earlier answer, reuse only its detailed evidence (the runs it read and what they showed) when those runs fall inside the window, and read new runs only for the time after its last day. Keep, confirm or drop earlier findings only when their evidence falls inside the window; leave the rest out of the answer. Before reusing an earlier finding, open the stored result behind it with `get_answer_evidence`: if it says `stale=true` or is unavailable, re-read those runs (or recompute with `find`) before keeping the finding; otherwise reuse it.
3. **Evidence.** Call `find`, then `read` only the runs that decide the question, and say "read N of M".
   - The first call leaves out `analysis` and starts a new draft. Every later call passes `analysis` = the id from the trace line, so it joins the same draft.
   - Every `find` for totals, counts or rankings covers the whole window: `from` and `to` = the window's start and end. With an earlier answer whose last day (the date part of `cutoff=` in `get_answer`) lies inside the window, you may look for new runs to read with `from` = that day.
4. **Save.** Call `save_answer` once: `question` (a short title, not the user's words, no personal data, up to 120 characters, such as "Where our agents get stuck"), the final answer, one finding per step (name the step by the step or query id from its trace line) and up to 8 topics. Don't save the conversation itself: no quotes of the user's messages. When it updates an earlier answer, also pass `updates` = that answer's id and `changes`: exactly one item for every finding you save, `{step, change, evidence}`, where `step` is the finding's step or query id, `change` is `confirmed`, `strengthened`, `weakened`, `new` or `dropped`, and `evidence` is a short reason. Add a `dropped` item, with `step` = a step or query id of the earlier answer (from `get_answer`), for each of its findings that no longer holds. A missing or repeated step refuses the save and nothing is saved; fix the list and save again. Never save the same analysis twice: to revise a saved analysis, start a new draft (leave out `analysis`) and save it with `updates`.
5. **Share only when asked.** If the user asked to share, call `share_answer` right after saving, before your final message. Before sharing, tell the user: Sharing shows the answer, its findings and the stored results behind it (which can include short excerpts from the sessions that were read) to members of your workspace; workspaces that restrict results show those results only to admins and the session's owner.
6. **Answer.** Give exactly the saved final answer, complete, as your last message; callers often see only the last message, so never end with a pointer like "see above". With an earlier answer, add "updated from the earlier answer '<its title>' (data up to <cutoff date>)" and say which window you used; ids stay in tool arguments only. If you shared, add one short line saying it is shared with the workspace, or that sharing failed, from the actual `share_answer` result. Within one analysis you already saw your query results; do not reopen them with `get_answer_evidence`.

## 3. When to use what, and how

- **Think team-wide and over time.** Most questions are about the whole team over weeks or months: patterns across repositories and setups, not one session. Unless the user narrows it, use the last 30 days and every session you can see (workspace admins see the whole team; members see their own), and say which scope you used.
- **Dashboard** ("open/show the dashboard", "show our costs"): call `get_dashboard` with the date range. It shows the Opaline dashboard right in the chat. Never answer with a link to opaline.so instead, and don't call `find` first.
- **Trends** ("spend per week", "which model costs most"): one `find source=runs groupBy=…` call or `get_dashboard`. Report the numbers; don't interpret beyond them.
- **Where agents get stuck** ("why do our agents fail", "what keeps going wrong"):
  1. Call `find` for the right source.
  2. `read` a sample per group at `exchange` depth, up to 15, and say "read 15 of 46".
  3. Name what went wrong in the user's words.
  4. Call `find refs=… source=runs` to get the minutes and $ of the runs that showed it.
  5. Rank patterns by cost and time, not by count.
- **Scoped retros** ("retro my last 10 sessions", "this week in repo X"):
  1. Call `find source=runs latest=N` (or `from`/`to`).
  2. Narrow to the runs whose facts fit the question. For navigation, look at searches, not-found results and docs read before the first edit; for failures, at failed calls.
  3. `read` only those runs.
- **Per member**: when an admin asks about one person, point them to the dashboard's member view, where they can see where that person's setup needs help. Describe setups and patterns, not the person, and don't compare them with others.
- **Ask before the expensive part.** If the question is ambiguous (window, what "most" means, scope), ask once, after the first `find` and before any `read`. Offer options with real counts and the raw chars to read, mark a default, and wait. If the user said "just do it" or nobody can answer (a scheduled run), use the defaults and state them on the first line of the answer.
- `find` only says *where* something happened. *What* went wrong exists only after you `read` the run.
- For each finding, state the fix channel honestly:
  - **instructions/skills**: may reduce it, never guarantees;
  - **other mechanism**: docs, hook, setup script, repo/CI or lint config, product change;
  - **not fixable**: taste iteration, model limits.
- Say how to re-check each finding.

Never:
- draw conclusions from counts or word-list hits alone;
- compare rates between groups ("2.7% vs 1.5%");
- extrapolate from a sample to the unread runs;
- estimate savings;
- invent numbers;
- single out or rank people.

Unread candidates stay "not attributed".

## 4. Sample analyses

The numbers below are made up. They only show the shape of a good answer. Each one starts with `search_answers` and ends with one `save_answer` call and the saved answer.

- **Where agents get stuck**, "why do our agents fail?": no earlier answer → `find source=tool` → the top cause is `edit → stale patch` (52) → `read` 15 of them → 11 came right after a formatter hook rewrote the file → `find source=runs refs=[those 11]` → save with `question: "Why our agents fail"` → "11 runs, 63 min, $14. Fix: other mechanism (re-read the file after hooks). Re-check: `find source=tool cause="stale patch"` next week."
- **Update**, the same question two weeks later, for the last 30 days (2026-09-05 to 2026-10-04): `search_answers` finds that analysis → `get_answer`: "Earlier answer (cutoff 2026-09-20): stale patches after formatter hooks, 11 in its 30 days." → `find source=tool from=2026-09-05 to=2026-10-04` recomputes the whole-window totals: 7 stale patches in the last 30 days → `get_answer_evidence` on the stored result behind its finding shows `stale=false`, so its runs stay as evidence → the earlier answer's last day lies inside the window, so `find source=tool from=2026-09-20 to=2026-10-04` lists the new ones (3) and `read` covers only those → save with `question`, `updates=<id>`, a finding for that step and `changes=[{step: <its step id>, change: "weakened", evidence: "7 in the last 30 days, was 11 in the 30 days before"}]` → the answer ends "Updated from the earlier answer 'Why our agents fail' (data up to 2026-09-20); window 2026-09-05 to 2026-10-04."
- **Outdated docs**, "what keeps going wrong in web-app?": `find source=tool repository=web-app` → a `mistake` cause recurs: agents follow a doc that names a script or unit that no longer exists → `read` a sample → the runs stop after the doc was fixed → save → "Fixed by the doc update on <date>; no new cases since. Re-check next month."
- **Unhappy prompts**, "where did the agents frustrate me most?": ask "last 2 or 4 weeks? Ranked by cost and time (default) or by the strongest reactions?" → `find source=user` → `read` the origin runs, up to 15 per reaction type → patterns such as "said done without clicking through the UI" with quotes and refs → price each pattern's origin runs → rank by $ and minutes → save, with a setup fix per pattern.
- **Time**, "retro my last 10 sessions for navigation": `find source=runs latest=10` → the 6 runs with not-found results or many searches before the first edit → `read` those 6 → save → "3 runs searched for a constant named in docs/sweep.md that no longer exists, 11 min. Fix: update the doc."
- **Trend**, "spend per model per week": `find source=runs groupBy=model` and `groupBy=week` → save. Numbers only.

## Conventions

- Dates are UTC `YYYY-MM-DD`. Resolve "last week" and similar to explicit dates and say which range you used.
- Every tool works in one workspace. Without `workspace` it uses the default workspace in the plugin settings, else the one the user last opened; `list_workspaces` marks it with `default: true`. If the result looks empty, call `list_workspaces` and pass the slug.
- Cost is estimated API cost in USD. Runs without usage data are unpriced; say how many.
- Lead with the answer and its evidence: refs and short quotes. Only session owners and workspace admins can read a session; if refused, say so instead of retrying.

## When there is no data

If `find` finds no sessions (or `list_workspaces` shows `sessionsLast365Days: 0`), there are no sessions you can see yet. Tell the user to open https://opaline.so, sign in and follow the steps there to connect their coding agents; each teammate connects their own. Then check again with `list_workspaces`. Don't run any commands for them.
