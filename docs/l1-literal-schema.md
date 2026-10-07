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

## Joins

- **Push to CI.** Pushed SHAs (`gitOperation`, push ranges) and `pr-link` records join `github_ci_runs.head_sha` and `github_ci_run_pull_requests`. Gives CI conclusions after each push, whether the run later called `gh run`/`gh pr checks`, and default-branch red intervals.
- **Repository identity.** Session to GitHub `repository_id` through the repository evidence index and `github_repository_binding`; fall back to the literal remote, then path. The UI and the analysis agent use one identity.
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

1. This spec and step 1 of the retirement.
2. Retirement steps 2 and 3.
3. Transcript-records parser v6 with the raw facts above, and backfill.
4. `run_index`, the push-to-CI and repository joins, and coverage.
5. `find` over `calls`, `runs` and `prompts`, the schema reference and premade queries in the plugin skill.
6. Retirement steps 4 and 5.
7. Signals, from queries the analysis log shows recurring in kept answers.
