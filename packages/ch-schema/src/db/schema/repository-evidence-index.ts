import { schema, table } from "@chkit/core";
import {
	REPOSITORY_EVIDENCE_INDEX_TABLE,
	REPOSITORY_EVIDENCE_SETUP_COLUMNS,
} from "../../repository-evidence-index.js";

const rudel_repository_session_evidence_index = table({
	database: "rudel",
	name: REPOSITORY_EVIDENCE_INDEX_TABLE,
	engine: "SharedReplacingMergeTree(index_version)",
	columns: [
		{ name: "organization_id", type: "String" },
		{ name: "user_id", type: "String" },
		{ name: "repository_id", type: "String" },
		{
			name: "repository_provider",
			type: "LowCardinality(String)",
			default: "",
		},
		{
			name: "repository_host",
			type: "LowCardinality(String)",
			default: "",
		},
		{ name: "repository_owner", type: "String", default: "" },
		{ name: "repository_name", type: "String", default: "" },
		{ name: "worktree_id", type: "String" },
		{ name: "context_id", type: "UUID" },
		{ name: "capture_id", type: "String" },
		{ name: "parent_context_id", type: "UUID", nullable: true },
		{ name: "manifest_object_id", type: "String" },
		{ name: "session_source", type: "LowCardinality(String)" },
		{ name: "session_id", type: "String" },
		{ name: "run_id", type: "String" },
		{ name: "segment_id", type: "String" },
		{ name: "agent_id", type: "String" },
		{ name: "parent_agent_id", type: "String", default: "" },
		{
			name: "capture_lifecycle",
			type: "Enum8('start' = 1, 'resume' = 2, 'checkpoint' = 3, 'end' = 4)",
		},
		{ name: "capture_started_at", type: "DateTime64(3, 'UTC')" },
		{
			name: "first_action_at",
			type: "DateTime64(3, 'UTC')",
			nullable: true,
		},
		{
			name: "first_action_basis",
			type: "Enum8('native-hook' = 1, 'transcript-watermark' = 2, 'unavailable' = 3)",
		},
		{
			name: "first_action_relationship",
			type: "Enum8('before-first-action' = 1, 'after-first-action' = 2, 'unknown' = 3)",
		},
		{
			name: "capture_status",
			type: "Enum8('collecting' = 1, 'complete' = 2, 'failed' = 3)",
		},
		{
			name: "capture_completed_at",
			type: "DateTime64(3, 'UTC')",
			nullable: true,
		},
		{
			name: "coverage_status",
			type: "Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3)",
		},
		{
			name: "coverage_areas",
			type: "Array(Tuple(LowCardinality(String), Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), String))",
		},
		{ name: "available_skills", type: "Array(String)" },
		{
			name: "skill_assessments",
			type: "Array(Tuple(String, Enum8('observed-used' = 1, 'no-observed-use' = 2, 'unknown' = 3), Enum8('none' = 0, 'session' = 1, 'run' = 2, 'agent' = 3), String, Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6)))",
		},
		{
			name: "context_facets",
			type: "Array(Tuple(Enum8('agents-instructions' = 1, 'claude-instructions' = 2, 'plans' = 3, 'hooks' = 4, 'mcp' = 5, 'package-context' = 6), String, Enum8('present' = 1, 'absent' = 2, 'unknown' = 3), Enum8('complete' = 1, 'denied' = 2, 'excluded' = 3, 'truncated' = 4, 'unavailable' = 5), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6), UInt32))",
		},
		{ name: "index_version", type: "UInt64" },
		{ name: "indexed_at", type: "DateTime64(3, 'UTC')" },
		// The capture's setup, as the manifest records it (setup_snapshots
		// view): added by 20261016180000_evidence_setup_snapshot.sql, empty
		// for captures indexed before it.
		...REPOSITORY_EVIDENCE_SETUP_COLUMNS,
	],
	primaryKey: [
		"organization_id",
		"repository_id",
		"worktree_id",
		"session_source",
		"session_id",
		"run_id",
		"segment_id",
		"agent_id",
		"context_id",
	],
	orderBy: [
		"organization_id",
		"repository_id",
		"worktree_id",
		"session_source",
		"session_id",
		"run_id",
		"segment_id",
		"agent_id",
		"context_id",
	],
	settings: {
		index_granularity: "8192",
		non_replicated_deduplication_window: "1000",
		storage_policy: "'s3'",
	},
	comment:
		"Compact latest-state index for versioned repository/session evidence captures. Organization and repository filters lead the replacing identity; unknown coverage remains explicit.",
});

export default schema(rudel_repository_session_evidence_index);
