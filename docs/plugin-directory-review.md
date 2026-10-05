# Opaline plugin: OpenAI directory review notes

Reference for submitting the Opaline plugin (`plugins/opaline/`) and its MCP server (`https://opaline.so/api/mcp`, `apps/api/src/handlers/mcp-http.ts`) to the OpenAI plugin directory. Requirements: [submission](https://developers.openai.com/plugins/deploy/submission), [app review](https://developers.openai.com/plugins/deploy/app-review).

Annotations are declared per tool (`annotations` in `apps/api/src/mcp/mcp-tools.ts` and `plugin-tools.ts`, constants in `tool-annotations.ts`) and published unchanged by `tools/list`. `apps/api/src/mcp/mcp-tools.test.ts` pins them.

## Tool annotations

Every tool works inside one Opaline workspace the signed-in account belongs to (`workspace` argument or the default workspace), through the same permission checks as the web app. No tool calls a third-party service or the public internet, so `openWorldHint` is `false` throughout. No tool deletes, overwrites or sends anything, so `destructiveHint` is `false` throughout.

### Tools the model calls

| Tool | readOnlyHint | openWorldHint | destructiveHint |
|------|--------------|---------------|-----------------|
| `find` | **true**: Lists where events happened in the user's uploaded agent runs (failed tool calls, negative prompts, per-run cost and time). It never changes sessions or workspace data. Each call is also recorded in the caller's own analysis log as provenance for the answer; that record is the caller's working history, not user data. | **false**: Reads only the caller's Opaline workspace in Opaline's own database. It reaches no external system. | **false**: Nothing is deleted, overwritten or sent. |
| `read` | **true**: Returns the content of up to 10 selected runs from sessions the caller may open (session owner or workspace admin). Like `find`, the call is recorded in the caller's own analysis log as provenance; no session or workspace data changes. | **false**: Reads only the caller's Opaline workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `analyses` | **true**: Searches the analysis log and returns a past analysis or one stored query result. Saving and sharing are a separate tool (`save_analysis`); called with the old `save`/`share` actions, this tool changes nothing and points to `save_analysis`. | **false**: Reads only analyses the caller wrote or that were shared with the caller's workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `save_analysis` | **false**: Writes to the analysis log: `action=save` stores the final answer, findings and topics of an analysis the caller ran, and `action=share` shares it with the caller's workspace or stops sharing it. | **false**: The analysis is stored in Opaline and, when shared, visible only to members of the caller's own workspace. Nothing is published outside it. | **false**: Saving fills in the answer of an analysis the caller started (only its author can save it); saving it again replaces the caller's own earlier answer, which is how an answer is corrected. `updates` links an earlier analysis without changing it, and sharing is reversed with `shared=false`. It never deletes or changes sessions or workspace data. |
| `list_workspaces` | **true**: Lists the names and slugs of the workspaces the caller belongs to. | **false**: Only the caller's own memberships. | **false**: Nothing is deleted, overwritten or sent. |
| `get_dashboard` | **true**: Returns cost, session and usage totals with their daily trend and top breakdowns for a date range, and renders the read-only dashboard app. | **false**: Aggregates the caller's workspace data in Opaline. | **false**: Nothing is deleted, overwritten or sent. |
| `get_kpis` | **true**: Returns headline counts (sessions, active members, projects, subagents, skills, slash commands) for a date range. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `list_sessions` | **true**: Lists sessions with date, repository, branch, agent, model, tokens, cost and duration. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `get_session` | **true**: Returns one session's summary and its turns. Only the session owner and workspace admins can open it. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `read_session_turn` | **true**: Returns the prompt, messages, tool calls and results of one turn of a session the caller may open. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `get_team` | **true**: Returns workspace members with their sessions, cost, tokens and activity trend. | **false**: Members of the caller's own workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `list_skills` | **true**: Lists the agent skills used in the workspace with usage counts. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `get_skill` | **true**: Returns one skill's content, versions and usage. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `list_repositories` | **true**: Lists the repositories agents worked in, with sessions, cost and last activity. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `get_repository` | **true**: Returns the skills used in one repository. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `find_recurring_errors` | **true**: Returns errors that recurred across sessions, with counts and where they occurred. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |
| `get_billing` | **true**: Returns the workspace's plan, seats and status. It cannot change the plan or take payments. | **false**: The caller's workspace only. | **false**: Nothing is deleted, overwritten or sent. |

### App-only tools (hidden from the model, `_meta.ui.visibility = ["app"]`)

| Tool | readOnlyHint | openWorldHint | destructiveHint |
|------|--------------|---------------|-----------------|
| `settings_read` | **true**: Returns the plugin settings form and the caller's current default workspace. | **false**: The caller's own setting. | **false**: Nothing is deleted, overwritten or sent. |
| `settings_update` | **false**: Saves the caller's "Default workspace" plugin setting. | **false**: The setting is stored in Opaline for the caller only, and only a workspace the caller belongs to is accepted. | **false**: It replaces one preference that the user can change back at any time; no data is lost. |
| `mention_sessions` | **true**: Finds the caller's own recent sessions for @-mentions. | **false**: The caller's own sessions only. | **false**: Nothing is deleted, overwritten or sent. |
| `app_analytics__*` (22 tools, `PLUGIN_PROCEDURES` in `plugin-tools.ts`) | **true**: Each wraps one read-only analytics procedure the dashboard app calls (costs, KPIs, sessions, session detail, skills, repositories, team). Write procedures are excluded by design and by test. | **false**: The caller's workspace only, with the web app's permission checks. | **false**: Nothing is deleted, overwritten or sent. |

## Data returned and privacy policy coverage

Privacy policy: `apps/marketing/src/content/legal/opaline-privacy-policy.html` (https://opaline.so/legal/privacy-policy/). Section numbers below refer to it.

| Data type returned | Tools | Policy coverage |
|--------------------|-------|-----------------|
| Prompts, agent messages and reasoning, tool calls and their output, error lines, terminal commands, file paths, skill content | `find` (prompt heads, quotes, commands, error lines), `read`, `read_session_turn`, `get_session` (previews, file paths, errors), `get_skill`, `find_recurring_errors` | §4 "Coding-agent session content"; §18 "session data" |
| Repository names, branches, commit SHAs, worktree and project paths | `find`, `list_sessions`, `get_session`, `list_repositories`, `list_skills`, `get_repository`, `find_recurring_errors`, `get_dashboard` | §4 session content ("repository and version-control information") and "Workspace analytics" |
| Models, token counts, estimated cost, durations, timestamps, run and session counts | most tools | §4 "Workspace analytics" ("token and model usage", "timing") |
| Language-signal classifications (negative or swearing prompts, apologies, matched words) | `find source=user`, `get_session`, `get_dashboard` (signals metric) | §4 "Workspace analytics" ("classifications"); §12 "Contents and inferences" |
| Member display names and user ids, per-member cost and activity | `get_team`, `list_sessions` (`user_id`), `get_dashboard` (top members), `find` (with `userId` for admins) | §4 account information and workspace analytics ("User-, project- or workspace-level comparisons"); §18 "team information" |
| Member emails, profile images and roles; the caller's account record (name, email, image) | `get_dashboard` `_meta["opaline/widget"]` only, read by the dashboard app (not shown to the model); app-only `app_*` tools | §4 "Account and organization information" |
| Workspace names, slugs, logos | `list_workspaces`, `settings_read` | §4 "Account and organization information" |
| Plan, seats, billing status | `get_billing` | §4 "subscription information"; §12 "Customer records and commercial information" |
| Analysis log: questions, sub-questions, findings, final answers, topics, stored `find`/`read` results, token usage of the analysis, uploaded analysis chats | `analyses`, `save_analysis`; `find`/`read` write their call to it | **Gap**, see below |
| GitHub pull request and CI facts (merged PRs, CI runs, conclusions, workflows, GitHub authors) | `get_dashboard` (`mergedPullRequests`, `ciFailuresPerPullRequest` metrics and breakdowns) when the workspace connected GitHub | **Partial gap**, see below |

### Gaps to close before submission

1. **Analysis log is not disclosed.** §18 says the plugin "can read" data and "cannot change or delete sessions or workspace data". It does not mention that every `find`/`read` call is stored with its result in the caller's analysis log, that `save_analysis` stores questions, findings and answers, that an analysis can be shared with the workspace, or how long the log is kept and how it is deleted. §18 needs a paragraph for this. The consent page and the server instructions were updated in this change.
2. **GitHub App data is not named.** §4 describes repository context captured by the CLI, but not pull request, CI run and GitHub author data collected through the GitHub App, which `get_dashboard` can return. §4 should list it as a source and data type (§5 sources too).
3. **Embeddings provider for analysis search.** With the Convex store, questions, sub-questions and topics are sent to OpenAI for embeddings (`OPENAI_API_KEY`). §7 covers AI-assisted analysis by OpenAI/Anthropic in general terms; confirm it covers this use or name it.

## Identifiers returned

| Identifier | Where | Why it is needed |
|------------|-------|------------------|
| Session id | `find`/`read` refs, `list_sessions`, `get_session`, `read_session_turn`, `analyses get` (uploaded chats), @-mention resource URIs | The session is the product's unit: every follow-up (`read`, `get_session`, links to opaline.so) addresses a session by id, and answers cite the sessions they are based on. |
| Run ref `{sessionId, agentId, turn}` and record index | `find`, `read` | Addresses one run (one prompt and the agent's work until the next) or one record so `read` can open exactly it. `agentId` is a subagent's id from the transcript (`''` is the main transcript); `parentSessionId` links a Codex subagent thread to its parent. |
| Analysis, step and query ids (`trace analysis=… step=… query=…`) | `find`, `read`, `analyses`, `save_analysis` | Drive the analysis log: later `find`/`read` calls pass the analysis and step ids so they join the same analysis, `save_analysis` names the analysis and steps it saves, and `analyses action=query` opens one stored result by query id. |
| Turn id and `revision` | `get_session` | `read_session_turn` takes them; the revision pins the transcript version the turn ids belong to. |
| Subagent id | `get_session`, `read_session_turn` | Identifies which subagent produced the activity shown. |
| Transcript record and tool-call ids (`id`, `tool_use_id`, `batch`, `sharedResultId`) | `read_session_turn` | Come from the transcript itself and tie each tool result to the call that produced it, including results shared by parallel calls. |
| Member user id | `list_sessions` (`user_id`), `get_team`, `get_dashboard` top members | Input for the member filters of `get_dashboard`, `list_sessions` and `find` (`members`, `userId`), so the agent can scope a question to a member. Shown next to the member's name. |
| Repository key, model id | `list_repositories`, `get_dashboard` | Inputs for `get_repository` and the dashboard filters. |
| Workspace slug | `list_workspaces`, `get_dashboard` | The `workspace` argument of every tool. |

Removed in this change because nothing needs them: the internal organization id from `list_workspaces` (tools take the slug), the web app's scroll-to event ids and the signal classifier version from `get_session`, and the chat owner's user id from `analyses action=get`.

Still returned and worth a reviewer's question: `find` headers include `classifier=<version>` (a version number of the deterministic failure classifier, not an identifier of a person or record; it tells which rules produced the groups of a stored result), and the dashboard app's `_meta` carries the caller's account record and the workspace member list (names, emails, images, roles) that the embedded web app needs for its member views. It is not shown to the model.

## Submission checklist

- Screenshots: `bun run plugin:screenshots` renders the dashboard app at 706x860 from the product demo seed into `plugins/opaline/assets/screenshots/` (listed in `interface.screenshots`).
- Package: `bun run plugin:zip` writes `dist/opaline-plugin-<version>.zip`.
- Production must have, before review: `MCP_PLUGIN_PUBLIC=true` (otherwise only the Opaline team can connect), `OPENAI_APPS_CHALLENGE_TOKEN` set to the dashboard's token, and the analysis log enabled for the reviewer workspace (`ANALYSIS_LOG_STORE` and `ANALYSIS_LOG_WORKSPACES`). Without the log, `analyses` and `save_analysis` return "history is off" and four of the five positive test cases cannot call `save_analysis`.
- Reviewer account: email and password sign-in without MFA or email verification, owner of a workspace with uploaded sample sessions from the last 30 days that include failed tool calls and at least five sessions.
- Deploy the API before rescanning tools: annotations and the `save_analysis` tool come from the server, not the ZIP.
