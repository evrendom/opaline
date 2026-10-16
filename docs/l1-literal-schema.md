# L1: the literal session schema

L1 is the deterministic layer every analysis reads: what the transcripts, usage and GitHub recorded, normalized across Claude Code and Codex, with nothing inferred. The decisions and their reasons are in [ADR 0002](adr/0002-literal-l1-for-analysis.md) (literal facts) and [ADR 0003](adr/0003-l1-evidence-entities-edges.md) (evidence, entities and edges). This document is the target schema, where each fact comes from, what is missing today, and the order of work.

## Rules

1. **Literal values.** A column holds what the source recorded (`permission-rule`, `workspace-write`, `interrupted`), under one name for both agents. No labels, scores, buckets or archetypes.
2. **Unknown is not false.** Every fact is nullable or has an explicit empty value meaning "not recorded". Each row carries `source` (agent) and `agent_version`, so a missing value can be told apart from a version that never emits it.
3. **Replayable.** Facts come from the parser (`TRANSCRIPT_RECORDS_PARSER_VERSION`) over the stored raw transcript, kept until a deletion request. Slimming keeps every record but replaces inline images with markers, and the secret filter redacts matched credentials, so only what survives both can be replayed. Adding a fact the stored transcript carries means a parser bump and `backfill:transcript-records`; facts the transcript never records (the upload mode) need capture.
4. **Coverage is a fact.** What was not captured (a member who does not upload, a repository without the GitHub App, an extraction that hit its bounds) is stored and reported, not silently missing.
5. **Narrow interface.** The analysis agent sees three views (`calls`, `runs`, `prompts`) behind `find`, plus their weekly totals, a schema reference and premade queries. New facts add columns and enum values, not tools or parameters.
6. **Evidence, entities, edges.** Evidence is immutable and replaced only by a new generation; entities (pull requests, commits, CI run attempts) are one full row per version; relationships are edge rows written by one reconciliation worker, each naming its `relation`, `basis` and witness `evidence_id`. Inferences are candidates, kept out of L1. `find` reads; it does not resolve.
7. **ClickHouse for data, Postgres for control.** Everything analysis reads is in ClickHouse, including evidence captured through Postgres protocols (published as immutable copies). Postgres keeps auth, bindings, upload and sweep state, and the worker's queue, claims and watermarks.

## Views

Each view is one row per thing, keyed by `(organization_id, user_id, session_id, agent_id, …)` and pinned to the committed transcript-records generation. What each agent records for every fact, and what Opaline stores today (with the parser version, the plan for what is missing, and how an absence was checked), is the generated [fact matrix](l1-fact-matrix.md). It is built from the fact catalog (`packages/api-routes/src/session-transcript/transcript-records/fact-catalog.ts`), which the parser tests check against this spec, the fact registry and the fixtures, and which also lists facts the agents record that the tables below do not name yet.

Agents also read the views with read-only SQL (the `schema` and `sql` tools, ADR 0005, agents query L1 with SQL). The first is `runs`: the run index's run rows of each session's committed build (`committedBuildSql` in `run-index-reader.ts`, as every run index reader reads them), without the storage columns (`organization_id`, generation, build, `row_kind`, record positions) or the receipt's session facts. The gateway (`sql-gateway.ts`) refuses any table but the views and any function not on its list (`sql-functions.ts`, fail closed), puts the view's statement in place of each reference with the workspace (and the member, only where the session visibility rule keeps them to their own sessions) as bound query parameters, runs it with `readonly = 1` within time, memory, read and row limits and a per-workspace quota, and stores each result (`analysis_sql_result`). The second is `finding_runs`: when an analysis is saved, each finding's cited runs (the runs its step's call names) with the cost, tokens and active time of the run's committed build (`analysis_finding_runs`, written by `finding-impact-clickhouse.ts`, read with FINAL), visible to the analysis's author and, once it is shared, to the workspace; the reader is always bound as a parameter for it. Next to it (`sql-l1-views.ts`), each joinable to `runs` by `run_id`: `calls` (one row per tool call with its command identity from `command-identity.ts` and its results reduced to one), `prompts` (one row per prompt or injected context) and `git_events` (one row per git observation, with `evidence_id` as in the edges and, for a push, the CI checks after it in its stream, as `find source=git` counts them), all read from the transcript generation each session's committed run index build was built from, so their rows add up to the runs they join and only that generation's parts of `transcript_records` are read; `edges` (the latest revision of each edge while it is active) and `ci_jobs` (the latest report of each GitHub Actions job, with its run), both only for the repositories the workspace has bound while its GitHub outcomes are visible (bound as a parameter like the workspace). The gateway (`sql-gateway.ts`) refuses any table but the views and any function not on its list (`sql-functions.ts`, fail closed), puts the view's statement in place of each reference with the workspace (and the member, only where the session visibility rule keeps them to their own sessions, and the visible GitHub repositories) as bound query parameters, runs it with `readonly = 1` within time, memory, read and row limits and a per-workspace quota, and stores each result (`analysis_sql_result`).

### `calls`: one row per tool call, its result joined

| Column | Claude source | Codex source |
|---|---|---|
| `tool_name`, `call_id` | `tool_use.name`, `.id` | `function_call` / `custom_tool_call` / `item_completed.item` |
| `input_text` | `tool_use.input` (Bash `command`) | `arguments`, `command` |
| `command_argv0`, `command_prefix` | the program of the shell command and its subcommand, derived from the stored command text (see command identity) | same, from `exec_command` `cmd` and the commands a code-mode script ran; never `CommandExecution.command[0]`, the shell wrapper |
| `command_fingerprint`, `command_simhash` | normalized command / written script, derived (see command identity) | same, code-mode scripts included |
| `is_error`, `exit_code` | `tool_result.is_error`, transport framing | `exit_code`, `status = failed` |
| `denial_kind` | `toolDenialKind` (`permission-rule`, `user-rejected`, `cancelled`) | sandbox and approval outcome when recorded: the variant at the start of a refused call's output (`Codex(Sandbox(Denied …`, `Rejected(…`) |
| `denial_reason` | the string `toolUseResult` of a refused or blocked result; a `PreToolUse:<tool> hook error` result | the message of a `Rejected("…")` refusal (`rejected by user`, `` `<command>` rejected: blocked by policy ``) |
| `return_code_interpretation` | `toolUseResult.returnCodeInterpretation` | none |
| `duration_ms` | `toolUseResult.durationMs` / `durationSeconds` | `item.duration`, `completed_at_ms - started_at_ms` |
| `timed_out_after_ms`, `timeout_ms` | `toolUseResult.timedOutAfterMs`, `timeoutMs` | `exec_command` argument `timeout_ms` (the limit; Codex records no timed-out call) |
| `is_async`, `background_task_id` | `toolUseResult.isAsync`, `backgroundTaskId`, input `run_in_background` | running preamble |
| `interrupted`, `no_output_expected` | `toolUseResult.interrupted`, `noOutputExpected` | a stopped call's output `aborted by user after <s>s` (with its duration); `turn_aborted` for the run |
| `stdout_chars`, `stderr_chars`, `persisted_output_bytes` | `toolUseResult.stdout`, `stderr`, `persistedOutputSize` | `stdout`, `stderr`, `aggregated_output` |
| `result_chars` | result text | output text |
| `shell_edit_files` | `toolUseResult.bashEditDiff.files` / `changedFiles` | shell-inferred `file_change` |
| `git_operation` | `toolUseResult.gitOperation` (`push`, `pr`, `branch`, `commit`) | none (observations parser) |
| `mcp_server`, `mcp_tool`, `mcp_read_only` | own `mcp__<server>__<tool>` call name; line attribution retained separately; `mcpMeta` for read-only | `McpToolCall.server`, `.tool`, `.readOnlyHint`, `pluginId` |
| `file_path`, `file_op` | Read/Write/Edit input | patch paths |
| `patch_lines_added`, `patch_lines_removed`, `user_modified` | `toolUseResult.structuredPatch`, `userModified` | `FileChange.changes` |
| `stale_read` | `toolUseResult.staleReadFileStateHint` | none |
| `search_matches` | `numFiles` only for `files_with_matches`; `numMatches` for `count`; otherwise `numMatches`, then `numLines` | none |
| `spawned_agent_id` | Task/Agent result `agentId` | `SubAgentActivity.agent_thread_id` only for `kind=started`; `CollabAgentToolCall.receiver_thread_ids` only for `tool=spawn_agent` |
| `attribution_skill`, `attribution_plugin`, `attribution_agent` | assistant `attributionSkill`, `attributionPlugin`, `attributionAgent` | `pluginId` |
| `skill`, `parsed_cmd_types`, `parsed_cmd_read_paths` | `Skill` tool call `input.skill` (the invocation; `attributionSkill` marks the lines after it); a `Read` of a `SKILL.md` keeps its path | `CommandExecution.parsed_cmd`: Codex's own part types and the paths of its `read` parts (a skill is used by reading its `SKILL.md`) |
| `cwd`, `git_branch` | per-record `cwd`, `gitBranch` | `exec_command` argument `workdir`, `CommandExecution.cwd`, `turn_context.cwd`; the branch only in `session_meta.git` |

