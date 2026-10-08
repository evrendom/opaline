# L1: the literal session schema

L1 is the deterministic layer every analysis reads: what the transcripts, usage and GitHub recorded, normalized across Claude Code and Codex, with nothing inferred. The decision and its reasons are in [ADR 0002](adr/0002-literal-l1-for-analysis.md). This document is the target schema, where each fact comes from, what is missing today, and the order of work.

## Rules

1. **Literal values.** A column holds what the source recorded (`permission-rule`, `workspace-write`, `interrupted`), under one name for both agents. No labels, scores, buckets or archetypes.
2. **Unknown is not false.** Every fact is nullable or has an explicit empty value meaning "not recorded". Each row carries `source` (agent) and `agent_version`, so a missing value can be told apart from a version that never emits it.
3. **Replayable.** Facts come from the parser (`TRANSCRIPT_RECORDS_PARSER_VERSION`) over the stored raw transcript, kept for 365 days. Slimming keeps every record but replaces inline images with markers, and the secret filter redacts matched credentials, so only what survives both can be replayed. Adding a fact the stored transcript carries means a parser bump and `backfill:transcript-records`; facts the transcript never records (approved permission prompts) need capture.
4. **Coverage is a fact.** What was not captured (a member who does not upload, a repository without the GitHub App, an extraction that hit its bounds) is stored and reported, not silently missing.
5. **Narrow interface.** The analysis agent sees three views (`calls`, `runs`, `prompts`) behind `find`, a schema reference and premade queries. New facts add columns and enum values, not tools or parameters.

## Views

Each view is one row per thing, keyed by `(organization_id, user_id, session_id, agent_id, …)` and pinned to the committed transcript-records generation. "Today" says where the fact lives now: **stored** (typed column), **text** (only inside record text), **raw** (only in the raw transcript), **none** (not captured), **join** (inputs stored, join not built).

### `calls`: one row per tool call, its result joined

| Column | Claude source | Codex source | Today |
|---|---|---|---|
| `tool_name`, `call_id` | `tool_use.name`, `.id` | `function_call` / `custom_tool_call` / `item_completed.item` | stored |
| `input_text` | `tool_use.input` (Bash `command`) | `arguments`, `command` | stored (`text`, 64K cap) |
| `command_argv0`, `command_prefix` | first words of the shell command | `parsed_cmd`, `command` | none |
| `command_fingerprint`, `command_simhash` | normalized command / written script | same | none |
| `is_error`, `exit_code` | `tool_result.is_error`, transport framing | `exit_code`, `status = failed` | stored |
| `denial_kind` | `toolDenialKind` (`permission-rule`, `user-rejected`, `cancelled`) | sandbox and approval outcome when recorded | raw (Claude); text (Codex) |
| `return_code_interpretation` | `toolUseResult.returnCodeInterpretation` | none | raw |
| `duration_ms` | `toolUseResult.durationMs` / `durationSeconds` | `item.duration`, `completed_at_ms - started_at_ms` | raw |
| `timed_out_after_ms`, `timeout_ms` | `toolUseResult.timedOutAfterMs`, `timeoutMs` | none | raw |
| `is_async`, `background_task_id` | `toolUseResult.isAsync`, `backgroundTaskId`, input `run_in_background` | running preamble | raw (subtype `running` only) |
| `interrupted`, `no_output_expected` | `toolUseResult.interrupted`, `noOutputExpected` | `turn_aborted` | raw |
| `stdout_chars`, `stderr_chars`, `persisted_output_bytes` | `toolUseResult.stdout`, `stderr`, `persistedOutputSize` | `stdout`, `stderr`, `aggregated_output` | text (merged) |
| `result_chars` | result text | output text | stored (`text_chars`) |
| `shell_edit_files` | `toolUseResult.bashEditDiff.files` / `changedFiles` | shell-inferred `file_change` | raw (Claude) |
| `git_operation` | `toolUseResult.gitOperation` (`push`, `pr`, `branch`, `commit`) | none (observations parser) | raw |
| `mcp_server`, `mcp_tool`, `mcp_read_only` | `attributionMcpServer`, `attributionMcpTool`, `mcpMeta` | `McpToolCall.server`, `.tool`, `.readOnlyHint`, `pluginId` | text (tool name only) |
| `file_path`, `file_op` | Read/Write/Edit input | patch paths | stored |
| `patch_lines_added`, `patch_lines_removed`, `user_modified` | `toolUseResult.structuredPatch`, `userModified` | `FileChange.changes` | raw |
| `stale_read` | `toolUseResult.staleReadFileStateHint` | none | raw |
| `search_matches` | `toolUseResult.numFiles`, `matches` | none | raw |
| `spawned_agent_id` | Task/Agent result `agentId` | `SubAgentActivity.agent_thread_id`, `CollabAgentToolCall.receiver_thread_ids` | stored (Claude); raw (Codex) |
| `attribution_skill`, `attribution_plugin`, `attribution_agent` | assistant `attributionSkill`, `attributionPlugin`, `attributionAgent` | `pluginId` | raw |
| `cwd`, `git_branch` | per-record `cwd`, `gitBranch` | `turn_context.cwd` | session-level only |

