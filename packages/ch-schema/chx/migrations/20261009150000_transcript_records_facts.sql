-- Parser v6 facts (docs/l1-literal-schema.md, step 7): literal values the
-- transcript records carry, as typed columns and a facts map. Additive;
-- existing rows read the defaults (empty, NULL, empty map), which mean not
-- recorded. facts gets CODEC(ZSTD(3)) by hand, as text does.
ALTER TABLE rudel.transcript_records
  ADD COLUMN IF NOT EXISTS `agent_version` LowCardinality(String) COMMENT 'Agent version that wrote the record: Claude Code version, Codex session_meta cli_version; empty when not recorded.',
  ADD COLUMN IF NOT EXISTS `entrypoint` LowCardinality(String) COMMENT 'How the agent was started: Claude Code entrypoint, Codex originator; empty when not recorded.',
  ADD COLUMN IF NOT EXISTS `denial_kind` LowCardinality(String) COMMENT 'Why a tool call did not run, as recorded (Claude Code toolDenialKind: permission-rule, user-rejected, cancelled, interrupted); empty otherwise.',
  ADD COLUMN IF NOT EXISTS `duration_ms` Nullable(UInt32) COMMENT 'Recorded duration in milliseconds (tool result, Codex item or task, cost state); NULL when not recorded.',
  ADD COLUMN IF NOT EXISTS `timed_out_after_ms` Nullable(UInt32) COMMENT 'Milliseconds after which the agent recorded a tool call as timed out; NULL when not recorded.',
  ADD COLUMN IF NOT EXISTS `interrupted` Nullable(Bool) COMMENT 'Whether the tool result records the call as interrupted; NULL when not recorded.',
  ADD COLUMN IF NOT EXISTS `git_operation` Array(LowCardinality(String)) COMMENT 'Git operations the agent recorded for a tool result (Claude Code gitOperation keys: push, pr, branch, commit); empty when not recorded.',
  ADD COLUMN IF NOT EXISTS `mcp_server` LowCardinality(String) COMMENT 'MCP server of a tool call as recorded (Claude Code attributionMcpServer, Codex McpToolCall server); empty otherwise.',
  ADD COLUMN IF NOT EXISTS `mcp_tool` LowCardinality(String) COMMENT 'MCP tool of a tool call as recorded (Claude Code attributionMcpTool, Codex McpToolCall tool); empty otherwise.',
  ADD COLUMN IF NOT EXISTS `attribution_skill` LowCardinality(String) COMMENT 'Skill the agent attributed the record to (Claude Code attributionSkill); empty when not recorded.',
  ADD COLUMN IF NOT EXISTS `facts` Map(LowCardinality(String), String) COMMENT 'Further literal facts of the record, keyed by the L1 spec column name from the parser fact registry; a missing key means not recorded.' CODEC(ZSTD(3));