Parser v6 writes call facts on the row of the line that carries them. Claude facts sit on the `tool_result` (MCP identity also on the `tool_call`). Codex facts sit on the completion row with the same `call_id` (`item_completed:*_mirror`, `exec_command_end`), because the completion can arrive before or after the output, or with no output after it; nested items carry them on their own `tool_result`. A Claude line holding several results keeps its line-level `toolUseResult`/`toolDenialKind` off every result, since the line does not say which call they belong to; current Claude Code writes one result per line. Long fact values (over 32 characters) share a session budget (256 Mi characters in parser 9): past it a record drops them and says `facts_truncated`; short values are always kept. Prompt and session facts (parser v8) sit on the prompt's records (Claude `turnOrigin`, `promptSource`, `origin.kind`, not on tool results of the same line), the Codex `session_meta` and `inter_agent_communication_metadata` rows, the Claude `instructions` attachment (`instruction_paths`), `cost-state` rows (cumulative; the session's last one holds the totals) and `ai-title` rows (the title is also the row's text). Run facts (parser v7) sit on the record that carries them: a Codex `turn_context`, `task_started`, `task_complete`, `turn_aborted` or `thread_goal_updated` row, a Claude prompt or assistant line (permission mode, model, effort, stop reason on each of its records), or a Claude system or attachment row; a run reads them from its records. Codex writes `task_started` and `turn_context` before the turn's prompt, so those rows carry the previous run's `turn_idx`; each lifecycle row keeps the Codex `turn_id`, which the turn's `task_complete` or `turn_aborted` also carries, and a run joins its rows by it. A failed Codex task is an error row whose text is the error; a goal row's text is the full objective. Values cut at their cap are listed in `facts_clipped`, and entries cut from a list are counted under its `_more` key.

### Command identity

`command_argv0`, `command_prefix`, `command_fingerprint` and `command_simhash` are Opaline-derived, not recorded by the agents: `find source=calls` computes them in ClickHouse at query time from the text `calls` already stores (`apps/api/src/services/analysis/command-identity.ts` is the only definition), so nothing is stored or backfilled, every call changes at once when the rules change, and each value is returned next to the raw text it came from. A call carries a command when it is a shell call (Claude Bash and PowerShell, Codex `exec_command`, `shell`, `local_shell`), a command Codex ran inside a code-mode script (its own nested call from parser 5; before that, a script that runs exactly one `exec_command` stands for that command), a whole code-mode script (`script`), or a written script file (`written`: a Claude Write, or a Codex patch that adds the file, of a `.sh`, `.py`, `.js`, `.ts` or similar file). `command_argv0` is the first word after setup statements (`cd`, `export`, assignments, `echo` labels), environment assignments, wrappers (`sudo`, `env`, `timeout N`, `nohup`, `rtk proxy`, package runners such as `npx`, `pnpm exec`, `uv run`, `conda run`, `mise exec --`) and a `bash -lc` wrapper, without quotes or directory; `command_prefix` adds the next word when it is a subcommand (`git push`, `gh pr`, `python3 -m pytest`). Both are null for scripts. The fingerprint is `cityHash64` of the normalized text: absolute paths keep their last two components (file and folder) once home directories, temp directories (random per-run names included) and agent worktrees are `<home>`, `<tmp>` and `<worktree>`, numbers, SHAs, UUIDs, timestamps and URLs become placeholders, single-line quoted strings become `<str>` except an interpreter's inline program and an ssh remote command, output trims (`2>&1`, `| head`, `| tail`), status `echo` lines and a leading `cd` are dropped; relative paths, flags and subcommands stay. Code-mode and written scripts keep their string literals. The simhash is `wordShingleSimHashUTF8` of the same text, 32 bits, null under 20 words (equal simhashes of shorter texts are mostly unrelated); two calls are near-duplicates when their simhashes differ in at most 3 bits, which finds copies with small edits, not rewrites. All four are null when only part of the text is stored.

### Parser 9 representation and disclosure

New literal families live in the registered `facts` Map, not new transcript-records columns. Each `<family>_components` value is a JSON array of `{path, ordinal, value}`. `path` is the census source path; `ordinal` orders repeated occurrences of that path on the same row. Components retain their distinct names and units: a root/parent turn ID is not a turn duration, and a configured tier is not an observed response tier. Root metadata attached to the first row remains record-scoped by its source path, not proof of ownership by that row's tool call. Call inputs are attached to their own call ID. Empty messages with recorded metadata get a metadata row rather than losing their fields.

Absent keys, JSON `null`, empty strings/lists/objects, zero and `false` are distinct. Readers must gate these keys and corrected typed meanings on `parser_version >= 9`. Reasons, errors and descriptions have a 4,096-code-point cap; lists have a 65,536-character cap and at most 1,024 entries. Omitted outer or nested entries are counted in the family's `_more`; `facts_clipped` identifies capped families. Long values share a 16 Mi UTF-16-unit session fact budget; exhaustion sets `facts_truncated`. Text caps and `text_truncated` remain separate. Secret filtering is preserved; execution `env` maps are never retained. Offered tools contain names/server only, and media components retain presence, not inline bytes. By owner decision, Claude account `userEmail` is retained in `account_context`; it may differ from the Opaline account email, and account/workspace deletion purges it with `transcript_records`. Credential-container redaction remains unchanged.

Requests and outcomes stay separate. `file_op` describes the requested mutation; `file_change_basis` distinguishes requested from recorded applied rows. Confirmed `FileChange.status=completed`, `patch_apply_end.success=true` and successful structured Claude edit/create results contribute `applied_changes`. Refused/failed requests do not. Unified hunk ranges keep the written decimal tokens; omitted range counts remain null. Claude Write creation line counts come from the recorded result content. Codex results retain late explicit exit codes without changing running-result identities. Refused, transport-failed, aborted and unparsable call envelopes are failures, not successful tool results.

Claude MCP target identity comes only from the call's `mcp__<server>__<tool>` name; line attribution is retained separately. Codex named permission profiles use `active_permission_profile.id`; profile kind is separate. Spawn lists exclude wait/send activity. All existing non-replayed record identities retain the v5 identity contract.

Fork replay requires an explicit `forked_from_id` plus identical literal parent `call_id`, or an explicitly written exclusive parent ordinal. The parser marks proven replay rows with `fork_replayed=true`, retaining identities and raw evidence. Live extraction/backfill resolve bounded, organization/user-scoped committed parent calls. Run-index version 2 also anti-matches against committed parent generations, so a child parsed before its parent is available is not counted twice when the index is built after the parent. Timestamps or a generic subagent parent are never tool-replay proof. A missing parent cannot be replaced with an inferred match.

Run-index version 2 counts as `edits` the distinct paths of the `applied_changes` fact united with the `file_path` of `file_change` rows (`file_op` write, edit or delete; subtype `native`, `patch` or `nested`) of native edit tools (Claude Edit, Write, MultiEdit, NotebookEdit; Codex apply_patch) whose call has a result that is neither failed nor refused: the request plus a literal successful outcome is evidence, which matters because Claude sub-agent transcripts never carry `toolUseResult` and so never produce `applied_changes`. Paths inferred from shell command text (subtype `shell*`) never count, with distinct failed and refused edit-call counts (`failed_edits`, `refused_edits`, available from parser 9). From parser 12 a file an inline Python script names as the one it writes (subtype `shell_script`, a `python3 - <<'EOF'` here-document or `python3 -c`) is an edit request as well: its call failing or being refused counts in `failed_edits` or `refused_edits`, while its success, which proves no change, adds nothing to `edits`. Codex parsed-command read/search types override heuristics when present, including an empty/unknown list. Cancellations and interruptions are excluded from `denied_calls`. Pricing and interpretation stay outside literal L1.

Run-index version 3 counts as `not_found` each read or search call (once, however many result rows it has) whose result records that it found nothing: Claude Code's own zero-result text (`No files found`, `No matches found`) or zero counter of the search's mode (numFiles, numMatches, numLines), its `returnCodeInterpretation` `No matches found`, output that starts with the shell's `no matches found:` for a file pattern, or a failure whose text says not found, no such file, ENOENT or does not exist (Read's `File does not exist.`); for searches also a finished command that printed nothing, unless the command silences or redirects its output (`grep -q`, `> file`, `-delete`). An exit code alone is not used: find and ls exit 1 for errors, and a compound command exits with its last part's status. Claude Code's reading of an exit code is the only record of a search that matched nothing after printing something, and it lives in `toolUseResult`, which parsers before 6 did not keep and Claude Code subagent transcripts never carry, so `not_found` is NULL there and named in `unrecorded_facts`; Codex keeps exit codes and output in every version. Index 2 and older counted only failures with not-found text, so Grep, Glob and shell searches that found nothing and Read's `File does not exist.` were 0 (OPL-384). Every run row also carries the session's repository key, which index 2 wrote on the receipt only.