### `runs`: one row per run (one human prompt and everything until the next)

| Column | Claude source | Codex source | Today |
|---|---|---|---|
| `started_at`, `ended_at`, `minutes`, `active_minutes` | record timestamps | `task_started`, `task_complete` | computed per query |
| `duration_ms`, `time_to_first_token_ms` | none | `task_complete.duration_ms`, `time_to_first_token_ms` | raw |
| `prompt_origin` | `turnOrigin`, `promptSource`, `origin.kind` | `inter_agent_communication_metadata`, `thread_source` | text heuristic (wrappers) |
| `permission_mode` | `permissionMode` | none | collapsed to plan/default |
| `auto_mode_*` | `attachment.auto_mode` (`bashFirst`, `bashFirstSteer`, `bypass`) | none | raw |
| `approval_policy`, `approvals_reviewer`, `sandbox_policy`, `permission_profile` | none | `turn_context.*` | raw |
| `model`, `effort` | `message.model`, `effort`, `perTurnEffort` | `turn_context.model`, `.effort` | model stored (usage); effort raw |
| `entrypoint`, `agent_version` | `entrypoint`, `version` | `originator`, `cli_version` | raw |
| `cost_usd`, tokens by kind | `usage_events` | `usage_events` (`token_count`; `token_usage_record` unused) | stored; tokens not exposed |
| `context_window`, `context_input_tokens_at_start` | usage | `task_started.model_context_window`, usage | raw / stored |
| `compacted`, `compact_trigger`, `compact_pre_tokens` | `compact_boundary`, `compactMetadata` | `compacted`, `compaction` | boundary stored; rest raw |
| `tool_calls`, `failed_calls`, `denied_calls`, `edits`, `reads`, `searches`, `not_found` | from `calls` | from `calls` | computed per query (no denied) |
| `aborted`, `abort_reason`, `turn_error` | interrupt markers, `interruptedByShutdown` | `turn_aborted.reason`, `task_complete.error` | text / raw |
| `stop_reason` | assistant `message.stop_reason` | none | raw |
| `hook_stop_reason`, `hook_errors`, `prevented_continuation` | system `stopReason`, `hookErrors`, `preventedContinuation` | none | text |
| `hook_runs` (command, duration) | system `hookInfos` | none | raw |
| `api_errors`, `retry_attempts`, `refusals`, `fallback_model` | `apiErrorStatus`, `retryAttempt`, `model_refusal*`, `fallbackModel` | none | text / raw |
| `goal` | none | `thread_goal_updated.goal` | raw |
| `pushed_shas`, `pr_repository`, `pr_number` | `pr-link` records, `gitOperation`, git output | git output | regex observations; `pr-link` raw |
| `ci_runs_after_push`, `ci_checked_after_push` | `github_ci_runs` by pushed SHA; later `gh run`/`gh pr checks` calls | same | join |
| `repository_id` | repository evidence index, GitHub binding | same | heuristic key in the UI, literal coalesce in analysis |

### `prompts`: one row per prompt or injected context

