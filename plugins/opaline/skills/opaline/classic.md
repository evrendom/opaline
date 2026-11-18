# Classic flow (find and read)

Where `schema` is not among your tools or says the retro tools are not enabled for this workspace, answer with `find` and `read`. `save_answer`, `share_answer`, `get_dashboard` and `list_workspaces` work as in `SKILL.md`; for earlier answers use `answers`, or where it is not among your tools its older names `search_answers` (search), `get_answer` (open) and `get_answer_evidence` (one stored result). Findings name the `find` and `read` steps from their trace lines.

**`find`: where something happened.** Cheap and deterministic: call it before `read`. It says *where*, never *why*. `source` picks what to look at:

- `source=runs`: one row per run (one prompt and the agent's work until the next): ref, startedAt, minutes, activeMinutes (gaps over 5 minutes left out), costUsd, model, repository, agent, edits, toolCalls, failedCalls, readCalls, searchCalls, notFound (null where it cannot be recorded, never 0), nextReaction, rawChars, parentSessionId, promptHead. `groupBy=week|model|repository|agent|session` gives totals; `refs=[…]` returns exactly those runs with their summed minutes and cost (price the runs you read); `sort=startedAt|minutes|costUsd|failedCalls|rawChars`, or `sort=random` for an unbiased sample; `latest=N` keeps the newest N sessions.
- `source=tool`: failed tool calls grouped by tool group, kind, cause and detail, with example refs. Kinds: friction (a hook or policy blocked it), mistake (wrong path, stale patch, bad flag), validation (tests, types, lint or build), environment (missing tool or service), noise (expected failures, hidden unless `includeNoise`), other. Filter with `toolGroup`, `commandClass`, `kind`, `cause`, `detail`.
- `source=user`: unhappy prompts (`reaction=negative`), strongly worded ones (`reaction=swear`) and agent apologies (`reaction=apology`), each with the origin run that caused it. Word-list candidates: read before concluding.
- `source=git`: commits, pushes, PR links and CI status reads, with the pull requests and CI runs GitHub links to them and whether CI was checked after a push; `pullRequest=owner/name#133` gives the sessions that touched that pull request. Null counts and unlinked statuses are unknown, not zero.
- `source=calls`: shell commands, Codex scripts and written script files with their `argv0`, `prefix`, `fingerprint` and `simhash`; `groupBy=commandFingerprint|commandArgv0|commandPrefix` counts calls, sessions and failures per key with `groupCallTime` (the calls' own minutes) and `groupRunTime` (their runs' active minutes); each row has its `callMinutes`. Check a group's examples before calling them the same command.
- `source=weekly`: totals per ISO week, member and agent from a nightly snapshot, months in one call, for trends and before/after checks; `groupBy=week|member|agent`. Compare a fact over its known runs (`deniedCalls / deniedCallsKnownRuns`), never the raw count; the newest week is partial.

Filters: `from` and `to` (UTC days; totals and rankings cover the whole window), `repository`, `agent`, `model`, `sessionId`; where `find` lists them, also `parentSessionId` (a session and every session it spawned) and `filters`, a list of `{key, operator, value}` on the columns of the runs view (or the calls view for `source=calls`), all of which must hold; look a column's values up with `schema view=… column=…` instead of guessing, and add only the filters the question needs. The header gives coverage, cost and unpriced runs: repeat them. Paging: `limit` 1-200 (default 50, 20 for `source=tool`), and `offset` where `find` lists it; when the header says hasMore=true, call `find` again with the same arguments plus the `cursor` the last line names, and don't split the date range into many calls. The last header line is `trace analysis=<id> step=<id> query=<id>`.

**`read`: what actually happened.** Reads 1-10 runs by ref under one `maxChars` budget (default 12000, max 40000); `[cut]` marks what was left out. A ref is `{sessionId, agentId, turn}`: `agentId` `''` is the main transcript, `turn` starts at 1.

- `depth=exchange` (default): the prompt, files edited, checks after the last edit and their outcome (still running is no pass), failed calls with their error, subagent threads, the final message and how the next prompt reacted.
- `depth=turn`: every record of the run, compact, with record numbers.
- `depth=record`: the exact text of one record (`record`, optionally `block`, `fromChar`, `toChar`), to quote as evidence.

Read only the runs that decide the question; subagent runs and Codex subagent threads are part of their parent's work.

**The analysis cycle.**

1. **Earlier answer.** `answers action=search`; if one covers the question, `action=open` and say its findings and cutoff in one sentence; check a finding you reuse with `action=result`.
2. **Plan.** The window the user asked for wins (default: the last 30 days); compute totals fresh over the whole window; with an earlier answer, read new runs only after its cutoff.
3. **Evidence.** `find` for the right source (the first call starts a draft; pass `analysis` from the trace line to every later `find` and `read`), then `read` the runs that decide the question, up to 15 per pattern, and say "read N of M". Price what they showed with `find source=runs refs=[…]` and rank patterns by time and cost, not by count.
4. **Save and answer** as in "Save and answer" in `SKILL.md`, then propose setup fixes as in its playbook.

Ask once, after the first `find` and before any `read`, when the window, the order or the scope is ambiguous. The "Conclusions" and "Unknown is not zero" rules of the playbook in `SKILL.md` apply unchanged.
