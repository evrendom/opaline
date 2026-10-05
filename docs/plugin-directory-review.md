# Opaline plugin: OpenAI directory review notes

Reference for submitting the Opaline plugin (`plugins/opaline/`) and its MCP server (`https://opaline.so/api/mcp`, `apps/api/src/handlers/mcp-http.ts`) to the OpenAI plugin directory. Requirements: [submission](https://developers.openai.com/plugins/deploy/submission), [app review](https://developers.openai.com/plugins/deploy/app-review).

Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI). Per-member views exist to see where each person's setup needs help, not to rank people.

The model sees six tools: `analyses`, `find`, `read`, `save_analysis`, `get_dashboard` and `list_workspaces`. Everything else is app-only (`_meta.ui.visibility = ["app"]`), called only by the dashboard app, the settings page or the host's @-mention search. Annotations are declared per tool (`annotations` in `apps/api/src/mcp/mcp-tools.ts` and `plugin-tools.ts`, constants in `tool-annotations.ts`) and published by `tools/list` with `annotations.title` set to the tool's title. `apps/api/src/mcp/mcp-tools.test.ts` pins them, the visible tool list, and the description format: every model-visible tool has five one-sentence lines (`What it does:`, `Use when:`, `Returns:`, `Side effects:`, `Limits:`), under 600 characters, without jargon, and a one-line description on every input; every app-only tool has one line ending "Not called by the assistant." Detailed guidance for the model (result columns, failure kinds, paging, how to read runs and update an answer) lives in the plugin skill (`plugins/opaline/skills/opaline/SKILL.md`).

## Why the analysis log works this way

For the review form's notes field:

> **How Opaline saves answers**
>
> Opaline answers questions about a team's coding agents, like "Where do our agents waste time?". It keeps each answer, so the next question on the same topic can start from it.
>
> - `find` and `read` look up the sessions the user is allowed to see.
> - Each `find` or `read` call also stores what it found, as part of the answer that is being worked on. Nobody can see this unfinished answer, not even the user. If it is never saved, it is deleted after 7 days.
> - `save_analysis` saves the finished answer. After that, the user can see it, and so can their team if they share it. A saved answer is never changed or deleted. To update it, Opaline saves a new answer that links to the old one.
> - No tool changes or deletes the user's sessions.
>
> So `find`, `read` and `save_analysis` are marked as tools that write (but never delete). `analyses` only reads saved answers.

## Tool annotations

Every tool works inside one Opaline workspace the signed-in account belongs to (`workspace` argument or the default workspace), through the same permission checks as the web app. No tool calls a third-party service or the public internet, so `openWorldHint` is `false` throughout. No tool deletes, overwrites or sends anything, so `destructiveHint` is `false` throughout.

### Tools the model calls

| Tool (title) | readOnlyHint | openWorldHint | destructiveHint |
|------|--------------|---------------|-----------------|
| `find` (Find patterns in agent runs) | **false**: Finds where the team's agents got stuck, failed or wasted time and money, and changes no session or workspace data. It also stores what it found in the answer being worked on (a private draft): nobody, the user included, can see it until `save_analysis` saves it, and an unsaved draft is deleted after 7 days. Hosts may ask once; "always allow" is fine. | **false**: Reads only the caller's Opaline workspace in Opaline's own database. It reaches no external system. | **false**: Nothing is deleted, overwritten or sent. |
| `read` (Read agent runs) | **false**: Shows what happened in up to 10 runs from sessions the caller may open (session owner or workspace admin), and stores what it found in the same private draft as `find`. No session or workspace data changes. | **false**: Reads only the caller's Opaline workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `analyses` (Search saved answers) | **true**: Searches saved answers and opens one (findings, the last day its data covers, steps, links to older and newer versions) or one stored result. Unsaved drafts never appear. Called with the old `save`/`share` actions, it changes nothing and points to `save_analysis`. | **false**: Reads only answers the caller saved or that were shared with the caller's workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `save_analysis` (Save or share an answer) | **false**: `action=save` saves the draft as a finished answer; `action=share` shares a saved answer with the caller's workspace or stops sharing it. | **false**: The answer is stored in Opaline and, when shared, visible only to members of the caller's own workspace. | **false**: A saved answer is never changed or deleted: a second save is refused and changes nothing, and an update is saved as a new answer linked to the old one, with one change entry per finding (checked before anything is written). Sharing is reversed with `shared=false`. |
| `get_dashboard` (Opaline) | **true**: Shows the dashboard in the chat: agent cost, sessions and runs over time, by repository, model and member. The title stays "Opaline" because Codex shows it as the app's header (#185). | **false**: Aggregates the caller's workspace data in Opaline. | **false**: Nothing is deleted, overwritten or sent. |
| `list_workspaces` (List your workspaces) | **true**: Lists the names, slugs and logos of the workspaces the caller belongs to. | **false**: Only the caller's own memberships. | **false**: Nothing is deleted, overwritten or sent. |

