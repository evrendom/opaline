# L1 parser review: session

2026-10-09. Reviewed both-reviewer flags first, then single-reviewer flags. Exactly one class per mapping. No parser behaviour changes. `catalog_wording` includes pending proposals with no parser extraction yet: sources/notes now state the actual stored subset or proposed filter. `stored_data_wrong` retains the current values and records a parser-9 plan. Unpublished agent implementation evidence is excluded.

Counts: catalog_wording=15.

Parser files are under `packages/api-routes/src/session-transcript/transcript-records/` unless prefixed `apps/api`. The usage checks additionally read `packages/usage-events/src/extract.ts`; git checks read `apps/api/src/services/git-observation-parser.ts`. Counts labelled prior census retain that historical denominator; fresh scan counts may grow with this session.

| Mapping | Flagged by | Class | Parser check / decision; data witness for defects |
| --- | --- | --- | --- |
| `session/approved_permission_prompts/codex` | both | `catalog_wording` | No parser value is stored for this pending proposal. Listed sources are requests (553 sandbox_permissions=require_escalated), not approvals; an approval is only inferable when a request was not rejected.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/facts_clipped/claude_code` | both | `catalog_wording` | Catalog scope correction: Not an agent fact; mapping per agent is N/A.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/facts_clipped/codex` | both | `catalog_wording` | Catalog scope correction: Not an agent fact; mapping per agent is N/A.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/facts_truncated/claude_code` | both | `catalog_wording` | Catalog scope correction: Not an agent fact; mapping per agent is N/A.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/facts_truncated/codex` | both | `catalog_wording` | Catalog scope correction: Not an agent fact; mapping per agent is N/A.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/parent_session/claude_code` | both | `catalog_wording` | Stream layout supplies the parent session; agentId identifies the child and isSidechain is context. Neither literal child field is a parent ID.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/parent_session/codex` | both | `catalog_wording` | No parser value is stored for this pending proposal. session_meta.source.subagent.other is a marker string (guardian), not a parent link.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/title/codex` | both | `catalog_wording` | No parser value is stored for this pending proposal. Note says titles live in ~/.codex/state_5.sqlite, so this is not_found in rollouts, not not_emitted.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/approved_permission_prompts/claude_code` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Count only accept with the human decision source; config acceptance is not a user-approved prompt and dialog presence is not independently recorded.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/instruction_file_versions/claude_code` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Specify the path/content/hash grouping and loading boundaries; the empty-source planned index is not a literal version source.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/instruction_file_versions/codex` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Require explicit file boundaries and session-loading provenance before assigning individual instruction versions.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/member_coverage/claude_code` | sol | `catalog_wording` | No parser value is stored for this pending proposal. This workspace aggregate is outside the scope of agent-written L1 facts.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/member_coverage/codex` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Keep this workspace-level aggregate separate from session transcript facts.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/upload_mode/claude_code` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Move upload provenance out of the agent-literal catalog or explicitly mark its external source.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
| `session/upload_mode/codex` | sol | `catalog_wording` | No parser value is stored for this pending proposal. Uploader mode is external metadata, not a Codex-written transcript fact.  Parser: line-items.ts; format adapters; stream/CLI provenance. |
