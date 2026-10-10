# L1: the literal session schema

L1 is the deterministic layer every analysis reads: what the transcripts, usage and GitHub recorded, normalized across Claude Code and Codex, with nothing inferred. The decisions and their reasons are in [ADR 0002](adr/0002-literal-l1-for-analysis.md) (literal facts) and [ADR 0003](adr/0003-l1-evidence-entities-edges.md) (evidence, entities and edges). This document is the target schema, where each fact comes from, what is missing today, and the order of work.

## Rules

1. **Literal values.** A column holds what the source recorded (`permission-rule`, `workspace-write`, `interrupted`), under one name for both agents. No labels, scores, buckets or archetypes.
2. **Unknown is not false.** Every fact is nullable or has an explicit empty value meaning "not recorded". Each row carries `source` (agent) and `agent_version`, so a missing value can be told apart from a version that never emits it.
3. **Replayable.** Facts come from the parser (`TRANSCRIPT_RECORDS_PARSER_VERSION`) over the stored raw transcript, kept for 365 days. Slimming keeps every record but replaces inline images with markers, and the secret filter redacts matched credentials, so only what survives both can be replayed. Adding a fact the stored transcript carries means a parser bump and `backfill:transcript-records`; facts the transcript never records (approved permission prompts) need capture.
4. **Coverage is a fact.** What was not captured (a member who does not upload, a repository without the GitHub App, an extraction that hit its bounds) is stored and reported, not silently missing.
5. **Narrow interface.** The analysis agent sees three views (`calls`, `runs`, `prompts`) behind `find`, a schema reference and premade queries. New facts add columns and enum values, not tools or parameters.
6. **Evidence, entities, edges.** Evidence is immutable and replaced only by a new generation; entities (pull requests, commits, CI run attempts) are one full row per version; relationships are edge rows written by one reconciliation worker, each naming its `relation`, `basis` and witness `evidence_id`. Inferences are candidates, kept out of L1. `find` reads; it does not resolve.
7. **ClickHouse for data, Postgres for control.** Everything analysis reads is in ClickHouse, including evidence captured through Postgres protocols (published as immutable copies). Postgres keeps auth, bindings, upload and sweep state, and the worker's queue, claims and watermarks.

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
| `denial_kind` | `toolDenialKind` (`permission-rule`, `user-rejected`, `cancelled`) | sandbox and approval outcome when recorded: the variant at the start of a refused call's output (`Codex(Sandbox(Denied …`, `Rejected(…`) | stored (Claude, parser v6; Codex `Sandbox(Denied)`/`Rejected`, parser v8) |
| `denial_reason` | none | the message of a `Rejected("…")` refusal (`rejected by user`, `` `<command>` rejected: blocked by policy ``) | stored (Codex, parser v8) |
| `return_code_interpretation` | `toolUseResult.returnCodeInterpretation` | none | stored (parser v6) |
| `duration_ms` | `toolUseResult.durationMs` / `durationSeconds` | `item.duration`, `completed_at_ms - started_at_ms` | stored (parser v6) |
| `timed_out_after_ms`, `timeout_ms` | `toolUseResult.timedOutAfterMs`, `timeoutMs` | `exec_command` argument `timeout_ms` (the limit; Codex records no timed-out call) | stored (parser v6; Codex `timeout_ms`, parser v8) |
| `is_async`, `background_task_id` | `toolUseResult.isAsync`, `backgroundTaskId`, input `run_in_background` | running preamble | stored (Claude, parser v6); subtype `running` (Codex) |
| `interrupted`, `no_output_expected` | `toolUseResult.interrupted`, `noOutputExpected` | a stopped call's output `aborted by user after <s>s` (with its duration); `turn_aborted` for the run | stored (Claude, parser v6; Codex calls, parser v8) |
| `stdout_chars`, `stderr_chars`, `persisted_output_bytes` | `toolUseResult.stdout`, `stderr`, `persistedOutputSize` | `stdout`, `stderr`, `aggregated_output` | stored (Claude, parser v6); text (Codex, merged) |
| `result_chars` | result text | output text | stored (`text_chars`) |
| `shell_edit_files` | `toolUseResult.bashEditDiff.files` / `changedFiles` | shell-inferred `file_change` | stored (Claude, parser v6) |
| `git_operation` | `toolUseResult.gitOperation` (`push`, `pr`, `branch`, `commit`) | none (observations parser) | stored (parser v6) |
| `mcp_server`, `mcp_tool`, `mcp_read_only` | `attributionMcpServer`, `attributionMcpTool`, `mcpMeta` | `McpToolCall.server`, `.tool`, `.readOnlyHint`, `pluginId` | stored (parser v6; `mcp_read_only` Codex only) |
| `file_path`, `file_op` | Read/Write/Edit input | patch paths | stored |
| `patch_lines_added`, `patch_lines_removed`, `user_modified` | `toolUseResult.structuredPatch`, `userModified` | `FileChange.changes` | stored (Claude, parser v6); Codex in `file_change` text |
| `stale_read` | `toolUseResult.staleReadFileStateHint` | none | stored (parser v6) |
| `search_matches` | `toolUseResult.numFiles`, `matches` | none | stored (`numFiles`, parser v6) |
| `spawned_agent_id` | Task/Agent result `agentId` | `SubAgentActivity.agent_thread_id`, `CollabAgentToolCall.receiver_thread_ids` | stored (Claude); Codex thread ids stored (parser v7) |
| `attribution_skill`, `attribution_plugin`, `attribution_agent` | assistant `attributionSkill`, `attributionPlugin`, `attributionAgent` | `pluginId` | skill (Claude) and plugin (Codex) stored (parser v6); rest raw |
| `skill`, `parsed_cmd_types`, `parsed_cmd_read_paths` | `Skill` tool call `input.skill` (the invocation; `attributionSkill` marks the lines after it); a `Read` of a `SKILL.md` keeps its path | `CommandExecution.parsed_cmd`: Codex's own part types and the paths of its `read` parts (a skill is used by reading its `SKILL.md`) | stored (parser v8) |
| `cwd`, `git_branch` | per-record `cwd`, `gitBranch` | `turn_context.cwd` | session-level only |

