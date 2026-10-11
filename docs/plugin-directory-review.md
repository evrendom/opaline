# Opaline plugin: OpenAI directory review notes

Reference for submitting the Opaline plugin (`plugins/opaline/`) and its MCP server (`https://opaline.so/api/mcp`, `apps/api/src/handlers/mcp-http.ts`) to the OpenAI plugin directory. Requirements: [submission](https://developers.openai.com/plugins/deploy/submission), [app review](https://developers.openai.com/plugins/deploy/app-review).

Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI). Per-member views exist to see where each person's setup needs help, not to rank people.

The model sees nine tools, one operation each: `search_answers`, `get_answer`, `get_answer_evidence`, `find`, `read`, `save_answer`, `share_answer`, `get_dashboard` and `list_workspaces`. Everything else is app-only (`_meta.ui.visibility = ["app"]`), called only by the dashboard app, the settings page or the host's @-mention search. Annotations are declared per tool (`annotations` in `apps/api/src/mcp/mcp-tools.ts` and `plugin-tools.ts`, constants in `tool-annotations.ts`) and published by `tools/list` with `annotations.title` set to the tool's title. `apps/api/src/mcp/mcp-tools.test.ts` pins them, the visible tool list, and the description format: every model-visible tool has five one-sentence lines (`What it does:`, `Use when:`, `Returns:`, `Side effects:`, `Limits:`), under 600 characters, without jargon, and a one-line description on every input; every app-only tool has one line ending "Not called by the assistant." Detailed guidance for the model (result columns, failure kinds, paging, how to read runs and update an answer) lives in the plugin skill (`plugins/opaline/skills/opaline/SKILL.md`).

## Why the analysis log works this way

For the review form's notes field:

> **How Opaline saves answers**
>
> Opaline answers questions about a team's coding agents, like "Where do our agents waste time?". It keeps each answer, so the next question on the same topic can start from it.
>
> - `find` and `read` look up the sessions the user is allowed to see.
> - Each `find` or `read` call also stores what it found, as part of the answer that is being worked on. Nobody can see this unfinished answer, not even the user. If it is never saved, it is deleted after 7 days.
> - `save_answer` saves the finished answer. After that, the user can see it, and so can their team if they share it. A saved answer is never changed or deleted by the plugin's tools. To update it, Opaline saves a new answer that links to the old one.
> - No tool changes or deletes the user's sessions.
>
> So `find`, `read`, `save_answer` and `share_answer` are marked as tools that write (but never delete). `search_answers` and `get_answer` only read saved answers.

## Tool annotations

Every tool works inside one Opaline workspace the signed-in account belongs to (`workspace` argument or the default workspace), through the same permission checks as the web app. No tool acts on the public internet or on any outside system on the user's behalf. The one third-party call is the search index: when `save_answer` saves an answer, Opaline sends its title and topics to OpenAI (a fixed data processor) to create an embedding; that is internal indexing, as for a memory tool, so `openWorldHint` is `false` throughout.

What each tool writes:

- Sessions: never changed or deleted by any tool.
- Analyses: written only by `find` and `read` (the private draft), `save_answer` (publishing once) and `share_answer` (sharing). These writes are additive, so their `destructiveHint` is `false`.
- The plugin's default-workspace setting: replaced only by the app-only `settings_update`, which is therefore `destructiveHint: true`.
- Every other tool writes nothing.

### Tools the model calls

