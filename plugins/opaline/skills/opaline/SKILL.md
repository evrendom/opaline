---
name: opaline
description: Answer questions about the user's or their team's Claude Code and Codex sessions with the Opaline tools — why agents fail, what frustrated the user, where time and money went, agent cost and usage, past sessions, members, repositories, skills and billing. Use when the user asks what agents cost or did, why something keeps going wrong, wants a retro of recent sessions, wants a past session, or mentions Opaline.
---

# Opaline

Opaline stores the user's uploaded Claude Code and Codex sessions. The `opaline` MCP tools read that data and are read-only.

## 1. Tools at hand

**Past analyses first.** `analyses` is the log of questions asked before: `action=search` (by meaning, or recent), `action=get` (the path: steps, findings, final answer), `action=query` (the exact stored result of one step's query, flagged stale if a session changed), `action=save`, `action=share`. If `analyses` says history is off for the workspace, go on with `find` and `read` and skip searching and saving.

**Analysing agent runs** (why things go wrong, what it cost, retros):

- `find`: deterministic and cheap, so always call it first. It answers "where did something happen?" The `source` argument picks what to look at:
  - `tool`: failed tool calls, grouped by tool group → cause → detail (lint rule, TS code, missing module, stale patch…), with example refs.
  - `user`: every negative or swearing prompt and every agent apology. Each one comes with the **origin run** that caused it: for a prompt, the run right before it; for an apology, the run the user was correcting.
  - `runs`: the runs in a scope (`latest=N` sessions and/or `from`/`to`), one row per run with its facts (minutes, $, edits, failed calls, not-found reads/searches, the next prompt's reaction, raw chars). Add `groupBy` for totals. Pass `refs` to price a set of runs you read.
  - More than one page: if the header has a `more: pass cursor=…` line, call `find` again with the same arguments plus that `cursor`. Don't split the date range into many calls.
- `read`: reads specific runs by ref (at most 10 per call) under a character budget.
  - `exchange` (default): prompt → files edited → checks run after the last edit → failed calls → final message → the user's next prompt.
  - `turn`: every record of the run.
  - `record`: the exact text of one record, used as evidence.

A **ref is a run**: session + agent (`''` is the main transcript, otherwise a subagent) + turn. There is no way to read a whole session, and you should never try to reconstruct one run by run.

**Dashboards and lookups**: `get_dashboard`, `get_kpis`, `list_sessions` / `get_session` / `read_session_turn`, `get_team`, `find_recurring_errors`, `list_skills` / `get_skill`, `list_repositories` / `get_repository`, `get_billing`.

## 2. When to use what, and how

- **Start with `analyses action=search`** using the question's words. If a past analysis covers it, `get` it and **update** it:
  - Its findings and final answer are the starting point; trust them unless the data changed.
  - Rerun `find` only for the time after its cutoff (same arguments, new `from`), and `read` only runs it did not read.
  - Open a stored result (`action=query`) only for a specific step you must check or quote. Never replay all of its queries; that costs as much as redoing the analysis.
  - Save with `updates` = that analysis and say what changed.
- **Every `find`/`read` call is logged.** On the first call pass `question` = the asker's exact words; after that pass `analysis` = the id from the trace line and `step` = the sub-question this call answers (reuse a step id for more calls on it, `parentStep` for a follow-up). Steps are what you write out on purpose, never hidden reasoning.
- **Finish with one `analyses action=save`, then the answer:** save the final answer, one finding per step (name the step by the id from its trace line or by its exact sub-question), any clarifying question you asked with the asker's reply, and up to 8 topics. Then give that same final answer, complete, as your last message: callers often see only the last message, so never end with a pointer like "see above". Within one analysis you already saw your query results; do not reopen them with `action=query`.

- **Trends** ("spend per week", "which model costs most"): one `find source=runs groupBy=…` call or `get_dashboard`. Report the numbers; don't interpret beyond them.
- **Insights** ("why do my agents fail", "what annoyed me"):
  1. Call `find` for the right source.
  2. `read` a sample per group at `exchange` depth, up to 15, and say "read 15 of 46".
  3. Name what went wrong in the user's words.
  4. Call `find refs=… source=runs` to get the minutes and $ of the runs that showed it.
  5. Rank patterns by cost and time, not by count.
- **Scoped retros** ("retro my last 10 sessions", "this week in repo X"):
  1. Call `find source=runs latest=N` (or `from`/`to`).
  2. Narrow to the runs whose facts fit the question. For navigation, look at searches, not-found results and docs read before the first edit; for failures, at failed calls.
  3. `read` only those runs.
- **Ask before the expensive part.** If the question is ambiguous (window, what "most" means, scope), ask once, after the first `find` and before any `read`. Offer options with real counts and the raw chars to read, mark a default, and wait. If the user said "just do it" or nobody can answer (a scheduled run), use the defaults and state them on the first line of the answer.
- `find` only says *where* something happened. *What* went wrong exists only after you `read` the run. Lexicon hits are candidates: a swear can be aimed at a bug rather than the agent, and quoted or pasted text can match too.
- For each finding, state the fix channel honestly:
  - **instructions/skills**: may reduce it, never guarantees;
  - **other mechanism**: hook, setup script, repo/CI config, product change;
  - **not fixable**: taste iteration, model limits.
- Say how to re-check each finding.

Never:
- draw conclusions from counts or lexicon hits alone;
- compare rates between groups ("2.7% vs 1.5%");
- extrapolate from a sample to the unread runs;
- estimate savings;
- invent numbers.

Unread candidates stay "not attributed".

## 3. Sample analyses

The numbers below are made up. They only show the shape of a good answer.

- **Accuracy**, "why do my agents fail?": `find source=tool` → the top cause is `edit → stale patch` (52) → `read` 15 of them → 11 came right after a formatter hook rewrote the file → `find source=runs refs=[those 11]` → "11 runs, 63 min, $14. Fix: other mechanism (re-read the file after hooks). Re-check: `find source=tool cause="stale patch"` next week."
- **Accuracy + time**, "what annoyed me the most?": ask "last 2 or 4 weeks? Ranked by cost and time (default) or by harshest moments?" → `find source=user` → `read` the origin runs, up to 15 per reaction type → patterns such as "said done without clicking through the UI" with quotes and refs → price each pattern's origin runs → rank by $ and minutes.
- **Time**, "retro my last 10 sessions for navigation": `find source=runs latest=10` → the 6 runs with not-found results or many searches before the first edit → `read` those 6 → "3 runs searched for a constant named in docs/sweep.md that no longer exists, 11 min. Fix: update the doc."
- **Money**, "what did the wrong-layer edits cost?": after labelling the runs, `find source=runs refs=[…]` → "$23 and 94 min over 7 runs read; 31 unread candidates not attributed."
- **Trend**, "spend per model per week": `find source=runs groupBy=model` and `groupBy=week`. Numbers only.

## Conventions

- Dates are UTC `YYYY-MM-DD`. Resolve "last week" and similar to explicit dates and say which range you used.
- Every tool works in one workspace. Without `workspace` it uses the one the user last opened. If the result looks empty, call `list_workspaces` and pass the slug.
- Cost is estimated API cost in USD. Runs without usage data are unpriced; say how many.
- Per-run facts cover indexed sessions only. `find` headers state coverage; repeat it in your answer.
- Lead with the answer and its evidence: refs and short quotes. Only session owners and workspace admins can read a session; if refused, say so instead of retrying.

## When there is no data

If the tools return no sessions, the user has probably not uploaded any yet. Ask them to run this in a terminal and follow the prompts. It is interactive, so do not run it yourself:

```bash
npx opaline@latest
```

It signs them in through the browser, uploads existing sessions for the repositories they choose, and keeps future sessions in sync.