Parser v6 writes call facts on the row of the line that carries them. Claude facts sit on the `tool_result` (MCP identity also on the `tool_call`). Codex facts sit on the completion row with the same `call_id` (`item_completed:*_mirror`, `exec_command_end`), because the completion can arrive before or after the output, or with no output after it; nested items carry them on their own `tool_result`. A Claude line holding several results keeps its line-level `toolUseResult`/`toolDenialKind` off every result, since the line does not say which call they belong to; current Claude Code writes one result per line. Long fact values (over 32 characters) share a session budget (4M characters): past it a record drops them and says `facts_truncated`; short values are always kept. Prompt and session facts (parser v8) sit on the prompt's records (Claude `turnOrigin`, `promptSource`, `origin.kind`, not on tool results of the same line), the Codex `session_meta` and `inter_agent_communication_metadata` rows, the Claude `instructions` attachment (`instruction_paths`), `cost-state` rows (cumulative; the session's last one holds the totals) and `ai-title` rows (the title is also the row's text). Run facts (parser v7) sit on the record that carries them: a Codex `turn_context`, `task_started`, `task_complete`, `turn_aborted` or `thread_goal_updated` row, a Claude prompt or assistant line (permission mode, model, effort, stop reason on each of its records), or a Claude system or attachment row; a run reads them from its records. Codex writes `task_started` and `turn_context` before the turn's prompt, so those rows carry the previous run's `turn_idx`; each lifecycle row keeps the Codex `turn_id`, which the turn's `task_complete` or `turn_aborted` also carries, and a run joins its rows by it. A failed Codex task is an error row whose text is the error; a goal row's text is the full objective. Values cut at their cap are listed in `facts_clipped`, and entries cut from a list are counted under its `_more` key.

### `runs`: one row per run (one human prompt and everything until the next)

| Column | Claude source | Codex source | Today |
|---|---|---|---|
| `started_at`, `ended_at`, `minutes`, `active_minutes` | record timestamps | `task_started`, `task_complete` | stored (`run_index`) |
| `duration_ms`, `time_to_first_token_ms` | none | `task_complete.duration_ms`, `time_to_first_token_ms` | stored (Codex, parser v7); per run in `run_index` |
| `prompt_origin` | `turnOrigin`, `promptSource`, `origin.kind` | `inter_agent_communication_metadata`, `thread_source` | stored (parser v8); prompt kind still by wrapper heuristic, which `run_index` names (`prompt_origin_basis`) |
| `permission_mode` | `permissionMode` | none | stored (Claude, parser v7); per run in `run_index` |
| `auto_mode_*` | `attachment.auto_mode` (`bashFirst`, `bashFirstSteer`, `bypass`) | none | stored (Claude, parser v7); per run in `run_index` |
| `approval_policy`, `approvals_reviewer`, `sandbox_policy`, `permission_profile` | none | `turn_context.*` | stored (Codex, parser v7); per run in `run_index` |
| `model`, `effort` | `message.model`, `effort`, `perTurnEffort` | `turn_context.model`, `.effort` | model stored (usage); model and effort per record stored (parser v7); per run in `run_index` |
| `entrypoint`, `agent_version` | `entrypoint`, `version` | `originator`, `cli_version` | stored (parser v6, every record); per run in `run_index` |
| `cost_usd`, tokens by kind | `usage_events` | `usage_events` (`token_count`; `token_usage_record` unused) | stored; priced per run in `run_index` at build time (`pricing_version`), tokens by kind included |
| `context_window`, `context_input_tokens_at_start` | usage | `task_started.model_context_window`, usage | `context_window` stored (Codex, parser v7); start tokens from usage; both per run in `run_index` |
| `compacted`, `compact_trigger`, `compact_pre_tokens` | `compact_boundary`, `compactMetadata` | `compacted`, `compaction` | boundary stored; trigger and pre-tokens stored (Claude, parser v7); `compactions` per run in `run_index` |
| `tool_calls`, `failed_calls`, `denied_calls`, `edits`, `reads`, `searches`, `not_found` | from `calls` | from `calls` | stored (`run_index`; `denied_calls` from `denial_kind`) |
| `aborted`, `abort_reason`, `turn_error` | interrupt markers, `interruptedByShutdown` | `turn_aborted.reason`, `task_complete.error` | stored (parser v7); Claude interrupt markers in text, counted per run in `run_index` |
| `stop_reason` | assistant `message.stop_reason` | none | stored (Claude, parser v7); per run in `run_index` |
| `hook_stop_reason`, `hook_errors`, `prevented_continuation` | system `stopReason`, `hookErrors`, `preventedContinuation` | none | stored (Claude, parser v7); per run in `run_index` |
| `hook_runs` (command, duration) | system `hookInfos` | none | stored (Claude, parser v7); per run in `run_index` |
| `api_errors`, `retry_attempts`, `refusals`, `fallback_model` | `apiErrorStatus`, `retryAttempt`, `model_refusal*`, `fallbackModel` | none | stored (Claude, parser v7); per run in `run_index` |
| `goal` | none | `thread_goal_updated.goal` | stored (Codex, parser v7); per run in `run_index` |
| `pushed_shas`, `pr_repository`, `pr_number` | `pr-link` records, `gitOperation`, git output | git output | regex observations; `pr-link` stored (parser v6); `run_index` keeps the recorded branches, commit SHAs and PR URLs, and links follow the edges by `run_id` |
| `ci_runs_after_push`, `ci_checked_after_push` | `github_ci_runs` by pushed SHA; later `gh run`/`gh pr checks` calls | same | join |
| `repository_id` | repository evidence index, GitHub binding | same | heuristic key in the UI, literal coalesce in analysis |

### `prompts`: one row per prompt or injected context

| Column | Source | Today |
|---|---|---|
| `kind`, `subtype` | records (`user_prompt`, `injected_context`, `queued`, `delegation`) | stored; origin by wrapper heuristic |
| `prompt_origin` | Claude `turnOrigin`, `promptSource`, `origin.kind`; Codex inter-agent metadata | stored (parser v8) |
| `text`, `text_chars` | prompt text | stored |
| `instruction_path`, `instruction_sha256` | `nested_memory` path, `instructions`, AGENTS.md injection | paths stored (Claude, parser v8); hash none |
| `edited_by_user_path` | `attachment.edited_text_file` | stored (`file_path` on the injected-context row) |

## Session and workspace facts

| Fact | Source | Today |
|---|---|---|
| `cost_state` (`totalCostUSD`, `totalLinesAdded`, `totalLinesRemoved`, `totalToolDuration`, `totalAPIDuration`) | Claude `cost-state` record | stored (Claude, parser v8) |
| title | Claude `ai-title` | stored (Claude, parser v8) |
| upload mode (`hook`, `manual`, `retry`) | CLI request | not stored |
| member coverage (members uploading / members in workspace, per day) | `session_ownership` × membership | join |
| instruction file versions per session | injected context, repository evidence | none |
| permission prompts that were approved | not in transcripts; needs a capture hook | none |

## Sessions, pull requests and CI

Connecting every session, and the run inside it, to the commits, pull requests and CI runs it touched is required, in both directions: from a run to its pull requests and CI, and from a pull request to every run that created, pushed or named its commits. Each link is an edge row (ADR 0003) that keeps the relation, the basis, the literal values it matched, how many candidates matched and the evidence row that witnesses it, so the agent can see a guess for what it is. Nothing is dropped because it did not match: an unmatched push stays evidence with no edge and a reason.

### Edges

One table, `rudel.l1_edges`, holds every relationship, ordered by its source (`organization_id, from_kind, from_id, relation, to_kind, to_id, evidence_id`); a single-source materialized view copies it into `rudel.l1_edges_by_target`, ordered by target, for the reverse direction. Rows are full replacements versioned by `revision`, with `is_active = 0` for a retracted relationship. Kinds: `run` (`user/source/session/agent/run start record`: the raw record index stays stable while a transcript grows, so re-uploads keep the same ids; the generation an edge came from is a column), `session` (`user/source/session/agent`, for evidence that belongs to no run: PR snapshots, captures, Codex session metadata, observations before the first prompt; never assigned to a run by time), `commit` (`repository/full SHA`), `pull_request` (`repository/number`), `ci_run` (`repository/kind/run id/attempt`). Id components are percent-encoded. Each source keeps a resolution row per evidence row (`rudel.l1_edge_resolutions`: linked, unbound, not GitHub, no repository, ambiguous with its candidate count, not found), so evidence without an edge still says why.

| Relation | From → to | Basis | Witness |
|---|---|---|---|
| `commit_created` | run → commit | `transcript` (commit output), `hook` | the observation or hook record |
| `commit_pushed` | run → commit | `transcript` (push range), `hook` | the observation or hook record |
| `commit_captured` | session → commit | `capture` (the capture's base or head commit; not proof of a push) | the capture |
| `sha_mentioned` | run or session → commit | `transcript` (CI check `--commit`, Codex HEAD) | the observation |
| `pr_named` | run → pull_request | `transcript` (PR URL, `gh pr create`, MCP, `gh pr checks <n>`) | the observation |
| `pr_branch_head` | run → pull_request | `transcript` (pushed or checked branch is the PR's head) | the observation |
| `pr_listed` | session → pull_request | `capture` (GitHub listed the PR for the captured commit) | the snapshot |
| `ci_named` | run → ci_run | `transcript` (`gh run view|watch <id>`, MCP `run_id`) | the observation |
| `ci_on_branch_window` | run → ci_run | `transcript` (a check names a branch; runs of the day before it) | the observation |
| `commit_in_pr` | commit → pull_request | `github` (PR commits; `merge_commit` for a merged PR's merge SHA, never an open PR's test merge) | the membership or PR row |
| `ci_on_sha` | commit → ci_run | `github` (run `head_sha`) | the run row |
| `ci_for_pr` | pull_request → ci_run | `github` (`github_ci_run_pull_requests`, with GitHub's link basis) | the link row |

A run's pull requests and CI runs are followed through these edges (run → commit → pull request → CI), never recomputed. An abbreviated SHA becomes a `commit` edge only when exactly one collected commit of the repository starts with it; otherwise the observation keeps its candidate count and no edge is written. Completeness of a run's CI is a property of the edges' coverage: a source's watermark says up to when its edges are complete.

### Worker

The reconciliation worker rebuilds a scope when an input changes: a session generation (git observations published, transcript reparsed, capture or snapshot published), a repository's pull requests or commits (sweep or webhook), or its CI runs. Its queue, claims, revisions and watermarks are Postgres rows; its output is ClickHouse rows. A rebuild is deterministic for its scope and the GitHub state it read, writes new revisions and retracts edges that no longer hold, and is fenced by purge tombstones. Run-side edges depend on GitHub data (a unique SHA prefix, a branch's PRs, a run's attempts), so a repository change re-queues the sessions that depend on it while they are open (14 days after their last evidence); older edges are frozen against the coverage recorded on their scope. An expired transcript never retracts edges.

What a build records so a reader can trust it (resolver version 2): a repository build stores the collection coverage it read before the GitHub tables (included, PR and CI start, `coveredThrough`, read time), so counts from GitHub-side edges are complete up to it; a session build stores the coverage of every repository its links touch, a fork pull request's base included, and whether it hit its evidence caps (`truncated`). A CI check's branch search keeps a `branch_ci_run` resolution (`linked`, `not_found`, or `capped` when more runs may exist), so an empty capped search never reads as none, and CI edges keep the run's creation time.

### Evidence it reads

| Link | From | To | Rule stored with the row |
|---|---|---|---|
| Session repository | session `git_remote`; Codex `session_meta.git.repository_url`; push `To <remote>`; PR URL `owner/name`; repository evidence index | active `github_repository_binding.repository_id` | basis (`remote`, `codex_meta`, `push_remote`, `pr_url`, `evidence_index`) and the literal value |
| Observation turn | `session_git_observations` row | `transcript_records` call and result | same generation, `record_idx`, `block_idx / 65536`, `call_id`; gives `turn_idx` |
| PR mentioned or created | `pr_url`, `mcp_pr_created`, Claude `pr-link` | `github_pull_requests` (repository, number) | observation kind; whether the call was `gh pr create` |
| Pushed SHA | push `push_to_sha` (abbreviated) | full SHA in `github_pull_request_commits`, `github_pull_requests.head_sha` or `github_ci_runs.head_sha`, over all collected history | prefix match within the repository; `candidate_count`; matched only when it is 1 |
| Pushed branch | push `branch` | `github_pull_requests.head_ref` | exact; PR created/updated times kept as values, not filters |
| Commit in PR | `commit_created.short_sha` | `github_pull_request_commits.sha` | prefix match; whether the PR head still contains it |
| CI on a pushed SHA | resolved full SHA | `github_ci_runs.head_sha` (all collected runs, any branch, any date) | run kind, event, attempt, conclusion, time from push to run |
| CI run a check names | `ci_check.run_id` | `github_ci_runs.run_id` (every attempt) | `named_run` |
| CI on a checked branch | `ci_check.branch` | `github_ci_runs.head_branch`, created in the day before the check | `branch`; at most 2,000 runs per branch and page, beyond which the count is unknown |
| CI on a PR | linked PR | `github_ci_run_pull_requests` → `github_ci_runs` | `basis` (`provider`, `head-sha`) |
| PR from the session's HEAD | `github_pull_request_snapshot` | the session | capture commit, coverage flags |
| Commits per capture | `repository_evidence_capture` base and head commits | PR commits and CI runs | lifecycle (`checkpoint`, `end`), capture time |
| CI checked after push | `ci_check` observations after the push in the same stream | the push | the check command, exit code, delay |
| Not covered | binding, readiness, retention boundary, last sync, observation receipt, new-branch push without SHA, a check without a target | the session | the reason (`github.status`, `ciRunCountUnknown`), never an empty result or a zero count |

Git extractor version 3 records the `To <remote>` of each push, new-branch pushes, forced updates and `ci_check` calls (`unconfirmed` when the command does not show they ran). `find source=git` reads each event's links from the edges (`edges.linkedBy=edges`) when they hold for the evidence it reads, and computes them at query time otherwise (`linkedBy=query`), pinned to the observation generation of each session's indexed transcript either way, with per-event GitHub coverage. While no session of a page has a scope row (the worker is off), the page is exactly the query-time one and events carry no `edges` field. Edges hold when the session's build (`l1_edge_scope`) read the same observation and transcript generations under the current resolver version without hitting its caps (`edges.status=current`) or was frozen after the transcript expired with the edges of a complete build (`frozen`), the event's evidence row has an active resolution of that generation that resolved to the repository the live bindings name, and every repository its links touch has a built repository scope with recorded coverage; otherwise the status says why (`stale`, `not_built`). Session rows are read as the completed build (`built_revision`) left them, without `FINAL`: the latest version of each key at or below that revision, then only active rows of the generation read (a retraction keeps the generation of the edge it retracts). A freeze writes nothing and keeps the retained build's revision, time, rules, input and coverage. A queued or running rebuild changes nothing that was read; rows of a newer revision (a build in flight or one that failed before completing) make the session `stale`, since merges may already have replaced the pinned rows. A CI run whose edge does not record its creation (builds before resolver version 2) is looked up by its id, never by the check's date. An event's PRs come from its `pr_named`, `pr_listed` and `pr_branch_head` edges and its commit's `commit_in_pr` memberships, its CI from `ci_named`, `ci_on_branch_window`, its commit's `ci_on_sha`, each PR's `ci_for_pr` and a merged PR's merge commit (read by target); a capture's base commit links nothing. With edges, counts also stop at the coverage the session and repository builds recorded (the latest start and earliest end of the live, session and repository coverage), and a SHA dates its history only by a `commit_created` edge to the commit it uniquely resolved to. Two differences from query time are deliberate: an open PR's test merge commit is never followed, and a SHA only an abbreviation-length match would date stays `target_history_unknown`. `L1_EDGES_FIND_READ=false` switches edge reads off (links at query time, `edges` null) and `L1_EDGES_FIND_SHADOW_RATE` samples pages whose edge links are also computed at query time and compared in the logs, by class. In reverse, `find source=git pullRequest=owner/name#number` (or the PR's URL) reads by target the session evidence that named, listed or pushed the head branch of the pull request, or created, pushed, captured as head or mentioned one of its commits (at most 5,000 edges, newest first; beyond that `truncated`), for the caller's own sessions (every member's for an admin), whatever their date unless `from` or `to` is given, reads each session's rows as its completed build published them (the latest version of each edge at or below its built revision, without `FINAL`), and returns those events with their links; sessions with rows only from builds that never completed, or with rows above their completed build (a rebuild in flight or failed), are reported as unknown or possibly incomplete. An observation is matched only in the generation its edge came from; a retained edge whose evidence row cannot be shown (the transcript is no longer indexed, or find reads a newer generation) is returned as a `witness` with its session, run, relation, matched value, evidence id, generation and time, only for the runs `refs` or `model` select (a witness whose model cannot be checked is counted as unknown), within the result's byte ceiling. Its notes count only sessions the caller sees, and say when the repository's GitHub-side edges are not built (its commits are then unknown) and how many of the visible sessions from two weeks before the PR was created (or `from`) to today (or `to`) have no edges that vouch for them (no scope, not built, older rules, truncated or being rebuilt) and may also touch it; when more than 10,000 sessions are in that window only the newest are checked, which the notes always say. Long session lists are read in statements of at most 256 KiB of URL parameters, measured as the client escapes and encodes them. A CI status read keeps the run id it names (`gh run view|watch <id>`, MCP `run_id`) in `run_id`. An event's CI count is the run attempts started before `ciRunCountThrough`, the earliest `coveredThrough` (end of the completed pulls, actions, attempts and external windows) of every repository its runs come from, a fork PR's base included. It is set only when every target the event names was looked up and each target's history starts inside that coverage: a PR's a day before its creation, a named run's at its creation, a branch check's at its window, and a SHA's at the commit observation of the session that created it. A SHA the session did not create has an unknown history, since a later PR or run on it does not date its earlier CI. Otherwise the count is null with the reason; runs found after the boundary are listed, not counted. Parser v6 stores Claude `pr-link` and `gitOperation` as record facts. Git extractor version 4 reads them too: a `pr-link` record is a `pr_url` observation labelled `pr_link`, and a pushed branch, commit SHA or pull request that `gitOperation` records but the call's output does not show is an observation labelled `git_operation`. Pushed SHA ranges still come from the push output, since `gitOperation` records only the branch.

### Capture for new sessions

The CLI records exact ownership as evidence: before and after each git command an agent runs (Claude Code tool hooks), the ref positions and full object IDs it changed, with clone, worktree and agent process identity; Codex gets the same per turn from its turn-complete checkpoint. Old sessions keep the transcript and capture evidence they have. A commit whose committer time falls inside a run is a **candidate** (`rudel.l1_edge_candidates`, with the competing runs), never an edge, and trends compare periods on the same `basis`.

## GitHub evidence in L1

Reviews, review comments, issue comments, PR files with patches, check runs and annotations, commit statuses, workflow jobs and job logs are collected per commit today but stored only as JSON and log objects in R2. They move into ClickHouse tables keyed by workspace, repository, PR number and SHA, keeping the provider's literal fields (author, path, line, body, state, conclusion) after the secret filter, so review comments and CI failures can be searched and joined to the sessions above. Job logs keep their redacted text with byte offsets, as `transcript_records` does for transcripts.

## Repository configuration

The CLI already captures CI workflows, `package.json` scripts, hooks, `AGENTS.md`, `CLAUDE.md` and skills as files. They get indexed per capture: workflow jobs, steps and the commands they run; script names and commands; hook events and commands; instruction and skill files with their content hash. A session then links to the configuration it ran under, and a check that exists but is never run is visible.

## Drift, retention and capture gaps

- **Drift.** Claude Code and Codex add transcript fields often. A recurring census lists, per agent and version, every raw field path the parsers do not map, so new facts become work items instead of silent losses. The smoke test at the parser fixture level fails when a fact in this spec stops landing in its column.
- **Retention.** Raw transcripts and `transcript_records` expire after 365 days. `run_index` keeps runs for 1,095 days from the session date (`RUN_INDEX_RETENTION_DAYS`); its free-text columns (prompt head, goal, turn and API errors, hook stop reasons, errors and runs, title) have a 365-day column TTL, so text never outlives the transcript and expired text reads NULL. The GitHub links and the weekly aggregates get their own, longer retention so findings stay comparable over time.
- **Capture gaps.** Approved permission prompts are not in transcripts and need a capture hook. Sessions that were never uploaded can only be counted through coverage. Cost per tool call has no defensible allocation and stays per request and per run.
- **Scope.** Claude Code and Codex only.

## Joins

- **Instruction size.** Injected instruction characters per run, per instruction file hash. Transcripts record cache tokens per request, not per file, so a cost per instruction file is an estimate built on top of L1, not an L1 fact.

## Scale

Run facts and session links are recomputed on every `find` today (`FINAL` over `transcript_records`, no text skip index), which is why `find` caps scope at 10,000 sessions and its text scans at 100,000 records or 64 MiB, on top of per-statement ClickHouse limits. `rudel.run_index` materializes `runs` per committed generation: one row per run, keyed by the generation (`revision`, `parser_version`, `index_version`), the build (`build_revision`) and the run's stream and start record, so its `run_id` is the edges' run id, and one `receipt` per build, written after its runs, holding session facts (run count, call and error totals, merged skills, slash commands, subagent types and models, usage no run claims, the last cost-state, the title, the repository key and session model). Every build is an immutable snapshot: the receipt with the newest (generation, build) commits the session's runs, readers read only that build (the API's run index reader), and a build that dies before its receipt changes nothing they see. The same reconciliation worker builds it (scope kind `run_index`, same scope id as the session's edges, never deferred for observations or re-queued by repository changes). Its request rides on the edges' request after git observations are written (ingest, backfill and repair), in the same statement; nothing else in an upload waits on the queue for it, and a daily census queues recently ingested sessions whose committed snapshot is missing or stale (transcript generation, index or pricing version, or usage extraction). A build reads the generation with the statements `find` uses for its runs, so their numbers cannot drift, copies each run's facts from its own records (the first or last recorded value, sorted sets, counts of records that carry one) and attributes Codex lifecycle rows to runs by `turn_id` (an opening row without a completion joins the next prompt with nothing between; a completion stays in the run it ended). A fact the generation's parser version or agent cannot record is NULL, and arrays name it in `unrecorded_facts`. Costs are frozen at build time with `pricing_version` from one usage extraction: its receipt must be complete with exactly the events it counts (otherwise usage is stored as unknown), every usage read is bound to it, it must be the same after the build's reads, and the runs' usage plus the usage no run claims (unverified, or on lines no run covers) must add up to it. A new usage receipt or pricing rebuilds the generation, a current receipt is skipped, a session over 200,000 records is frozen with its reason, and an expired transcript keeps its runs. Text past its 365 days is nulled before it is written and when it is read, since the column TTL applies only at merges. Builds are fenced by the purge tombstones (a fenced session loses its run index rows and scope), covered by the account and workspace purges, and snapshots are retired like `transcript_records` by the daily sweep, found from all rows: crashed builds once older than the committed one or past the grace, superseded ones after the grace, never the committed one. Weekly per-workspace aggregates sit on top for team-wide counts.

## Retiring interpretations

Order per item: stop reading, stop writing (materialized views and recovery SQL), drop storage.

1. **No first-party consumer, delete now.** `analytics.roi.*`, `learnings.*`, `errors.*`, `projects.*`, `developers.*` except `list` and `teamCards`, `overview.insights`, `successRate`, `teamSummaryComparison`, `usageTrend`, `modelTokensTrend`, `usersTokenUsage`, `repositoriesDailyTrend`, `sessions.summary`, their services, the unused dashboard page chain in the web app, and the generated `content.schema.ts`.
2. **Fetched but never shown.** `success_score` (and the plugin code that strips it), `has_commit`, `used_plan_mode`, `avg_period_sec` and `median_period_sec`, the Wrapped archetype on team cards and its rebuild pipeline.
3. **Derived columns with no reader.** `session_archetype`, `error_pattern`, the response-gap buckets, `inference_duration_sec` and `human_duration_sec`; then the `skill_assessments` column of the evidence index.
4. **Live, replace first.** `error_count` with counted `is_error` records; the regex `skills`, `slash_commands` and `subagent_types` with `skill_uses` and records; `resolveRepoIdentity` with the repository identity join; wrapper-regex prompt origin with the native origin fields; `model_used` with per-request models.
5. **Analysis-agent classifiers** (failure classifier, `toolGroup`, reactions): removed from the tool interface once literal `find` ships; `command_class` stays stored beside `command_prefix`.

The language-signal lexicon stays: it stores literal phrase matches.

Status: steps 1 and 2 stopped reading (#218, #219). The views and the recovery SQL stop writing the step 2 and 3 columns (`success_score`, `has_commit`, `used_plan_mode`, `avg_period_sec`, `median_period_sec`, `quick_responses`, `normal_responses`, `long_pauses`, `error_pattern`, `session_archetype`, `inference_duration_sec`, `human_duration_sec`) with `20261008120000_session_analytics_retired_writes.sql`, and the evidence index stops writing `skill_assessments`; their columns keep defaults until a later migration drops them, once every writer runs that code.

## Order of work

1. This spec and step 1 of the retirement. Done.
2. Retirement step 2. Done.
3. Git extractor version 3 and the session, pull request and CI links, exposed to `find` (computed at query time).
4. Retirement step 3: stop writing, then drop storage, with the `session_analytics` migration.
5. The edge table and reconciliation worker (ADR 0003), fed by the existing evidence; captures and snapshots published to ClickHouse; `find source=git` reads edges, and pull request → runs works in reverse. Built: the worker (its cron off until `L1_EDGES_WORKER_ENABLED`), `find`'s edge reads with the query-time fallback, and `pullRequest`; captures and snapshots are still read from Postgres.
6. `run_index` on the same worker, coverage and retention; then retirement step 4 (`error_count`, regex skills). Built: the table, its builds on the worker and its retirement; the backfill and census, and `find` reading it, are next.
7. Transcript-records parser v6 with the raw facts above, its fixture test, and backfill. Shipped as parser versions 6 (`calls` facts and `agent_version`/`entrypoint` on every record), 7 (`runs` facts and Codex spawned thread ids) and 8 (`prompts` and session facts), with one backfill after 8. `l1-facts.test.ts` fails when a raw or text fact here is neither stored nor listed as pending.
8. CLI capture of git ownership (tool hooks, worktree and process identity) and commit facts from GitHub (committer time, parents).
9. GitHub evidence and repository configuration in ClickHouse.
10. `find` over `calls`, `runs`, `prompts` and edges, the schema reference and premade queries in the plugin skill.
11. The drift census and retirement step 5.