| Tool (title) | readOnlyHint | openWorldHint | destructiveHint |
|------|--------------|---------------|-----------------|
| `find` (Find patterns in agent runs) | **false**: Finds where the team's agents got stuck, failed or wasted time and money, and changes no session. It also stores what it found in the answer being worked on (a private draft): nobody, the user included, can see it until `save_answer` saves it, and an unsaved draft is deleted after 7 days. Hosts may ask once; "always allow" is fine. Its inputs are only what finding runs needs (scope, filters, paging) plus the optional draft id `analysis`; it never takes the user's question or other conversation text. Each call becomes its own step, labelled from its tool and arguments. | **false**: Reads only the caller's Opaline workspace in Opaline's own database. It reaches no external system. | **false**: Nothing is deleted, overwritten or sent. |
| `read` (Read agent runs) | **false**: Shows what happened in up to 10 runs from sessions the caller may open (session owner or workspace admin), and stores what it found in the same private draft as `find`. No session changes. Its inputs are the runs to read, how much to show, and the optional draft id `analysis`; no conversation text. | **false**: Reads only the caller's Opaline workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `search_answers` (Search saved answers) | **true**: Lists saved answers about the team's coding-agent sessions, by meaning or most recent. Unsaved drafts never appear. | **false**: Reads only answers the caller saved or that were shared with the caller's workspace. | **false**: Nothing is deleted, overwritten or sent. |
| `get_answer` (Open a saved answer) | **true**: Opens one saved answer: findings, the last day its data covers, steps, links to older and newer versions, final answer. | **false**: Same visibility as `search_answers`. | **false**: Nothing is deleted, overwritten or sent. |
| `get_answer_evidence` (Open a stored result) | **true**: Returns one stored `find` or `read` result behind a saved answer, flagged when a session changed since, or why it is unavailable. | **false**: Same visibility as `search_answers`; workspaces that restrict results show them only to admins and the session's owner. | **false**: Nothing is deleted, overwritten or sent. |
| `save_answer` (Save an answer) | **false**: Saves the draft as a finished answer, with the `question` it addresses as a short title (the only place the question is given), and optionally `updates`, the saved answer it revises. It takes no conversation turns: there is no clarifications input. | **true**: The saved answer stays in the caller's Opaline workspace, but its title and topics are sent to OpenAI to build the search index, so it is marked open-world. | **false**: A saved answer is never changed or deleted: a second save is refused and changes nothing, and an update is saved as a new answer linked to the old one, with one change entry per finding (checked before anything is written). |
| `share_answer` (Share an answer) | **false**: Shares a saved answer with the caller's workspace. `shared` is not an input: the plugin cannot stop sharing, which would revoke access; that stays in Opaline's API. | **true**: Sharing makes a saved answer visible to other people (the members of the caller's own Opaline workspace). It stays inside Opaline, but because it reaches other people it is marked open-world. | **false**: It only adds access; nothing is deleted, overwritten or revoked. |
| `get_dashboard` (Opaline) | **true**: Shows the dashboard in the chat: agent cost, sessions and runs over time, by repository and model (by member in the app, and for the model only by name when split by member). The title stays "Opaline" because Codex shows it as the app's header (#185). | **false**: Aggregates the caller's workspace data in Opaline. | **false**: Nothing is deleted, overwritten or sent. |
| `list_workspaces` (List your workspaces) | **true**: Lists the names, slugs and logos of the workspaces the caller belongs to, with the number of sessions the caller can see from the last 365 days (admins: the whole team; members: their own). A count only: no session content, no draft. The setup skill uses it to check that Opaline is ready. | **false**: Only the caller's own memberships. | **false**: Nothing is deleted, overwritten or sent. |

### App-only tools (hidden from the model)

Each has a plain title and one line ("Used by … Not called by the assistant."). All are read-only except `settings_update`, which replaces the default workspace setting (only a workspace the caller belongs to is accepted): it overwrites the earlier value, so it is marked `destructiveHint: true`. `openWorldHint` is `false` for all, and `destructiveHint` is `false` for all others.

| Tool | Used by |
|------|---------|
| 23 dashboard tools with plain names, one per read-only analytics procedure (the names live in one map, `PLUGIN_TOOL_NAMES` in `packages/api-routes/src/plugin-tool-names.ts`, shared by the server and the app): `app_dashboard_metrics` (Dashboard: metrics; cost, sessions, signals, agent runs, merged pull requests, CI failures per pull request and CI runs, with trends and breakdowns), `app_dashboard_totals`, `app_dashboard_daily_activity`, `app_sessions_filters`, `app_sessions_list`, `app_sessions_summary`, `app_sessions_breakdown`, `app_sessions_upload_problems`, `app_session_overview`, `app_session_turns`, `app_session_window`, `app_session_outline`, `app_session_text`, `app_session_links`, `app_session_subagent`, `app_session_turn`, `app_skills_list`, `app_skill`, `app_repositories_list`, `app_repository`, `app_repository_overview`, `app_team_members`, `app_team_cards` | The dashboard app. Write procedures are excluded by design and by test; session-content tools open a session only for its owner or a workspace admin. |
| `app_account` (Account: you) | The dashboard app, when a view needs the caller's account: the account button in the rail, marking the caller's own sessions, admin-only links. Only the caller's own id, name, image and role. |
| `workspace_members` (Team: member names) | The dashboard app, on demand, when a view shows member names (team view, member filter): names, images and roles, no emails. |
| `get_session` (Session: mention preview) | The server, to show a session the user @-mentioned (`resources/read`). |
| `mention_sessions` (Sessions: @-mention search) | The host's @-mention search; the caller's own sessions only. |
| `settings_read`, `settings_update` (Settings: read / save) | The plugin settings page. |

Removed in this change because nothing calls them: `get_kpis`, `list_sessions`, `read_session_turn`, `get_team`, `list_skills`, `get_skill`, `list_repositories`, `get_repository`, `find_recurring_errors` and `get_billing`. The dashboard app keeps its own app-only tools for the same data.

## Data returned and privacy policy coverage

Privacy policy: `apps/marketing/src/content/legal/opaline-privacy-policy.html` (https://opaline.so/legal/privacy-policy/). Section numbers below refer to it.

**Secrets.** Opaline's server removes known secret formats from every uploaded session before storing it, whichever client uploaded it: the main transcript and every subagent transcript, on every upload path (direct upload, upload through storage, and its repair job), in `apps/api/src/services/ingest-filter.worker.ts` with `@rudel/secret-filter` (filter version 6). The rules are 18 Gitleaks formats: API keys and access tokens of providers such as OpenAI, Anthropic, AWS, Google, GitHub, GitLab, npm, Stripe, Slack, SendGrid and Twilio, Slack webhook URLs, and private keys. In short: Opaline's server removes known secret formats (API keys and access tokens for common services, private keys) from every uploaded session before storing it, and the plugin's tools redact passwords, credentials in connection strings, bearer tokens and other credential-like values from any session text they return. Every MCP tool, model-visible and app-only, is served through `withRedactedOutput` (`apps/api/src/mcp/redacted-tools.ts`): every string it returns (model text, structured content, the app's data) passes `redactReturnedText` (`@rudel/secret-filter`), which applies the 18 known formats and the CLI's credential rules: credential assignments in env, JSON (also with escaped quotes), YAML, query and code forms (`password`, `passwd`, `pwd`, `secret`, `token`, `api_key`, `apikey`, `access_key`, `client_secret` and any `*_PASSWORD`, `*_SECRET`, `*_TOKEN`, `*_KEY` name), credential flags (`--password x`, `--api-key=x`), passwords in URLs (`scheme://user:pass@host`), `Authorization: Bearer`/`Basic`/`Token` values and JWTs. Values become `[redacted]`; names and plain words stay. `find` and `read` also redact their results before storing them as answer evidence, and `get_answer_evidence` redacts stored results again when it returns them, which covers evidence stored before this change. Tests: `packages/secret-filter/src/__tests__/credential-redaction.test.ts` (each pattern) and `apps/api/src/mcp/redacted-tools.test.ts` (each pattern through `find`, `read` at every depth, `get_answer_evidence`, `get_session` and the app's session-turn tool). Repository context the CLI captures next to a session (diffs, untracked files, instruction files) is filtered by the CLI before upload and not again on the server; no plugin tool returns it.

