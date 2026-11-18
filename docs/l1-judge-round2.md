# L1 judge round 2 and Track 1

Offline review, 2026-10-09. Binding input: `~/l1-work/judge2/rulings.md`,
with both reviewers' JSON decisions and count-only witnesses. Parser behavior
is unchanged; incorrect extraction remains `wrong`, with parser-9 plans.

## Ruling sections

- Wrong entries: all 15 resolved. Codex exit codes are stored plus a late-result
  gap (125,561 matches, zero mismatches); file operations describe requests,
  not effects. Codex read counts remain wrong (64,439/130,400 disagreements).
- Mappings: all 66 decisions applied, including the 17 searched Claude
  counterparts as `not_found`, exact primary paths for subagent activity and
  rate limits, and the transient approval-request exclusion. Claude compaction
  remains unreviewed without a local witness.
- Residue: all 102 disputed paths resolved; all 305 original residue decisions
  remain traceable, with no unresolved residue. Separate meanings/units are
  separate facts or explicitly named family components, never silent aliases.
- Ignores: every entry has a rule. Final counts: verified duplicate 4, stream
  identity 5, constant WATCH 18, text copy 114, bookkeeping 272 (413 total).
  Duplicate verification and observed constants are part of the data. Census
  guards check every value, including non-enum leaves and populated containers.

## New catalog entries

50 entries are added: 48 pending with parser-9 plans; `thread_source` and
`prompt_triggers_turn` already have literal parser-8 storage, recorded honestly
instead of being mistaken for `prompt_origin`.

- Session: `model_provider`, `record_uuid`, `disabled_plugin_ids`,
  `thread_source`, `runtime_workspace_roots`, `fork_point`, `creator_user_id`,
  `creator_account_id`.
- Prompts: `message_provenance`, `attachment_rendered_role`,
  `message_content_kinds`.
- Runs: `message_created_at`, `offered_tools`, `thinking_drop`,
  `assistant_delivery_origin`, `prompt_triggers_turn`,
  `communication_recipient`, `communication_other_recipients`,
  `turn_error_http_status`, `non_steerable_turn_kind`, `goal_token_budget`,
  `turn_attribution`, `review_finding_title`, `memory_citation_note`,
  `assistant_message_delivery`.
- Calls: `command_source`, `patch_hunks`, `task_status_change`, `read_extent`,
  `stale_read_recovered`, `applied_file_changes`, `permission_profile_parent`,
  `local_shell_status`, `execution_user`, `execution_environment_id`,
  `requested_additional_permissions`, `subagent_activity_at_ms`,
  `tool_result_content`, `mcp_result_metadata`, `mcp_app_resource_uri`,
  `mcp_app_display_mode`, `tool_result_text`, `dynamic_tool_error`,
  `subagent_thread_ids`, `subagent_role`, `subagent_nickname`,
  `subagent_resolved_effort`, `subagent_resolved_model`, `subagent_states`,
  `image_generation`.

## WATCH follow-up

The first streaming review exposed incorrect constant assumptions in the
initial ignore classification. A second, targeted line-by-line pass retained
only bounded classification/role/boolean counters, never transcript text:

- Attachment rendered roles: `system` 11,388, `user` 440. New pending fact
  `attachment_rendered_role`; explicitly excluded from the rendered-text ignore.
- Content classifications: 26 literal tags, including `user.text` 127,636 and
  `unknown` 16,384. New pending `message_content_kinds`; retain raw tags/order,
  not just the underlying content-block type. Published Codex writer meaning:
  `codex-rs/protocol/src/models.rs:970-976`.
- Client-authored metadata: false 52,866, true 168. Add a separately named
  component of `message_provenance`, not a constant or trust inference.
  Writer: `codex-rs/history/src/lib.rs:85-87`.
- Collaboration states: 3,278 empty **objects**, not arrays. Correct WATCH to
  `{}`; populated state descendants remain pending `subagent_states`.
- Map witnessed variants to their existing pending facts: assistant delivery
  189, MCP app resource URI 54, legacy command source 65 (Codex 0.107.0).
  None is generic bookkeeping. The legacy source has an explicit witness pin.

The original streaming review also reported identity inconsistencies:
196 `session_meta` records and 29,091 token-usage records disagree with their
stream identity. These stay alerts; they are not silently ignored, repaired,
or interpreted as new agent identities. Corpus counts are time-specific.

No binding ruling is disputed. The follow-up corrects implementation
assumptions and applies the judge's literal-variation/placement rules.

## Track 1

Claude public SDK oracle: 1,075 declarations, 43 tools, 851 distinct tool/path
pairs; 88 catalog tool sources = 75 declaration matches + 13 explicit notes,
zero unaccounted. The committed local census witnesses 241 pairs; 610 are blind
spots, and 72 local paths are absent from the SDK. Result witnesses are pooled
across tools. See `l1-published-types-oracle.md` and the compact coverage JSON.

Codex absence audit: 35 bounded writer/snapshot checks, two upgrades and 33
retained `not_found`; see `l1-codex-absence-review.md` and the per-case audit JSON.

Committed-census confidence and relations (197 entries per agent):

| Agent | Verified | Observed | Asserted | N/A | Judged literal | Unreviewed |
|---|---:|---:|---:|---:|---:|---:|
| Claude | 22 | 79 | 79 | 17 | 92 | 52 |
| Codex | 3 | 86 | 93 | 15 | 84 | 62 |

Absence and N/A relations are excluded from judged-literal counts. Additional
SDK structure alone, opaque JSON and unreviewed paths do not certify meaning.