| Column | Source | Today |
|---|---|---|
| `kind`, `subtype` | records (`user_prompt`, `injected_context`, `queued`, `delegation`) | stored; origin by wrapper heuristic |
| `prompt_origin` | Claude `turnOrigin`, `promptSource`, `origin.kind`; Codex inter-agent metadata | raw |
| `text`, `text_chars` | prompt text | stored |
| `instruction_path`, `instruction_sha256` | `nested_memory` path, `instructions`, AGENTS.md injection | path partly stored; hash none |
| `edited_by_user_path` | `attachment.edited_text_file` | stored (`file_path` on the injected-context row) |

## Session and workspace facts

| Fact | Source | Today |
|---|---|---|
| `cost_state` (`totalCostUSD`, `totalLinesAdded`, `totalLinesRemoved`, `totalToolDuration`, `totalAPIDuration`) | Claude `cost-state` record | raw |
| title | Claude `ai-title` | raw |
| upload mode (`hook`, `manual`, `retry`) | CLI request | not stored |
| member coverage (members uploading / members in workspace, per day) | `session_ownership` × membership | join |
| instruction file versions per session | injected context, repository evidence | none |
| permission prompts that were approved | not in transcripts; needs a capture hook | none |

## Sessions, pull requests and CI

Connecting every session to the pull requests and CI runs it touched is required. Each link is a row that keeps the rule that made it, the literal values it matched, and how many candidates matched, so the agent can see a guess for what it is. Nothing is dropped because it did not match: an unmatched push stays a push with an empty match and a reason.

| Link | From | To | Rule stored with the row |
|---|---|---|---|
| Session repository | session `git_remote`; Codex `session_meta.git.repository_url`; push `To <remote>`; PR URL `owner/name`; repository evidence index | active `github_repository_binding.repository_id` | basis (`remote`, `codex_meta`, `push_remote`, `pr_url`, `evidence_index`) and the literal value |
| Observation turn | `session_git_observations` row | `transcript_records` call and result | same generation, `record_idx`, `block_idx / 65536`, `call_id`; gives `turn_idx` |
| PR mentioned or created | `pr_url`, `mcp_pr_created`, Claude `pr-link` | `github_pull_requests` (repository, number) | observation kind; whether the call was `gh pr create` |
| Pushed SHA | push `push_to_sha` (abbreviated) | full SHA in `github_pull_request_commits`, `github_pull_requests.head_sha` or `github_ci_runs.head_sha` | prefix match within the repository; `candidate_count`; matched only when it is 1 |
| Pushed branch | push `branch` | `github_pull_requests.head_ref` | exact; PR created/updated times kept as values, not filters |
| Commit in PR | `commit_created.short_sha` | `github_pull_request_commits.sha` | prefix match; whether the PR head still contains it |
| CI on a pushed SHA | resolved full SHA | `github_ci_runs.head_sha` (all runs, any branch) | run kind, event, attempt, conclusion, time from push to run |
| CI on a PR | linked PR | `github_ci_run_pull_requests` → `github_ci_runs` | `basis` (`provider`, `head-sha`) |
| PR from the session's HEAD | `github_pull_request_snapshot` | the session | capture commit, coverage flags |
| Commits per capture | `repository_evidence_capture` base and head commits | PR commits and CI runs | lifecycle (`checkpoint`, `end`), capture time |
| CI checked after push | `ci_check` observations after the push in the same stream | the push | the check command, exit code, delay |
| Not covered | binding, readiness, retention boundary, observation receipt, new-branch push without SHA | the session | the reason, never an empty result |

Git extractor version 3 records the `To <remote>` of each push, new-branch pushes and `ci_check` calls. Parser v6 adds Claude `pr-link` and `gitOperation`.

## GitHub evidence in L1

Reviews, review comments, issue comments, PR files with patches, check runs and annotations, commit statuses, workflow jobs and job logs are collected per commit today but stored only as JSON and log objects in R2. They move into ClickHouse tables keyed by workspace, repository, PR number and SHA, keeping the provider's literal fields (author, path, line, body, state, conclusion) after the secret filter, so review comments and CI failures can be searched and joined to the sessions above. Job logs keep their redacted text with byte offsets, as `transcript_records` does for transcripts.