Claude Code subagent streams (parser 12 builds): the other run facts only `toolUseResult` records, `git_operations`, `pushed_branches`, `commit_shas` and `pr_urls` (pr-link records are written to the main stream only), are unknown there too, never empty (production, 30 days to 2026-10-16: no subagent Bash result from the desktop app, VS Code or the SDK carried a `toolUseResult`, 50,867 of them; the CLI's subagent transcripts keep it, 608 of 622, and are gated the same). Three facts have a form subagent transcripts do write, and count it: `timed_out_calls` also counts a result whose text says the timeout moved the call to the background (`background_launch` timeout, parser 11; every main-stream `timedOutAfterMs` carries that text, 536 of 536), `refusals` counts a subagent stream's safety-classifier notice (`safety_recovery`, parser 11; the main stream writes it before its `model_refusal` record, so it counts the records only), and `interrupted_calls` reads the interrupt's denial kind and result text (parser 12). Older subagent generations name them in `unrecorded_facts`.

Usage extraction version 5 keys Codex request usage by `response_id`; turn/thread cumulative vectors are separately preserved evidence, never added to response tokens. Claude keeps the final main-chain snapshot for each request, not fieldwise maxima, including recorded thinking tokens. Unknown Codex cache writes remain null. Additive nullable `recorded_cache_write_5m_input_tokens`, `recorded_cache_write_1h_input_tokens` and `cache_write_input_tokens` retain the literal cache values; legacy numeric TTL columns remain pricing-compatibility projections. Receipt attestation v3 covers these distinctions without changing identity version 1. Configured Codex service tier is explicitly flagged as configured.

Codex usage whose response records no service tier is priced at the thread's configured tier (the only tier Codex logs); a response's own recorded tier, including `default`, always wins. The stored event keeps the literal configured tier (an explicit null/empty clear stays empty, hence standard) and the `service_tier_configured` quality flag, which labels the price basis as configured, so the cost is recomputable from the stored row. Pricing stays outside literal L1; the parser records the facts.

Counterpart proposals with no source path remain unresolved, not `not_recorded`: absence of a local witness is not writer-absence proof. Per-file instruction hashes also remain a separate configuration-index decision until literal file boundaries and framing policy are specified. See the verification report for the exact residual list.

### `runs`: one row per run (one human prompt and everything until the next)

| Column | Claude source | Codex source |
|---|---|---|
| `started_at`, `ended_at`, `minutes`, `active_minutes` | record timestamps | `task_started`, `task_complete` |
| `duration_ms`, `time_to_first_token_ms` | none | `task_complete.duration_ms`, `time_to_first_token_ms` |
| `prompt_origin` | `turnOrigin`, `promptSource`, `origin.kind` | `inter_agent_communication_metadata`, `thread_source` |
| `permission_mode` | `permissionMode` | none |
| `auto_mode_*` | `attachment.auto_mode` (`bashFirst`, `bashFirstSteer`, `bypass`) | none |
| `approval_policy`, `approvals_reviewer`, `sandbox_policy`, `permission_profile` | none | `turn_context.*` |
| `model`, `effort` | `message.model`, `effort`, `perTurnEffort` | `turn_context.model`, `.effort` |
| `entrypoint`, `agent_version` | `entrypoint`, `version` | `originator`, `cli_version` |
| `cost_usd`, tokens by kind | `usage_events` (final request snapshot) | `usage_events` (`token_usage_record` keyed by `response_id`, otherwise deduplicated `token_count` transitions) |
| `context_window`, `context_input_tokens_at_start` | usage | `task_started.model_context_window`, usage |
| `compacted`, `compact_trigger`, `compact_pre_tokens` | `compact_boundary`, `compactMetadata` | `compacted`, `compaction` |
| `tool_calls`, `failed_calls`, `denied_calls`, `edits`, `reads`, `searches`, `not_found` | from `calls` | from `calls` |
| `aborted`, `abort_reason`, `turn_error` | interrupt markers, `interruptedByShutdown` | `turn_aborted.reason`, `task_complete.error` |
| `stop_reason` | assistant `message.stop_reason` | none |
| `hook_stop_reason`, `hook_errors`, `prevented_continuation` | system `stopReason`, `hookErrors`, `preventedContinuation` | none |
| `hook_runs` (command, duration) | system `hookInfos` | none |
| `api_errors`, `retry_attempts`, `refusals`, `fallback_model` | `apiErrorStatus`, `retryAttempt`, `model_refusal*`, `fallbackModel` | terminal `task_complete.error` provider/transport kinds feed API errors; no retry/fallback record; policy stops remain distinct from model refusals |
| `goal` | none | `thread_goal_updated.goal` |
| `pushed_shas`, `pr_repository`, `pr_number` | `pr-link` records, `gitOperation`, git output | git output |
| `ci_runs_after_push`, `ci_checked_after_push` | `github_ci_runs` by pushed SHA; later `gh run`/`gh pr checks` calls | same |
| `repository_id` | repository evidence index, GitHub binding | same |

### `prompts`: one row per prompt or injected context

| Column | Source |
|---|---|
| `kind`, `subtype` | records (`user_prompt`, `injected_context`, `queued`, `delegation`) |
| `prompt_origin` | Claude `turnOrigin`, `promptSource`, `origin.kind`; Codex inter-agent metadata |
| `text`, `text_chars` | prompt text |
| `instruction_path`, `instruction_sha256` | `nested_memory` path, `instructions`, AGENTS.md injection |
| `edited_by_user_path` | `attachment.edited_text_file` |

## Session and workspace facts

| Fact | Source |
|---|---|
| `cost_state` (`totalCostUSD`, `totalLinesAdded`, `totalLinesRemoved`, `totalToolDuration`, `totalAPIDuration`) | Claude `cost-state` record |
| `title` | Claude `ai-title` |
| `upload_mode` (`hook`, `manual`, `retry`) | CLI request |
| `member_coverage` (members uploading / members in workspace, per day) | `session_ownership` × membership |
| `instruction_file_versions` (per session) | injected context, repository evidence |
| `approved_permission_prompts` | Claude `permissionDecision` on the result's line; Codex `sandbox_permissions` and `prefix_rule` arguments, approved command prefixes |

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

The reconciliation worker rebuilds a scope when an input changes: a session generation (git observations published, transcript reparsed, capture or snapshot published), a repository's pull requests or commits (sweep or webhook), or its CI runs. Its queue, claims, revisions and watermarks are Postgres rows; its output is ClickHouse rows. A rebuild is deterministic for its scope and the GitHub state it read, writes new revisions and retracts edges that no longer hold, and is fenced by purge tombstones. Run-side edges depend on GitHub data (a unique SHA prefix, a branch's PRs, a run's attempts), so a repository change re-queues the sessions that depend on it while they are open (14 days after their last evidence); older edges are frozen against the coverage recorded on their scope. An expired transcript never retracts edges. A daily census (`l1-edge-census`) re-queues the sessions with recent observations or captures whose scope is missing, unbuilt or built from another observation generation or resolver version, and active bindings without a repository scope, so a lost request is not lost for good.

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

Git extractor version 3 records the `To <remote>` of each push, new-branch pushes, forced updates and `ci_check` calls (`unconfirmed` when the command does not show they ran). `find source=git` reads each event's links from the edges (`edges.linkedBy=edges`) when they hold for the evidence it reads, and computes them at query time otherwise (`linkedBy=query`), pinned to the observation generation of each session's indexed transcript either way, with per-event GitHub coverage. While no session of a page has a scope row (the worker is off), the page is exactly the query-time one and events carry no `edges` field. Edges hold when the session's build (`l1_edge_scope`) read the same observation and transcript generations under the current resolver version without hitting its caps (`edges.status=current`) or was frozen after the transcript expired with the edges of a complete build (`frozen`), the event's evidence row has an active resolution of that generation that resolved to the repository the live bindings name, and every repository its links touch has a built repository scope with recorded coverage; otherwise the status says why (`stale`, `not_built`). Session rows are read as the completed build (`built_revision`) left them, without `FINAL`: the latest version of each key at or below that revision, then only active rows of the generation read (a retraction keeps the generation of the edge it retracts). A freeze writes nothing and keeps the retained build's revision, time, rules, input and coverage. A queued or running rebuild changes nothing that was read; rows of a newer revision (a build in flight or one that failed before completing) make the session `stale`, since merges may already have replaced the pinned rows. A CI run whose edge does not record its creation (builds before resolver version 2) is looked up by its id, never by the check's date. An event's PRs come from its `pr_named`, `pr_listed` and `pr_branch_head` edges and its commit's `commit_in_pr` memberships, its CI from `ci_named`, `ci_on_branch_window`, its commit's `ci_on_sha`, each PR's `ci_for_pr` and a merged PR's merge commit (read by target); a capture's base commit links nothing. With edges, counts also stop at the coverage the session and repository builds recorded (the latest start and earliest end of the live, session and repository coverage), and a SHA dates its history only by a `commit_created` edge to the commit it uniquely resolved to. Two differences from query time are deliberate: an open PR's test merge commit is never followed, and a SHA only an abbreviation-length match would date stays `target_history_unknown`. `L1_EDGES_FIND_READ=false` switches edge reads off (links at query time, `edges` null) and `L1_EDGES_FIND_SHADOW_RATE` samples pages whose edge links are also computed at query time and compared in the logs, by class. In reverse, `find source=git pullRequest=owner/name#number` (or the PR's URL) reads by target the session evidence that named, listed or pushed the head branch of the pull request, or created, pushed, captured as head or mentioned one of its commits (at most 5,000 edges, newest first; beyond that `truncated`), for the sessions the caller can read (every member's), whatever their date unless `from` or `to` is given, reads each session's rows as its completed build published them (the latest version of each edge at or below its built revision, without `FINAL`), and returns those events with their links; sessions with rows only from builds that never completed, or with rows above their completed build (a rebuild in flight or failed), are reported as unknown or possibly incomplete. An observation is matched only in the generation its edge came from; a retained edge whose evidence row cannot be shown (the transcript is no longer indexed, or find reads a newer generation) is returned as a `witness` with its session, run, relation, matched value, evidence id, generation and time, only for the runs `refs` or `model` select (a witness whose model cannot be checked is counted as unknown), within the result's byte ceiling. Its notes count only sessions the caller sees, and say when the repository's GitHub-side edges are not built (its commits are then unknown) and how many of the visible sessions from two weeks before the PR was created (or `from`) to today (or `to`) have no edges that vouch for them (no scope, not built, older rules, truncated or being rebuilt) and may also touch it; when more than 10,000 sessions are in that window only the newest are checked, which the notes always say. Long session lists are read in statements of at most 256 KiB of URL parameters, measured as the client escapes and encodes them. A CI status read keeps the run id it names (`gh run view|watch <id>`, MCP `run_id`) in `run_id`. An event's CI count is the run attempts started before `ciRunCountThrough`, the earliest `coveredThrough` (end of the completed pulls, actions, attempts and external windows) of every repository its runs come from, a fork PR's base included. It is set only when every target the event names was looked up and each target's history starts inside that coverage: a PR's a day before its creation, a named run's at its creation, a branch check's at its window, and a SHA's at the commit observation of the session that created it. A SHA the session did not create has an unknown history, since a later PR or run on it does not date its earlier CI. Otherwise the count is null with the reason; runs found after the boundary are listed, not counted. Parser v6 stores Claude `pr-link` and `gitOperation` as record facts. Git extractor version 4 reads them too: a `pr-link` record is a `pr_url` observation labelled `pr_link`, and a pushed branch, commit SHA or pull request that `gitOperation` records but the call's output does not show is an observation labelled `git_operation`. Pushed SHA ranges still come from the push output, since `gitOperation` records only the branch.

### Capture for new sessions

The CLI records exact ownership as evidence: before and after each git command an agent runs (Claude Code tool hooks), the ref positions and full object IDs it changed, with clone, worktree and agent process identity; Codex gets the same per turn from its turn-complete checkpoint. Old sessions keep the transcript and capture evidence they have. A commit whose committer time falls inside a run is a **candidate** (`rudel.l1_edge_candidates`, with the competing runs), never an edge, and trends compare periods on the same `basis`.

## GitHub evidence in L1

Reviews, review comments, issue comments, PR files with patches, check runs and annotations, commit statuses, workflow jobs and job logs are collected per commit today but stored only as JSON and log objects in R2. They move into ClickHouse tables keyed by workspace, repository, PR number and SHA, keeping the provider's literal fields (author, path, line, body, state, conclusion) after the secret filter, so review comments and CI failures can be searched and joined to the sessions above. Job logs keep their redacted text with byte offsets, as `transcript_records` does for transcripts.

## Repository configuration

The CLI already captures CI workflows, `package.json` scripts, hooks, `AGENTS.md`, `CLAUDE.md` and skills as files. They get indexed per capture: workflow jobs, steps and the commands they run; script names and commands; hook events and commands; instruction and skill files with their content hash. A session then links to the configuration it ran under, and a check that exists but is never run is visible.

## Drift, retention and capture gaps

- **Drift.** Claude Code and Codex add transcript fields often. The census (`bun run --cwd packages/api-routes facts:census -- <dir-or-file>...`, read-only) lists, per agent and version, every raw field path the fact catalog neither maps nor deliberately ignores, and the catalog sources the corpus never showed, so new facts become work items instead of silent losses. A test runs it over the parser fixtures, so every fixture field is catalogued or ignored; run it on local transcripts (`~/.claude/projects`, `~/.codex/sessions`) and, later, on a sample of production raw uploads. The parser fixture tests fail when a stored fact stops landing in its column.
- **Retention.** Raw transcripts, `transcript_records` (every column, text included), `run_index` (every column, free text included) and `session_lineage` are kept until a deletion request: no TTL, no age-based job. `session_language_signals` (derived phrase matches, not L1) keeps its 365-day TTL. Account, workspace and admin user deletion are the only cleanup, and the purge covers every table that holds an owner ([retention and deletion coverage](l1-retention.md)). The GitHub links keep their own, longer retention so findings stay comparable over time; each weekly totals snapshot covers the run index's whole history, so older snapshots expire after 14 days.
- **Capture gaps.** Claude Code records permission decisions (`permissionDecision`) and Codex its escalation requests and approved command prefixes; reading them is pending, and whether a decision made by configuration counts as an approval is an open decision (see the [fact matrix](l1-fact-matrix.md)). Sessions that were never uploaded can only be counted through coverage. Cost per tool call has no defensible allocation and stays per request and per run.
- **Scope.** Claude Code and Codex only.

## Joins

- **Instruction size.** Injected instruction characters per run, per instruction file hash. Transcripts record cache tokens per request, not per file, so a cost per instruction file is an estimate built on top of L1, not an L1 fact.

## Scale

Run facts and session links are recomputed on every `find` today (`FINAL` over `transcript_records`, no text skip index), which is why `find` caps scope at 10,000 sessions and its text scans at 100,000 records or 64 MiB, on top of per-statement ClickHouse limits. `rudel.run_index` materializes `runs` per committed generation: one row per run, keyed by the generation (`revision`, `parser_version`, `index_version`), the build (`build_revision`) and the run's stream and start record, so its `run_id` is the edges' run id, and one `receipt` per build, written after its runs, holding session facts (run count, call and error totals, merged skills, slash commands, subagent types and models, usage no run claims, the last cost-state, the title, the repository key and session model; every run row repeats the repository key). Every build is an immutable snapshot: the receipt with the newest (generation, build) commits the session's runs, readers read only that build (the API's run index reader), and a build that dies before its receipt changes nothing they see. The same reconciliation worker builds it (scope kind `run_index`, same scope id as the session's edges, never deferred for observations or re-queued by repository changes). Its request rides on the edges' request after git observations are written (ingest, backfill and repair), in the same statement; nothing else in an upload waits on the queue for it, and a daily census queues recently ingested sessions whose committed snapshot is missing or stale (transcript generation, index or pricing version, or usage extraction). A build reads the generation with the statements `find` uses for its runs, so their numbers cannot drift, copies each run's facts from its own records (the first or last recorded value, sorted sets, counts of records that carry one) and attributes Codex lifecycle rows to runs by `turn_id` (an opening row without a completion joins the next prompt with nothing between; a completion stays in the run it ended). A fact the generation's parser version or agent cannot record is NULL, and arrays name it in `unrecorded_facts`. Costs are frozen at build time with `pricing_version` from one usage extraction: its receipt must be complete with exactly the events it counts (otherwise usage is stored as unknown), every usage read is bound to it, it must be the same after the build's reads, and the runs' usage plus the usage no run claims (unverified, or on lines no run covers) must add up to it. A new usage receipt or pricing rebuilds the generation, a current receipt is skipped, a session over 200,000 records is frozen with its reason, and a session whose transcript generation is no longer committed keeps its stored runs. Nothing is nulled by age: the text columns are written and read as recorded. Builds are fenced by the purge tombstones (a fenced session loses its run index rows and scope), covered by the account and workspace purges, and snapshots are retired like `transcript_records` by the daily sweep, found from all rows: crashed builds once older than the committed one or past the grace, superseded ones after the grace, never the committed one. Run index 4 also keeps what a run's messages say: `prompt_reactions`, the word-list categories the language-signals scanner finds in its first genuine prompt (the scan `find` runs for reactions, done at build time because the word list exists only in TypeScript and scanning prompt text across a workspace at query time reads gigabytes), `final_message` with `final_message_cut` (whether only its start was kept, so a rule it cannot settle reads as unknown), and `system_prompt_recorded` (whether the stream recorded its system prompt at or before the run, which the coverage columns would otherwise read from every transcript record of the workspace). They are inputs, not interpretations: the approved measures that read them (frustration, said done, re-ask; `apps/api/src/services/analysis/sql-measures.ts`) live in the SQL views, so changing a rule rebuilds nothing. Run index version 5 also writes each run's requests (version 4 builds write none) (`rudel.run_requests`, one row per model response and the calls it made), after the runs and before the receipt, so the same receipt commits them; they are retired, fenced and purged with the run index. A request starts at a response record (assistant text, reasoning or a tool call) after a record that is not one (the prompt, a tool result, injected context); a Claude Code response is written over several lines and can have a tool result between two of them, so where the stream has usage a Claude request starts only on the first line of a usage event (an event whose first line carries only usage stands at the response record after it, for the request's start and its usage). Its lines run to the next request (the first request's usage lines from the run's start), so every verified usage event of a run with a request is on exactly one of its requests: tokens and cost exist per request, never per call. Codex writes one usage event per response (`token_count`, or `token_usage_record` keyed by `response_id`), checked read-only on production on 2026-10-12 (requests and usage events matched one to one on recent Codex sessions of our own workspace), so Codex requests carry their own tokens too. Each request keeps its calls' tools, tool groups, command classes and failures, and the record and block of its last text (a line can hold reasoning before it), so the run view's phases (`phases.ts`) are cut at read time by a versioned rule and change with the rule, not the data. Weekly totals sit on top for team-wide counts (next section).

## Received setup

The setup a run received (CONTEXT.md "Received setup", OPL-391) is what its transcript records, never what is on disk. Parser 10 names each piece of setup text on the record that carries it, in `facts['received_setup']` (kind, recorded path, name, working directory, SHA-256 and length): the Claude Code `prompt_snapshot` system prompt (its fixed part and, after `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`, its per-session part), `instructions` files (`files[].content`), `nested_memory`, MCP instruction blocks and skill bodies (`Base directory for this skill:`, without that line and the invocation's `ARGUMENTS:`); Codex base instructions, developer message blocks (named by their leading tag; the skill listing is left to OPL-392), AGENTS.md injections and a whole SKILL.md the agent printed with `cat`. The transcript-records writer stores each distinct text once per member in `rudel.setup_texts` (keyed by hash; cut at 1 MiB, hash and length of the whole), before the generation's receipt. The system prompt's parts in `instruction_text_components` are no longer cut at 4,096 and 65,536 characters (now 262,144 per part and 524,288 per record).

Run index 6 writes `rudel.run_setup` with the build's runs and requests, committed by the same receipt and retired, fenced and purged with the run index: one row per run and setup file version it had, the versions received during the run and the latest version of each setup file received earlier in its stream (`carried`), with whether a compaction came between. A setup file is named by where it lives (`received-setup.ts`): a plugin's file by plugin and marketplace (any version), a file under the session's working directory by the session's repository (its git remote) and path, a file in a home directory by the member and `~/` path, anything else by the member and machine path; the agent's own text by agent and part, MCP instructions by server. A repository file's version is uncommitted when the git status Claude Code recorded at the session's start lists it or the session changed the file before receiving it, and is then named after the member; with no status (Codex), a cut one, or outside a repository it is unknown. The `setup_files` SQL view reads the committed build's rows; the run view's `setup` section lists them and opens each text at the version the run received; `runs.coverage_gaps` names `received_setup` for runs built before index 6 or parsed before parser 10. Existing sessions need `backfill:transcript-records` (parser 10) and then `backfill:run-index` (index 6).

## Weekly totals

`rudel.weekly_totals` holds the run index summed per workspace, member (`user_id`), agent (`claude_code` or `codex`) and ISO week (`week`, the Monday in UTC of the week a run started). Team-wide questions over months ("denials per member since July", "cost per week before and after the hook change") become one lookup instead of a scan that hits `find`'s caps, and the weekly series is the measuring stick that shows whether a shipped fix moved the numbers. Nothing is interpreted: each measure is a plain sum or count of literal run index facts. There is no repository breakdown.

**What it reads.** Each session's committed build only: the build its newest receipt names by `(revision, parser_version, index_version, build_revision)`, as every run index reader reads it, with `FINAL` collapsing a retried write of the same build. Superseded builds, builds without a receipt (in flight or crashed) and purged sessions are never counted. A run counts in the week it started. The usage no run claims (on the receipt) counts in the week of the session date, so cost and tokens add up to the session's whole usage extraction. A week with neither runs nor usage has no row.

**How it is built.** A refreshable materialized view, `weekly_totals_mv` (`20261011150000_weekly_totals.sql`, recreated with `not_found_known_runs` by `20261012120000_not_found_unknown.sql`), recomputes everything from the run index every night at 03:00 UTC (`REFRESH EVERY 1 DAY OFFSET 3 HOUR`), and once when it is created. Production's `rudel` database is `Atomic` (each replica has its own database; the provider syncs the catalog), and ClickHouse coordinates refreshes only in `Replicated` (or Cloud `Shared`) databases, so each replica refreshes on its own and after a restart. A replace refresh swaps the target table (`EXCHANGE`) on the replica that ran it, which two uncoordinated replicas would race in a shared catalog; the view therefore `APPEND`s a whole snapshot per refresh, each row carrying `refresh_id` (replica host and `refreshed_at`) and `snapshot_rows` (the snapshot's row count). Readers read the newest snapshot whose stored rows number `snapshot_rows`, so a snapshot still being written, or one a failed refresh left part way, is never read; with two replicas there are two snapshots a night, a few seconds apart. Snapshots are partitioned by day and dropped whole after 14 days. The refresh runs under `max_threads = 2` and `max_memory_usage` 2 GB (spilling `GROUP BY` past 1 GB). Measured read-only on production on 2026-10-11 (124,000 run index rows, 10,600 indexed sessions, 23 workspaces): the full refresh query read 258,000 rows (69 MB, the run index twice) in 0.25 to 0.47 s with a peak of 76 to 92 MB at two threads, for 1,261 rows; one customer workspace took 0.19 s and 65 MB. Memory grows with the session-weeks held for grouping, so it stays far below the ceiling until the run index is many times larger.

**Measures.** Every column has a ClickHouse comment; `find source=weekly` returns them in camelCase.

| Columns | Meaning |
|---|---|
| `runs`, `genuine_prompts` | Runs that started in the week, subagent streams included (a Codex subagent thread is a session of its own); human prompts of those runs. |
| `sessions`, `sessions_started` | Sessions with a run in the week (a session spanning weeks counts in each, so it does not add up across weeks); sessions whose first run is in the week (adds up). |
| `minutes`, `active_minutes` | Sums of the runs' wall-clock and active minutes. |
| `tool_calls`, `failed_calls`, `edits`, `reads`, `searches`, `compactions`, `interrupt_markers` | Sums of the run columns of the same names (`edits` adds each run's distinct files). |
| `not_found` | Reads and searches that found nothing; known runs: `not_found_known_runs` (run index 3 or newer; Claude Code parser 6 or newer on its main stream, Codex every parser). |
| `failed_edits`, `refused_edits` | Edit outcomes, parser 9 or newer; known runs: `edit_outcomes_known_runs`. |
| `denied_calls`, `interrupted_calls`, `timed_out_calls`, `mcp_calls`, `api_errors`, `retry_attempts`, `refusals` | Sums of the run columns; each has `<column>_known_runs`. |
| `aborted_runs`, `turn_error_runs` | Runs a record says aborted; Codex runs whose `task_complete` records an error (`aborted_known_runs`, `turn_error_known_runs`). |
| `push_runs`, `commit_runs`, `pr_runs`, `commit_shas` | Runs with a Claude `gitOperation` push, commit or pr, and their distinct commit SHAs added up (`git_operations_known_runs`; Claude Code only, Codex git activity is in `find source=git`). |
| `pr_urls` | Pull request URLs named by the runs, not necessarily created (`pr_urls_known_runs`). |
| `skill_runs`, `skills`, `slash_commands`, `subagent_type_runs` | Runs that used a skill and the runs' distinct skills added up, slash commands, runs that started a typed subagent (each with its known runs). |
| `usage_known_runs`, `usage_observations`, `usage_unpriced`, `cost_usd`, `unattributed_cost_usd`, token columns | Runs whose usage is known; usage events, unpriced events, priced cost (with the usage no run claims; `unattributed_cost_usd` is that part) and tokens by kind (`uncached_input`, `cache_read_input`, `cache_write_5m_input`, `cache_write_1h_input`, `output`, `reasoning_output`). |

**Unknown is not zero.** A fact some parser versions or agents cannot record (the run index lists it in `unrecorded_facts`) is summed only over the runs that can record it, and `<fact>_known_runs` counts those runs; the sum is NULL when no run of the row can. A trend compares `denied_calls / denied_calls_known_runs`, never `denied_calls` alone, since a parser upgrade or a backfill raises the known runs. Usage is unknown for runs whose session's usage extraction was incomplete; they count in `runs` but not in `usage_known_runs`, cost or tokens.

**Traps.** The snapshot holds what was indexed at `refreshed_at`: runs indexed later (a new upload, a backfill, a reparse) appear after the next refresh, and the run index itself fills in as backfills reach older sessions. The week holding `refreshed_at` is partial. `find` reports both. Costs are frozen at each build's pricing version. Every member of a workspace sees all of its rows, every member's (owner decision): per-person totals tell a team-wide problem apart from one person's setup and are never for ranking people. Nothing crosses workspaces. Admins can also name one member (`userId`).

**Deletion.** Account and workspace purges delete the table's rows like the other derived tables; a refresh that was running when the run index was purged is removed by the purge's second pass.

## Retiring interpretations

Order per item: stop reading, stop writing (materialized views and recovery SQL), drop storage.

1. **No first-party consumer, delete now.** `analytics.roi.*`, `learnings.*`, `errors.*`, `projects.*`, `developers.*` except `list` and `teamCards`, `overview.insights`, `successRate`, `teamSummaryComparison`, `usageTrend`, `modelTokensTrend`, `usersTokenUsage`, `repositoriesDailyTrend`, `sessions.summary`, their services, the unused dashboard page chain in the web app, and the generated `content.schema.ts`.
2. **Fetched but never shown.** `success_score` (and the plugin code that strips it), `has_commit`, `used_plan_mode`, `avg_period_sec` and `median_period_sec`, the Wrapped archetype on team cards and its rebuild pipeline.
3. **Derived columns with no reader.** `session_archetype`, `error_pattern`, the response-gap buckets, `inference_duration_sec` and `human_duration_sec`; then the `skill_assessments` column of the evidence index.
4. **Live, replace first.** `error_count` with counted `is_error` records; the regex `skills`, `slash_commands` and `subagent_types` with `skill_uses` and records; `resolveRepoIdentity` with the repository identity join; wrapper-regex prompt origin with the native origin fields; `model_used` with per-request models.
5. **Analysis-agent classifiers** (failure classifier, `toolGroup`, reactions): removed from the tool interface once literal `find` ships; `command_class` stays stored beside `command_prefix`.

The language-signal lexicon stays: it stores literal phrase matches.

Status: steps 1 and 2 stopped reading (#218, #219). The views and the recovery SQL stop writing the step 2 and 3 columns (`success_score`, `has_commit`, `used_plan_mode`, `avg_period_sec`, `median_period_sec`, `quick_responses`, `normal_responses`, `long_pauses`, `error_pattern`, `session_archetype`, `inference_duration_sec`, `human_duration_sec`) with `20261008120000_session_analytics_retired_writes.sql`, and the evidence index stops writing `skill_assessments`; their columns keep defaults until a later migration drops them, once every writer runs that code.

## Run-index semantic agent coverage (index 2, unshipped)

Every one of the 63 gated fact columns is linked by meaning through the catalog entry's `runIndex`, not by matching storage-key spelling. Multiple entries may feed a column: `skills` links both invocation/read evidence and Claude attribution. The guard in `run-index-columns.test.ts` requires every stored agent counterpart to be read or explicitly excluded in `RUN_INDEX_NARROWED_COLUMNS` with a reason; supported per-agent fields and their first scalar/component versions are checked separately. A catalog entry's `stores.since` may describe a richer v9 family while its older scalar was already stored in v6-v8.

C = Claude Code; X = Codex. Versions below are the first readable representation, including legacy text. Record-derived spans, call counts, edit totals and usage are outside these gates and remain unchanged.

| Column | Semantic catalog link(s) | Agents before | Agents after |
| --- | --- | --- | --- |
| `failed_edits` | `runs/edits` | C v9; X v9 | C v9; X v9 |
| `refused_edits` | `runs/edits` | C v9; X v9 | C v9; X v9 |
| `agent_version` | `runs/agent_version` | C v6; X v6 | C v6; X v6 |
| `entrypoint` | `runs/entrypoint` | C v6; X v6 | C v6; X v6 |
| `duration_ms` | `runs/duration_ms` | X v7 | X v7; **NARROWED N1** |
| `time_to_first_token_ms` | `runs/time_to_first_token_ms` | X v7 | X v7 |
| `turn_origin` | `prompts/prompt_origin` | C v8 | C v8; **NARROWED N2** |
| `prompt_source` | `prompts/prompt_origin` | C v8 | C v8; **NARROWED N3** |
| `origin_kind` | `prompts/prompt_origin` | C v8 | C v8; **NARROWED N4** |
| `trigger_turn` | `runs/prompt_triggers_turn` | X v8 | X v8 |
| `thread_source` | `session/thread_source` | X v8 | X v8 |
| `permission_mode` | `runs/permission_mode` | C v7 | C v7 |
| `permission_modes` | `runs/permission_mode` | C v7 | C v7 |
| `auto_mode_bash_first` | `runs/auto_mode_*` | C v7 | C v7 |
| `auto_mode_bash_first_steer` | `runs/auto_mode_*` | C v7 | C v7 |
| `auto_mode_bypass` | `runs/auto_mode_*` | C v7 | C v7 |
| `auto_mode_steer_only` | `runs/auto_mode_*` | C v7 | C v7 |
| `auto_mode_consent_flow` | `runs/auto_mode_*` | C v7 | C v7 |
| `approval_policy` | `runs/approval_policy` | X v7 | X v7 |
| `approvals_reviewer` | `runs/approvals_reviewer` | X v7 | X v7 |
| `sandbox_policy` | `runs/sandbox_policy` | X v7 | X v7 |
| `sandbox_network_access` | `runs/sandbox_policy` | X v7 | X v7 |
| `permission_profile` | `runs/permission_profile` | X v9 | X v9 |
| `collaboration_mode` | `runs/collaboration_mode` | X v7 | X v7 |
| `model` | `runs/model` | C v7; X v7 | C v7; X v7 |
| `models` | `runs/model` | C v7; X v7 | C v7; X v7 |
| `effort` | `runs/effort` | C v7; X v7 | C v7; X v7 |
| `per_turn_effort` | `runs/effort` | C v7 | C v7; X v7 |
| `context_window` | `runs/context_window` | X v7 | X v7 |
| `denied_calls` | `calls/denial_kind` | C v9; X v9 | C v9; X v9 |
| `interrupted_calls` | `calls/interrupted` | C v6; X v8 | C v6; X v8 |
| `timed_out_calls` | `calls/timed_out_after_ms` | C v6 | C v6 |
| `mcp_calls` | `calls/mcp_server` | C v9; X v6 | C v9; X v6 |
| `mcp_servers` | `calls/mcp_server` | C v9; X v6 | C v9; X v6 |
| `skills` | `calls/attribution_skill` + `calls/skill` | C v6 | C v6; X v9 |
| `slash_commands` | `prompts/slash_command` | C v1 | C v1 |
| `subagent_types` | `calls/subagent_type` | C v1 | C v1; X v9 |
| `compact_trigger` | `runs/compact_trigger` | C v7 | C v7 |
| `compact_pre_tokens` | `runs/compact_pre_tokens` | C v7 | C v7; **NARROWED N5** |
| `aborted` | `runs/aborted` | C v7; X v7 | C v7; X v7 |
| `abort_reason` | `runs/abort_reason` | X v7 | C v9; X v7 |
| `turn_error` | `runs/turn_error` | X v7 | X v7 |
| `turn_error_kind` | `runs/turn_error_kind` | X v7 | X v7 |
| `stop_reason` | `runs/stop_reason` | C v7 | C v7 |
| `hook_stop_reason` | `runs/hook_stop_reason` | C v7 | C v7 |
| `prevented_continuation` | `runs/prevented_continuation` | C v7 | C v7 |
| `hook_count` | `runs/hook_errors` | C v7 | C v7 |
| `hook_errors` | `runs/hook_errors` | C v7 | C v7 |
| `hook_runs` | `runs/hook_runs` | C v7 | C v7 |
| `api_errors` | `runs/api_errors` | C v7 | C v7; X v9 |
| `api_error` | `runs/api_errors` | C v7 | C v7; X v9 |
| `api_error_statuses` | `runs/api_errors` | C v7 | C v7; X v9 |
| `retry_attempts` | `runs/retry_attempts` | C v7 | C v7 |
| `refusals` | `runs/refusals` | C v7 | C v7; **NARROWED N6** |
| `fallback_model` | `runs/fallback_model` | C v7 | C v7 |
| `goal` | `runs/goal` | X v7 | X v7 |
| `git_operations` | `calls/git_operation` | C v6 | C v6 |
| `pushed_branches` | `calls/git_operation` | C v6 | C v6 |
| `commit_shas` | `calls/git_operation` | C v6 | C v6 |
| `pr_urls` | `runs/pr_number` | C v6 | C v6; X v1 |
| `facts_truncated` | `session/facts_truncated` | C v6; X v6 | C v6; X v6 |
| `title` | `session/title` | C v8 | C v8 |
| `cost_state` | `session/cost_state` | C v8 | C v8 |

### Written semantic narrowings

- **N1, `duration_ms`:** Claude durationMs/durationSeconds time individual tool results, not a turn. Session cost-state totalDuration is cumulative. Neither can be summed or copied as Codex task_complete/turn_aborted run duration.
- **N2, `turn_origin`:** Codex prompt_origin stores a communication author's identity, not the turnOrigin classification. Keep sender provenance in components; do not invent a classification.
- **N3, `prompt_source`:** Codex author identifies a sender, not Claude's promptSource classification. There is no equivalent source label to project.
- **N4, `origin_kind`:** Codex author is a sender path, not an origin.kind enum. Converting every author to 'agent' would fabricate an unrecorded kind.
- **N5, `compact_pre_tokens`:** Codex latest_token_usage_record is the latest request's usage snapshot, not context tokens immediately before compaction. Cumulative total_tokens/thread_token_usage and last-request input tokens are not this measurement.
- **N6, `refusals`:** Codex generic terminal errors include cyber_policy/misalignment_policy_violation; these report policy termination, not a recorded model refusal. Counting all errors or policy stops as model refusals changes the meaning.

### Projection and rebuild rules

- Codex skills use explicit UserMessage skill names (a path alone falls back to its directory name) and the parent directory name of parsed `read` paths ending in `SKILL.md`. Ordinary reads and search paths do not become skills. Claude attribution, literal Skill input and its typed `skill` fact are unioned; this does not prove instructions were followed.
- Codex subagent types read only the `spawn_agent.arguments.agent_type` component, not model/effort. Both the run and receipt keep merged sets.
- Codex per-turn effort uses turn-id-attributed lifecycle effort, falling back to the runs literal non-lifecycle effort; Claude keeps its separate `perTurnEffort` value.
- Claude abort reason reads the recorded interruption component. A tool duration is never substituted for a run duration.
- Codex API errors count terminal records with explicit provider/transport request kinds: `server_overloaded`, `usage_limit_exceeded`, `http_connection_failed`, `response_stream_connection_failed`, `response_stream_disconnected`, `response_too_many_failed_attempts`. Generic/policy errors are not API errors. Status sets contain only recorded three-digit HTTP statuses from `http_status_code` or `status_code`; a missing status stays empty, never a kind label or invented code. Terminal-only coverage is not full retry visibility.
- Codex PR URLs are literal GitHub pull-request URLs extracted from the pinned stored tool-result text, not the 240-character head and not an unpinned `session_git_observations` join. The text has existed since parser 1. A named URL is not proof of PR creation; capped or omitted stored text cannot supply a URL.
- `RUN_INDEX_VERSION` stays **2**. The existing pricing/rebuild fingerprint now includes literal run SQL, delegation SQL, agent gates and the row-projection rules as well as pricing SQL, invalidating stale unshipped index-2 snapshots without changing the index version. Pinned organization/user/generation filters precede grouping; no new unscoped join is added.

## Order of work

Existing data is brought up to each step with the backfills, in the order and with the checks of the [backfill runbook](l1-backfill-runbook.md).

1. This spec and step 1 of the retirement. Done.
2. Retirement step 2. Done.
3. Git extractor version 3 and the session, pull request and CI links, exposed to `find` (computed at query time).
4. Retirement step 3: stop writing, then drop storage, with the `session_analytics` migration.
5. The edge table and reconciliation worker (ADR 0003), fed by the existing evidence; captures and snapshots published to ClickHouse; `find source=git` reads edges, and pull request → runs works in reverse. Built: the worker (its cron off until `L1_EDGES_WORKER_ENABLED`), `find`'s edge reads with the query-time fallback, and `pullRequest`; captures and snapshots are still read from Postgres.
6. `run_index` on the same worker, coverage and retention; then retirement step 4 (`error_count`, regex skills). Built: the table, its builds on the worker, its retirement, the census and the backfill (`backfill:run-index`), and the weekly totals on top of it (`find source=weekly`); `find` reading runs from it is next.
7. Transcript-records parser v6 with the raw facts above, its fixture test, and backfill. Shipped as parser versions 6 (`calls` facts and `agent_version`/`entrypoint` on every record), 7 (`runs` facts and Codex spawned thread ids) and 8 (`prompts` and session facts), with one backfill after 8. The fact catalog, rendered as the [fact matrix](l1-fact-matrix.md), holds every fact per agent; `l1-facts.test.ts` fails when a fact of this spec has no catalog entry or a stored fact loses its fixture case, and the run index test when a run index column disagrees with it.
8. CLI capture of git ownership (tool hooks, worktree and process identity) and commit facts from GitHub (committer time, parents).
9. GitHub evidence and repository configuration in ClickHouse.
10. `find` over `calls`, `runs`, `prompts` and edges, the schema reference and premade queries in the plugin skill. Built: `find source=calls` with the command identity columns (filters and `groupBy` on fingerprint, program and prefix, simhash near-duplicates).
11. The drift census (built: `facts:census`, checked over the parser fixtures; a recurring run over production uploads is next) and retirement step 5.