**Answer history.** Production enables the analysis log for every workspace (`ANALYSIS_LOG_STORE=convex`, `ANALYSIS_LOG_WORKSPACES=*`), so the saved-answer tools work for every account, the reviewer's included. Their descriptions say they require it; the skill still falls back to `find` and `read` if history is ever off.

**Not returned to the model from saved answers:** where an answer was run (`host`) and the answer's own cost and token usage. The API keeps them for the web app; the plugin's renderers leave them out.

| Data type returned | Tools | Policy coverage |
|--------------------|-------|-----------------|
| Prompts, agent messages and reasoning, tool calls and their output, error lines, terminal commands, file paths, skill content | `find` (prompt heads, quotes, commands, error lines), `read`; app-only session and skill tools for the dashboard app | §4 "Coding-agent session content"; §18 "session data" |
| Repository names, branches, commit SHAs, worktree and project paths | `find`, `get_dashboard`; app-only dashboard tools | §4 session content ("repository and version-control information") and "Workspace analytics" |
| Models, token counts, estimated cost, durations, timestamps, run and session counts | `find`, `get_dashboard`; app-only dashboard tools | §4 "Workspace analytics" ("token and model usage", "timing") |
| Prompt classifications (prompts where the user was unhappy with the agent, agent apologies, matched words) | `find source=user`, `get_dashboard` (signals metric) | §4 "Workspace analytics" ("classifications"); §12 "Contents and inferences" |
| Member display names and per-member cost and activity (to see where each person's setup needs help) | `get_dashboard` (per-member rows and series by name only, and only when `splitBy` is `members`; no user ids); app-only team tools for the dashboard app | §4 account information and workspace analytics ("User-, project- or workspace-level comparisons"); §18 "team information" |
| The caller's name, profile image and own role; per-member rows of the dashboard data (user id, name, image, value) for the dashboard's member card; the member roster (names, images, roles; no email addresses) | `get_dashboard` `_meta["opaline/widget"]` (not shown to the model) carries only the workspace (name, slug, logo) and the dashboard data without rows that name people (members, GitHub authors); nothing about the caller. The caller's account loads through `app_account` when a view needs it (the account button in the rail, marking the caller's own sessions); per-member rows load through `app_dashboard_metrics` only when the user opens them ("Show members"); the roster loads through `workspace_members` only when a view shows member names | §4 "Account and organization information"; §18 (per-member dashboard) |
| Workspace names, slugs, logos | `list_workspaces`, `settings_read` | §4 "Account and organization information" |
| Analysis log: the question title given on save, step labels made from tool arguments, findings, final answers, topics, change lists, stored `find`/`read` results | `search_answers`, `get_answer`, `get_answer_evidence` (saved answers only), `save_answer` (question, findings, answer, topics, changes), `share_answer`; `find`/`read` keep their calls and results in a private draft until it is saved, and take no conversation text | §18 "analysis log" (drafts private, deleted after 7 days unless saved; only saved analyses kept; saved analyses not changed afterwards; sharing and result retention) |
| GitHub pull request and CI facts (merged PRs, CI runs, conclusions, workflows, GitHub authors; for `find source=git`, PR titles, states and branches and CI runs linked to the git events in sessions the caller may read) | `get_dashboard` (`mergedPullRequests`, `ciFailuresPerPullRequest` metrics and breakdowns), `find source=git`, when the workspace connected GitHub | §4 "GitHub information"; §5 sources |