## Repository configuration

The CLI already captures CI workflows, `package.json` scripts, hooks, `AGENTS.md`, `CLAUDE.md` and skills as files. They get indexed per capture: workflow jobs, steps and the commands they run; script names and commands; hook events and commands; instruction and skill files with their content hash. A session then links to the configuration it ran under, and a check that exists but is never run is visible.

## Drift, retention and capture gaps

- **Drift.** Claude Code and Codex add transcript fields often. A recurring census lists, per agent and version, every raw field path the parsers do not map, so new facts become work items instead of silent losses. The smoke test at the parser fixture level fails when a fact in this spec stops landing in its column.
- **Retention.** Raw transcripts and `transcript_records` expire after 365 days. `run_index`, the GitHub links and the weekly aggregates get their own, longer retention so findings stay comparable over time; text stays bound to the transcript's retention.
- **Capture gaps.** Approved permission prompts are not in transcripts and need a capture hook. Sessions that were never uploaded can only be counted through coverage. Cost per tool call has no defensible allocation and stays per request and per run.
- **Scope.** Claude Code and Codex only.

## Joins

- **Instruction size.** Injected instruction characters per run, per instruction file hash. Transcripts record cache tokens per request, not per file, so a cost per instruction file is an estimate built on top of L1, not an L1 fact.

## Scale

Run facts are recomputed on every `find` today (`FINAL` over `transcript_records`, no text skip index), which is why `find` caps scope at 10,000 sessions and its text scans at 100,000 records or 64 MiB, on top of per-statement ClickHouse limits. `run_index` materializes `runs` per committed generation, written by a derived worker after receipt publication, covered by the purge and tombstone fence and by the retirement sweep like `transcript_records`. Weekly per-workspace aggregates sit on top for team-wide counts.

## Retiring interpretations

Order per item: stop reading, stop writing (materialized views and recovery SQL), drop storage.

1. **No first-party consumer, delete now.** `analytics.roi.*`, `learnings.*`, `errors.*`, `projects.*`, `developers.*` except `list` and `teamCards`, `overview.insights`, `successRate`, `teamSummaryComparison`, `usageTrend`, `modelTokensTrend`, `usersTokenUsage`, `repositoriesDailyTrend`, `sessions.summary`, their services, the unused dashboard page chain in the web app, and the generated `content.schema.ts`.
2. **Fetched but never shown.** `success_score` (and the plugin code that strips it), `has_commit`, `used_plan_mode`, `avg_period_sec` and `median_period_sec`, the Wrapped archetype on team cards and its rebuild pipeline.
3. **Derived columns with no reader.** `session_archetype`, `error_pattern`, the response-gap buckets, `inference_duration_sec` and `human_duration_sec`; then the `skill_assessments` column of the evidence index.
4. **Live, replace first.** `error_count` with counted `is_error` records; the regex `skills`, `slash_commands` and `subagent_types` with `skill_uses` and records; `resolveRepoIdentity` with the repository identity join; wrapper-regex prompt origin with the native origin fields; `model_used` with per-request models.
5. **Analysis-agent classifiers** (failure classifier, `toolGroup`, reactions): removed from the tool interface once literal `find` ships; `command_class` stays stored beside `command_prefix`.

The language-signal lexicon stays: it stores literal phrase matches.

## Order of work

1. This spec and step 1 of the retirement. Done.
2. Retirement step 2. Done.
3. Git extractor version 3 and the session, pull request and CI links, exposed to `find`.
4. Retirement step 3 with the `session_analytics` migration.
5. Transcript-records parser v6 with the raw facts above, its fixture test, and backfill.
6. `run_index`, coverage and retention; then retirement step 4 (`error_count`, regex skills).
7. GitHub evidence and repository configuration in ClickHouse.
8. `find` over `calls`, `runs` and `prompts`, the schema reference and premade queries in the plugin skill.
9. The drift census and retirement step 5.
10. Signals, from queries the analysis log shows recurring in kept answers.
