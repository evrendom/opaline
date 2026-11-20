# L1 judge round 3

Offline review, 2026-10-09. Binding input: the round's written rulings and
per-item reviewer evidence. The compact decision ledger is
[l1-judge-round3-decisions.json](l1-judge-round3-decisions.json).
No parser behavior changes; gaps remain parser-9 work.

## Mapping rulings

All 114 reviewed mappings are applied: 75 agreements and 39 resolved
disagreements. Positive witnesses defeat absence claims; agent-written
configuration/origin fields are not Opaline provenance. Exact requires the
same scope and unit, otherwise the relation retains a close/broader/narrower
caveat. Numbered Codex unified-diff headers have a named parsing transform,
not a claim that hunk coordinates are absent. Applied changes remain a join
of literal change type and outcome. An unwitnessed optional Agent name has
a close contract-backed counterpart, not an invented census witness.

## Source corrections

A bounded, sequential line-by-line audit retains counters only (peak reported
RSS 220 MB, no transcript text or local Claude Code source retained):

- Tool search names: `tools[].tools[].name` has 12,783 leaves. The outer
  `tools[].name` has 5,425 group/namespace labels, not individual tool names.
- Tool search call/output IDs: 2,119 witnesses each; add both stored call-ID
  sources. Also register the witnessed custom-tool-output name.
- HTTP status: 3 under `task_complete.error`, zero under `turn_aborted.error`.
  Add the witnessed carrier; keep the optional aborted carrier because
  `codex-rs/protocol/src/protocol.rs:4250-4260` declares its error field.
- Bash timeout: 4,356 calls in the continuing local corpus (the reviewers
  counted 4,353); exclude the input path from stored sources and keep its
  explicit parser-9 gap. Monitor result timeoutMs remains stored; Monitor
  input timeout_ms is in JSON but is not a structured timeout fact.
- SendMessage pin: the binding 89/89 recipient witness wins over the artifact
  interpretation. Move the pin identity out of activity and into recipient
  and sub-agent identity sources.

No binding ruling is disputed. The small corpus-count change is expected
while sessions continue; it does not change a placement decision.

## Ignore-path rulings

The 1,218 reviewed paths partition into 705 agreed ignores, 71 agreed maps,
154 map-vs-map agreements and 288 conflicts. All agreements stand.
Every one of the 225 map agreements names a primary source on its placed fact.
The ledger records every conflict and agreed map, with both proposed meanings
and reviewer evidence; unchanged agreed ignores retain their existing rules.

| Ruling | Paths | Resolution |
|---|---:|---|
| A | 140 | Verified input-text duplicates; explicitly conditional on truncation |
| B | 2 | Map description and unknown execution-option component; existing timeout/background/options sources retained |
| C | 30 | Map environment/account/model/configuration values; one-machine constancy is insufficient |
| D | 5 | Map structured usage and inventory numbers/names instead of re-parsing prose |
| E | 3 | Bookkeeping: stop_details/output_tokens_details; WATCH: stop_sequence |
| F | 18 | 17 mapped provenance paths; content.path is a verified duplicate on 42/42 stored instruction paths |
| G | 26 | Retain text-copy/definition/reminder/media exclusions |
| H | 64 | 49 literal placements, 13 separately counted duplicates, 1 secrets exclusion, 1 undecided enum |

There are 328 newly placed reviewed paths plus one explicit undecided path.
The execution-option family also registers the already catalogued prefix-rule
request as a named option. All mapped/pending paths are excluded from broad
ignore patterns, not just covered accidentally by a wildcard source.
Truncation-aware duplicate rules say: “contained in the stored input text
unless truncated (65,536 chars / session budget)”. `exec_command env.{*}`
remains ignored: “may contain secrets; never stored”. Parser-9 option plans
require an allowlist, not unconditional storage of unknown argument values.

1 item cannot yet be semantically decided: `claude_code:attachment/batching_reminder_sent.attachment.clearAt`.
Sol was unsure; Sonnet proposed WATCH for `next_user_message` on 513/513
records. No permitted schema proves it an intrinsic fixed enum. It is retained
as an unreviewed pending component of `session/context_configuration`, with both
proposals, not silently ignored and not certified as a machine-independent
constant. All other items are placed or explicitly excluded.

Ignore-list entries (patterns, not corpus-path counts): verified_duplicate
158, bookkeeping 272,
constant_watch 19, text_copy 140,
stream_identity 5: **594 total**.
The 705 agreed ignored paths all still match an ignore rule after exclusions.
Root/parent `session_id` is no longer checked as current-stream identity.

The final live census exposed two diagnostic follow-ups, also fixed without
changing parser behavior: `stop_sequence` WATCH accepts both known null and
empty-string values (reviewer counts: 62,715 null, 90 empty), and Codex stream
identity checks only `session_meta.id` / `token_usage_record.thread_id`, never
root `session_id`. Identity alerts now name the actual literal path; genuine
thread-ID disagreements with the filename remain alerts, not repaired data.

## New pending facts

42 families, all with one-line meanings and parser-9 plans. Distinct
components, units, order, absent versus empty, requested versus actual and
creation versus later snapshots remain separate; family batching is not an alias
for interchangeable values. Existing facts receive literal sources or gaps.

- calls: `command_description`, `mcp_structured_content`, `skill_allowed_tools`, `fetch_response_details`, `wakeup_details`, `background_task_details`, `file_result_details`, `search_result_lines`, `tool_result_details`, `tool_inventory_counts`, `tool_lifecycle`, `command_script_path`, `web_action_details`, `web_result_details`, `image_generation_prompt`, `connector_link_id`, `mcp_attribution`, `output_truncation`, `call_exec_options`.
- runs: `input_transformations`, `offered_agent_types`, `offered_tool_options`, `system_event_details`, `goal_timestamps`, `filesystem_policy`.
- prompts: `current_date`, `context_source_details`, `prompt_delivery_options`, `queued_producer_usage`, `source_call_id`, `prompt_mentions`, `base_instruction_provenance`.
- session: `session_slug`, `context_configuration`, `context_model_identity`, `account_context`, `environment_changes`, `environment_snapshot`, `workspace_roots`, `lineage_session_id`, `subagent_history_start_ordinal`, `session_created_at`.

## Evidence boundaries and deferred extraction

Twelve specifically witnessed Codex source paths are absent from the pinned
writer snapshot: legacy end-event components, older top-level context fields
and out-of-contract execution arguments. Scoped local-source notes record
them, backed by positive committed census counters; none becomes a declared
writer field or semantic proof. Missing source exceptions and changed SDK
coverage are regression-tested; no arbitrary JSON subtree is exempted.

One wording caveat in the judge's input-storage summary: Opaline also renders
only the command for Codex `shell`, `shell_command`, `container.exec` and
`local_shell` (`codex-records.ts:54-59,552-565`). The blanket “other tools
store whole raw arguments” statement is not universal. None of the 1,218
reviewed paths uses these aliases, so no binding placement changes. The
catalog's input-text caveat and execution-option parser-9 plan record this
additional gap; parser behavior is unchanged.

The public BashInput description contract and Codex durable root-session
writer are cited explicitly. All other reviewer-only placements remain
observed/asserted unless the usual writer/type plus witness requirements
actually hold; a family or LLM agreement cannot manufacture verification.