### Privacy policy coverage

The analysis log, GitHub data, embeddings and per-member views are covered as listed below. Product analytics, support emails and database backups are described in §10 by deletion criteria rather than fixed periods.

1. **Analysis log.** §18 says that `find`/`read` calls and their results are kept as a private draft that nobody can open and that holds no conversation text, that a draft not saved is deleted 7 days after it was started, that only saved analyses are kept, with a short title of the question, and are not changed afterwards (a later answer is a new analysis referring to the earlier one), that an analysis can be shared with the workspace, and how long stored results are kept.
2. **GitHub App data.** §4 "GitHub information" names pull request and CI data from the GitHub App, and §5 lists GitHub as a source.
3. **Embeddings provider.** §7 says that the question title and topics of a saved analysis are sent to OpenAI for search embeddings, only when the analysis is saved, and never session content.
4. **Per-member views.** §18 says every workspace member can see the dashboard, including usage and estimated cost per member (the analytics procedures check workspace membership, not the admin role), and where a member can see what it shows about them. It also names the controls, as the code supports them: each member chooses which repositories upload (the CLI's per-repository upload settings), admins can remove members, and deleting an account removes its sessions from every view and dashboard and deletes every analysis that read them (the account purge). There is no self-serve deletion of single sessions; §18 says to email for it.

## Identifiers returned

| Identifier | Where | Why it is needed |
|------------|-------|------------------|
| Session id | `find`/`read` run ids, @-mention resource URIs | The session is the product's unit: `read` and links to opaline.so address a session by id, and answers cite the sessions they are based on. |
| Run `{sessionId, agentId, turn}` and record index | `find`, `read` | Addresses one run (one prompt and the agent's work until the next) or one record so `read` can open exactly it. `agentId` is a subagent's id from the transcript (`''` is the main transcript); `parentSessionId` links a Codex subagent thread to its parent. |
| Analysis, step and query ids (`trace analysis=… step=… query=…`) | `find`, `read`, `search_answers`, `get_answer`, `get_answer_evidence`, `save_answer`, `share_answer` | Later `find`/`read` calls pass the analysis id so they join the same draft, `save_answer` names the draft it saves and the steps its findings and changes refer to (by step or query id), `updates` names the saved answer an update builds on (`get_answer` shows `updates` and `updatedBy`), and `get_answer_evidence` opens one stored result. |
| Member user id | Not returned to the model, and not in `_meta`. The dashboard app receives them from app-only tools when the user opens a member view | The app's member filter and member card. `find` takes no member filter. |
| Model id | `find`, `get_dashboard` | Inputs for the `find` and dashboard filters. |
| Workspace slug | `list_workspaces`, `get_dashboard` | The `workspace` argument of every tool. |
| Default workspace flag | `list_workspaces` (`default: true`) | Names the workspace tools use when none is given, resolved the same way as for every tool call. |
| Session counts | `list_workspaces` (`sessionsLast365Days`) | The setup check: whether Opaline can answer yet, without reading any session. |

Not returned to the model: the internal organization id (tools take the slug), the web app's scroll-to event ids and the signal classifier version of the app-only session overview, the failure classifier version in `find` headers, the chats uploaded for an analysis (`get_answer` lists none), and the text of the user's next prompt in `read` (only a reaction label such as "unhappy" or "no complaint found").

Still returned and worth a reviewer's question: the dashboard app's `_meta` carries the workspace's name, slug and logo and the dashboard data without any rows or series that name people. It is not shown to the model and holds nothing about the caller. The caller's account, per-member rows and the member roster load through app-only tools only when a view shows them; every procedure checks authorization on the server. In a real render, a full-width first view loads `app_account` for the account button in its rail. The listing screenshots hide the per-member breakdown.

## Submission checklist

- Screenshots: optional, and not included in 1.2.1. When screenshots are supplied, the portal expects one per starter prompt, each showing that prompt's result; `bun run plugin:screenshots` can render the dashboard app at 706x860 for a later version.
- Package: `bun run plugin:zip` writes `dist/opaline-plugin-<version>.zip`.
- Production must have, before review: `MCP_PLUGIN_PUBLIC=true` (otherwise only the Opaline team can connect), `OPENAI_APPS_CHALLENGE_TOKEN` set to the dashboard's token. The analysis log is already on for every workspace (see "Answer history" above).
- Reviewer account: email and password sign-in without MFA or email verification, owner of a workspace with about 36 sample sessions over 6 weeks from several members: a recurring web-app mistake caused by outdated docs (a missing typecheck script, dollars instead of cents) that stops after the docs are fixed around September 14, and `no-console` lint friction across members. The test cases are written for that data without fixed numbers.
- Password sign-in only exists for the emails in `PASSWORD_AUTH_EMAILS`; every other account uses an email code or Google/GitHub. Production must list `openai-review@opaline.so`, `openai-review-sam@opaline.so` and `openai-review-priya@opaline.so`, or the reviewers cannot sign in. Reviewer sign-in instruction (the same on the plugin's OAuth sign-in page): "Choose Log in with Email and enter the email. The password field appears; enter the password and click Sign in."
- Deploy the Convex functions (`bun run convex:deploy`, see `convex/README.md`) before the API that uses drafts, then the API, before rescanning tools: annotations, descriptions and the draft and append-only behaviour come from the server, not the ZIP.