### App-only tools (hidden from the model)

Each has a plain title and one line ("Used by … Not called by the assistant."). All are read-only except `settings_update`, which saves the caller's "Default workspace" preference (reversible, only a workspace the caller belongs to). `openWorldHint` and `destructiveHint` are `false` for all.

| Tool | Used by |
|------|---------|
| `app_analytics__*` (22 tools, `PLUGIN_PROCEDURES` in `plugin-tools.ts`, titled "Dashboard: costs", "Sessions: list", "Team: members" …) | The dashboard app, one per read-only analytics procedure. Write procedures are excluded by design and by test. |
| `get_session` (Session: overview) | The server, to show a session the user @-mentioned (`resources/read`). |
| `mention_sessions` (Sessions: @-mention search) | The host's @-mention search; the caller's own sessions only. |
| `settings_read`, `settings_update` (Settings: read / save) | The plugin settings page. |

Removed in this change because nothing calls them: `get_kpis`, `list_sessions`, `read_session_turn`, `get_team`, `list_skills`, `get_skill`, `list_repositories`, `get_repository`, `find_recurring_errors` and `get_billing`. The dashboard app keeps its own app-only tools for the same data.

## Data returned and privacy policy coverage

Privacy policy: `apps/marketing/src/content/legal/opaline-privacy-policy.html` (https://opaline.so/legal/privacy-policy/). Section numbers below refer to it.

| Data type returned | Tools | Policy coverage |
|--------------------|-------|-----------------|
| Prompts, agent messages and reasoning, tool calls and their output, error lines, terminal commands, file paths, skill content | `find` (prompt heads, quotes, commands, error lines), `read`; app-only session and skill tools for the dashboard app | §4 "Coding-agent session content"; §18 "session data" |
| Repository names, branches, commit SHAs, worktree and project paths | `find`, `get_dashboard`; app-only dashboard tools | §4 session content ("repository and version-control information") and "Workspace analytics" |
| Models, token counts, estimated cost, durations, timestamps, run and session counts | `find`, `get_dashboard`; app-only dashboard tools | §4 "Workspace analytics" ("token and model usage", "timing") |
| Prompt classifications (prompts where the user was unhappy with the agent, agent apologies, matched words) | `find source=user`, `get_dashboard` (signals metric) | §4 "Workspace analytics" ("classifications"); §12 "Contents and inferences" |
| Member display names and user ids, per-member cost and activity (to see where each person's setup needs help) | `get_dashboard` (top members), `find` (with `userId` for admins); app-only team tools | §4 account information and workspace analytics ("User-, project- or workspace-level comparisons"); §18 "team information" |
| Member emails, profile images and roles; the caller's account record (name, email, image) | `get_dashboard` `_meta["opaline/widget"]` only, read by the dashboard app (not shown to the model); app-only `app_*` tools | §4 "Account and organization information" |
| Workspace names, slugs, logos | `list_workspaces`, `settings_read` | §4 "Account and organization information" |
| Analysis log: questions, sub-questions, findings, final answers, topics, change lists, stored `find`/`read` results, token usage of the analysis, uploaded analysis chats | `analyses` (saved answers only), `save_analysis`; `find`/`read` keep their calls in a private draft until it is saved | §18 "analysis log" (drafts private, deleted after 7 days unless saved; only saved analyses kept; saved analyses not changed afterwards; sharing and result retention) |
| GitHub pull request and CI facts (merged PRs, CI runs, conclusions, workflows, GitHub authors) | `get_dashboard` (`mergedPullRequests`, `ciFailuresPerPullRequest` metrics and breakdowns) when the workspace connected GitHub | **Partial gap**, see below |

### Gaps to close before submission

1. **Analysis log: closed.** §18 now says that `find`/`read` calls and their results are kept as a private draft that nobody can open, that a draft not saved is deleted 7 days after it was started, that only saved analyses are kept and are not changed afterwards (a later answer is a new analysis referring to the earlier one), that an analysis can be shared with the workspace, and how long stored results are kept.
2. **GitHub App data is not named.** §4 describes repository context captured by the CLI, but not pull request, CI run and GitHub author data collected through the GitHub App, which `get_dashboard` can return. §4 should list it as a source and data type (§5 sources too).
3. **Embeddings provider for analysis search.** With the Convex store, questions, sub-questions and topics are sent to OpenAI for embeddings (`OPENAI_API_KEY`). §7 covers AI-assisted analysis by OpenAI/Anthropic in general terms; confirm it covers this use or name it.

## Identifiers returned

| Identifier | Where | Why it is needed |
|------------|-------|------------------|
| Session id | `find`/`read` run ids, `analyses get` (uploaded chats), @-mention resource URIs | The session is the product's unit: `read` and links to opaline.so address a session by id, and answers cite the sessions they are based on. |
| Run `{sessionId, agentId, turn}` and record index | `find`, `read` | Addresses one run (one prompt and the agent's work until the next) or one record so `read` can open exactly it. `agentId` is a subagent's id from the transcript (`''` is the main transcript); `parentSessionId` links a Codex subagent thread to its parent. |
| Analysis, step and query ids (`trace analysis=… step=… query=…`) | `find`, `read`, `analyses`, `save_analysis` | Later `find`/`read` calls pass the analysis and step ids so they join the same draft, `save_analysis` names the draft and steps it saves, `updates` names the saved answer an update builds on (`analyses action=get` shows `updates` and `updatedBy`), and `analyses action=query` opens one stored result. |
| Member user id | `get_dashboard` top members, `find` | Input for the member filters of `get_dashboard` and `find` (`members`, `userId`), to see where one person's setup needs help. Shown next to the member's name. |
| Model id | `find`, `get_dashboard` | Inputs for the `find` and dashboard filters. |
| Workspace slug | `list_workspaces`, `get_dashboard` | The `workspace` argument of every tool. |

Not returned to the model: the internal organization id (tools take the slug), the web app's scroll-to event ids and the signal classifier version of the app-only session overview, and the chat owner's user id from `analyses action=get`.

Still returned and worth a reviewer's question: `find` headers include `classifier=<version>` (a version number of the deterministic failure classifier, not an identifier of a person or record; it tells which rules produced the groups of a stored result), and the dashboard app's `_meta` carries the caller's account record and the workspace member list (names, emails, images, roles) that the embedded web app needs for its member views. It is not shown to the model.

## Submission checklist

- Screenshots: `bun run plugin:screenshots` renders the dashboard app at 706x860 from the product demo seed into `plugins/opaline/assets/screenshots/` (listed in `interface.screenshots`).
- Package: `bun run plugin:zip` writes `dist/opaline-plugin-<version>.zip`.
- Production must have, before review: `MCP_PLUGIN_PUBLIC=true` (otherwise only the Opaline team can connect), `OPENAI_APPS_CHALLENGE_TOKEN` set to the dashboard's token, and the analysis log enabled for the reviewer workspace (`ANALYSIS_LOG_STORE` and `ANALYSIS_LOG_WORKSPACES`). Without the log, `analyses` and `save_analysis` return "history is off" and four of the five positive test cases cannot call `save_analysis`.
- Reviewer account: email and password sign-in without MFA or email verification, owner of a workspace with about 36 sample sessions over 6 weeks from several members: a recurring web-app mistake caused by outdated docs (a missing typecheck script, dollars instead of cents) that stops after the docs are fixed around September 14, and `no-console` lint friction across members. The test cases are written for that data without fixed numbers.
- Password sign-in only exists for the emails in `PASSWORD_AUTH_EMAILS`; every other account uses an email code or Google/GitHub. Production must list `openai-review@opaline.so`, `openai-review-sam@opaline.so` and `openai-review-priya@opaline.so`, or the reviewers cannot sign in. Reviewer sign-in instruction (the same on the plugin's OAuth sign-in page): "Choose Log in with Email and enter the email. The password field appears; enter the password and click Sign in."
- Deploy the Convex functions (`bun run convex:deploy`, see `convex/README.md`) before the API that uses drafts, then the API, before rescanning tools: annotations, descriptions and the draft and append-only behaviour come from the server, not the ZIP.
