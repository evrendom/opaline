---
name: opaline
description: Answer questions about the user's or their team's Claude Code and Codex sessions with the Opaline tools — agent cost and usage, sessions and what happened in them, members, repositories, skills, recurring errors and billing. Use when the user asks what agents cost or did, wants a past session, asks whether an error happened before, or mentions Opaline.
---

# Opaline

Opaline stores the user's uploaded Claude Code and Codex sessions and turns them into the dashboards on opaline.so. The `opaline` MCP tools read the same data. They are read-only.

## Choosing a tool

- Cost, sessions, agent runs, merged PRs over time, or "what drove it": `get_dashboard`. Pass `splitBy` (`members`, `repositories`, `models`, …) to break the trend down, and filter with `members`, `repositories` or `models`.
- Headline counts for a period: `get_kpis`.
- Finding sessions: `list_sessions` (filter by `repository`, `userId`, `skillName` or `source`). Then `get_session` for one session and `read_session_turn` for the full content of one turn. `read_session_turn` needs the `revision` returned by `get_session`.
- People: `get_team`. Its `user_id` values are what `members` and `userId` filters expect.
- "Have we seen this error before?": `find_recurring_errors`.
- Skills and repositories: `list_skills`, `get_skill`, `list_repositories`, `get_repository`.
- Plan and limits: `get_billing`.

## Conventions

- Dates are UTC `YYYY-MM-DD`. Resolve "this month", "last week" and similar to explicit dates before calling a tool, and say which range you used.
- Every tool works in one workspace. Without `workspace` it uses the one the user last opened in Opaline. If the user names a team or the result looks empty, call `list_workspaces` and pass the slug.
- Cost is estimated API cost in USD.
- Lead with the answer and the numbers behind it. Many results end with an "Open in Opaline" link to the same view; include it when the user would want the chart or the full table.
- Only the session owner and workspace admins can open a session. If `get_session` is refused, say so instead of retrying.

## When there is no data

If the tools return no sessions, the user has probably not uploaded any yet. Ask them to run this in a terminal and follow the prompts. It is interactive, so do not run it yourself:

```bash
npx opaline@latest
```

It signs them in through the browser, uploads existing sessions for the repositories they choose, and keeps future sessions in sync.
