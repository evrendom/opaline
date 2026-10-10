import { schema, table } from "@chkit/core";

// One row per JSONL record (or per content block / file change inside a
// record). Everything here is deterministic: observed tool calls, exit codes,
// file paths, and human-written or model-emitted transcript text. No generated
// summaries.
//
// An extraction generation is (revision, parser_version): the raw-session
// revision the rows were derived from and the splitter version that derived
// them. Row identity is (organization_id, user_id, session_id, revision,
// parser_version, agent_id, record_idx, block_idx), so ReplacingMergeTree only
// ever collapses retries of the SAME generation. A generation that crashes
// before its receipt can therefore never merge away rows of the generation
// readers are still serving. record_idx is the 1-based JSONL line number
// inside the stream for agent_id ('' is the main transcript). The engine has
// no version column on purpose: rows of one generation are deterministic, so a
// retry replaces identical rows.
//
// A receipt row (kind = 'receipt', record_idx = 4294967295) is written last for
// each generation; its presence proves the generation was fully extracted. The
// committed generation of a session is its newest receipt by (revision,
// parser_version). Writers keep the previous committed generation after a new
// receipt lands, and delete older generations on the following publication.
const rudel_transcript_records = table({
	database: "rudel",
	name: "transcript_records",
	engine: "SharedReplacingMergeTree",
	columns: [
		{ name: "organization_id", type: "String" },
		{ name: "user_id", type: "String" },
		{ name: "session_id", type: "String" },
		{ name: "source", type: "LowCardinality(String)" },
		{ name: "agent_id", type: "String" },
		{ name: "revision", type: "UInt64" },
		{ name: "record_idx", type: "UInt32" },
		{ name: "block_idx", type: "UInt16" },
		{ name: "turn_idx", type: "UInt32" },
		{ name: "ts", type: "DateTime64(3, 'UTC')" },
		{ name: "session_date", type: "DateTime64(3, 'UTC')" },
		{ name: "kind", type: "LowCardinality(String)" },
		{ name: "subtype", type: "LowCardinality(String)" },
		{ name: "tool_name", type: "LowCardinality(String)" },
		{ name: "command_class", type: "LowCardinality(String)" },
		{ name: "is_error", type: "Bool" },
		{ name: "exit_code", type: "Int32", nullable: true },
		{ name: "call_id", type: "String" },
		{ name: "file_path", type: "String" },
		{ name: "file_op", type: "LowCardinality(String)" },
		{ name: "spawned_agent_id", type: "String" },
		{ name: "byte_start", type: "UInt64" },
		{ name: "byte_len", type: "UInt32" },
		{ name: "text_chars", type: "UInt32" },
		{ name: "parser_version", type: "UInt16" },
		{ name: "head", type: "String" },
		{ name: "tail", type: "String" },
		// chkit cannot express column codecs or generate types for them, so the
		// migration applies `CODEC(ZSTD(3))` to this column by hand. ClickHouse
		// reports the column type as plain String, so drift checks stay clean.
		{ name: "text", type: "String" },
		// Parser v6 facts (docs/l1-literal-schema.md, step 7), added by
		// 20261009150000_transcript_records_facts.sql. Literal values the record
		// carries; empty, NULL or an empty map means not recorded, and rows of
		// parser versions before a fact existed hold that default too, so readers
		// gate a fact on parser_version.
		{
			name: "agent_version",
			type: "LowCardinality(String)",
			comment:
				"Agent version that wrote the record: Claude Code version, Codex session_meta cli_version; empty when not recorded.",
		},
		{
			name: "entrypoint",
			type: "LowCardinality(String)",
			comment:
				"How the agent was started: Claude Code entrypoint, Codex originator; empty when not recorded.",
		},
		{
			name: "denial_kind",
			type: "LowCardinality(String)",
			comment:
				"Why a tool call did not run, as recorded (Claude Code toolDenialKind: permission-rule, user-rejected, cancelled, interrupted); empty otherwise.",
		},
		{
			name: "duration_ms",
			type: "UInt32",
			nullable: true,
			comment:
				"Recorded duration in milliseconds (tool result, Codex item or task, cost state); NULL when not recorded.",
		},
		{
			name: "timed_out_after_ms",
			type: "UInt32",
			nullable: true,
			comment:
				"Milliseconds after which the agent recorded a tool call as timed out; NULL when not recorded.",
		},
		{
			name: "interrupted",
			type: "Bool",
			nullable: true,
			comment:
				"Whether the tool result records the call as interrupted; NULL when not recorded.",
		},
		{
			name: "git_operation",
			type: "Array(LowCardinality(String))",
			comment:
				"Git operations the agent recorded for a tool result (Claude Code gitOperation keys: push, pr, branch, commit); empty when not recorded.",
		},
		{
			name: "mcp_server",
			type: "LowCardinality(String)",
			comment:
				"MCP server of a tool call as recorded (Claude Code attributionMcpServer, Codex McpToolCall server); empty otherwise.",
		},
		{
			name: "mcp_tool",
			type: "LowCardinality(String)",
			comment:
				"MCP tool of a tool call as recorded (Claude Code attributionMcpTool, Codex McpToolCall tool); empty otherwise.",
		},
		{
			name: "attribution_skill",
			type: "LowCardinality(String)",
			comment:
				"Skill the agent attributed the record to (Claude Code attributionSkill); empty when not recorded.",
		},
		// The migration applies CODEC(ZSTD(3)) to this column by hand, as for text.
		{
			name: "facts",
			type: "Map(LowCardinality(String), String)",
			comment:
				"Further literal facts of the record, keyed by the L1 spec column name from the parser fact registry; a missing key means not recorded.",
		},
	],
	primaryKey: [
		"organization_id",
		"user_id",
		"session_id",
		"revision",
		"parser_version",
		"agent_id",
		"record_idx",
		"block_idx",
	],
	orderBy: [
		"organization_id",
		"user_id",
		"session_id",
		"revision",
		"parser_version",
		"agent_id",
		"record_idx",
		"block_idx",
	],
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"Deterministic per-record transcript index for selective reads. Light columns answer structure questions; text is read only for explicit record drill-downs.",
});

export default schema(rudel_transcript_records);
