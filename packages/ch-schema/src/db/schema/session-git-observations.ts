import { schema, table } from "@chkit/core";

export const SESSION_GIT_OBSERVATIONS_KEY = [
	"organization_id",
	"user_id",
	"source",
	"session_id",
	"revision",
	"parser_version",
	"agent_id",
	"record_idx",
	"block_idx",
	"call_id",
	"kind",
];

export const sessionGitObservationsTable = table({
	database: "rudel",
	name: "session_git_observations",
	engine: "SharedReplacingMergeTree",
	columns: [
		{
			name: "organization_id",
			type: "String",
			comment: "Owning organization ID; first tenant boundary.",
		},
		{
			name: "user_id",
			type: "String",
			comment: "Uploading account ID; second tenant boundary.",
		},
		{
			name: "source",
			type: "LowCardinality(String)",
			comment:
				"Transcript source: claude_code or codex; part of session identity.",
		},
		{
			name: "session_id",
			type: "String",
			comment: "Native session ID within organization, user and source.",
		},
		{
			name: "revision",
			type: "UInt64",
			comment:
				"Exact raw transcript revision used by this extraction generation.",
		},
		{
			name: "parser_version",
			type: "UInt16",
			comment:
				"Generation version: git extractor version times 256 plus transcript parser version; retries replace only the same generation.",
		},
		{
			name: "transcript_parser_version",
			type: "UInt16",
			comment:
				"Published transcript records parser version consumed by the extractor.",
		},
		{
			name: "agent_id",
			type: "String",
			comment: "Transcript stream agent ID; empty for the main stream.",
		},
		{
			name: "record_idx",
			type: "UInt32",
			comment:
				"One-based raw JSONL record index; 4294967295 is the completion receipt.",
		},
		{
			name: "block_idx",
			type: "UInt32",
			comment:
				"Source content block index times 65536 plus output match ordinal; zero for metadata and receipts.",
		},
		{
			name: "call_id",
			type: "String",
			comment:
				"Observed tool call ID, paired within the same agent stream; empty for metadata and receipts.",
		},
		{
			name: "kind",
			type: "LowCardinality(String)",
			comment:
				"commit_created, push_range, pr_url, mcp_pr_created, codex_session_meta, or internal receipt.",
		},
		{
			name: "short_sha",
			type: "String",
			comment:
				"Observed abbreviated commit SHA; never expanded or attributed here.",
		},
		{
			name: "branch",
			type: "String",
			comment:
				"Secret-filtered observed commit, push target or session metadata branch; capped at 512 characters.",
		},
		{
			name: "subject_sha256",
			type: "String",
			comment:
				"SHA256 of the observed commit subject; subject text is never stored.",
		},
		{
			name: "push_from_sha",
			type: "String",
			comment:
				"Observed abbreviated SHA before a push range; empty for other kinds.",
		},
		{
			name: "push_to_sha",
			type: "String",
			comment:
				"Observed abbreviated SHA after a push range; empty for other kinds.",
		},
		{
			name: "push_source_branch",
			type: "String",
			comment:
				"Secret-filtered observed push source branch; capped at 512 characters.",
		},
		{
			name: "pr_repo",
			type: "String",
			comment:
				"Secret-filtered GitHub owner/name from an observed pull request URL; capped at 512 characters.",
		},
		{
			name: "pr_number",
			type: "UInt32",
			comment: "Observed GitHub pull request number; zero when not applicable.",
		},
		{
			name: "commit_hash",
			type: "String",
			comment:
				"Observed full commit hash in Codex session metadata; not a resolved short SHA.",
		},
		{
			name: "repository_url",
			type: "String",
			comment:
				"Secret-filtered repository URL from Codex metadata; credentials removed and capped at 512 characters.",
		},
		{
			name: "ts",
			type: "DateTime64(3, 'UTC')",
			comment:
				"UTC millisecond timestamp of the evidence record, or receipt publication.",
		},
		{
			name: "label",
			type: "LowCardinality(String)",
			comment:
				"Evidence label observed; a receipt is an internal completion marker, not evidence.",
		},
		{
			name: "run_id",
			type: "String",
			comment:
				"CI run id a CI status read names (gh run view or watch <id>, MCP run_id); empty otherwise.",
		},
	],
	primaryKey: SESSION_GIT_OBSERVATIONS_KEY,
	orderBy: SESSION_GIT_OBSERVATIONS_KEY,
	settings: {
		index_granularity: "1024",
		index_granularity_bytes: "1048576",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"Deterministic observed git and GitHub PR evidence from published transcript records. Receipts commit bounded extraction generations; no resolver or attribution.",
});

export default schema(sessionGitObservationsTable);
