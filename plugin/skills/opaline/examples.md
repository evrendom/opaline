# Worked examples

Dates are made up: the window is 2026-09-12 to 2026-10-12, so a range ends `< '2026-10-13'`. Every example starts with `answers action=search` and ends with the save in "Save and answer" in `SKILL.md`.

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
