import { materializedView, schema, table } from "@chkit/core";

/**
 * L1 edges (docs/adr/0003-l1-evidence-entities-edges.md): one row per
 * relationship between runs, sessions, commits, pull requests and CI runs,
 * naming its relation, basis and witness evidence row. One reconciliation
 * worker writes them; rows are full replacements versioned by `revision`,
 * and `is_active = 0` retracts a relationship that no longer holds.
 */
export const L1_EDGES_KEY = [
	"organization_id",
	"from_kind",
	"from_id",
	"relation",
	"to_kind",
	"to_id",
	"evidence_id",
];
/** The same rows ordered by target, for the reverse direction. */
export const L1_EDGES_BY_TARGET_KEY = [
	"organization_id",
	"to_kind",
	"to_id",
	"relation",
	"from_kind",
	"from_id",
	"evidence_id",
];
export const L1_EDGE_RESOLUTIONS_KEY = [
	"organization_id",
	"user_id",
	"source",
	"session_id",
	"evidence_id",
	"target",
];

const SETTINGS = {
	index_granularity: "1024",
	index_granularity_bytes: "1048576",
	non_replicated_deduplication_window: "1000",
	storage_policy: "'s3'",
};

const EDGE_COLUMNS = [
	{
		name: "organization_id",
		type: "String",
		comment: "Owning workspace ID; tenant boundary.",
	},
	{
		name: "from_kind",
		type: "LowCardinality(String)",
		comment: "Source node kind: run, session, commit or pull_request.",
	},
	{
		name: "from_id",
		type: "String",
		comment:
			"Source node id, percent-encoded components joined by /: run user/source/session/agent/start record, session user/source/session/agent, commit repository/SHA, pull_request repository/number.",
	},
	{
		name: "relation",
		type: "LowCardinality(String)",
		comment:
			"Relationship the evidence states: commit_created, commit_pushed, commit_captured, sha_mentioned, pr_named, pr_branch_head, pr_listed, ci_named, ci_on_branch_window, commit_in_pr, ci_on_sha, ci_for_pr.",
	},
	{
		name: "to_kind",
		type: "LowCardinality(String)",
		comment: "Target node kind: commit, pull_request or ci_run.",
	},
	{
		name: "to_id",
		type: "String",
		comment:
			"Target node id: commit repository/SHA, pull_request repository/number, ci_run repository/kind/run id/attempt.",
	},
	{
		name: "evidence_id",
		type: "String",
		comment:
			"Stable id of the evidence row that witnesses the relationship (observation, capture, snapshot or GitHub row).",
	},
	{
		name: "basis",
		type: "LowCardinality(String)",
		comment:
			"Where the evidence came from: transcript, capture, hook or github.",
	},
	{
		name: "user_id",
		type: "String",
		comment: "Session owner for session evidence; empty for GitHub edges.",
	},
	{
		name: "source",
		type: "LowCardinality(String)",
		comment:
			"Transcript source (claude_code or codex) for session evidence; empty for GitHub edges.",
	},
	{
		name: "session_id",
		type: "String",
		comment: "Native session ID for session evidence; empty for GitHub edges.",
	},
	{
		name: "agent_id",
		type: "String",
		comment:
			"Transcript stream for session evidence; empty for the main stream.",
	},
	{
		name: "turn_idx",
		type: "UInt32",
		comment:
			"Run number within the stream when the source is a run; zero otherwise.",
	},
	{
		name: "repository_id",
		type: "String",
		comment:
			"GitHub repository ID the edge resolved in; reads keep only actively bound repositories.",
	},
	{
		name: "evidence_revision",
		type: "UInt64",
		comment:
			"Transcript revision of the evidence generation; zero for GitHub edges.",
	},
	{
		name: "evidence_parser_version",
		type: "UInt16",
		comment:
			"Git observation generation version of the evidence; zero for other bases.",
	},
	{
		name: "transcript_parser_version",
		type: "UInt16",
		comment:
			"Transcript records parser version of the evidence; zero for other bases.",
	},
	{
		name: "observed_at",
		type: "DateTime64(3, 'UTC')",
		comment:
			"UTC millisecond time of the evidence: observation, capture, snapshot or GitHub fact.",
	},
	{
		name: "matched_value",
		type: "String",
		comment:
			"Literal value the evidence matched on: abbreviated SHA, branch, PR number, run id or membership head.",
	},
	{
		name: "match_rule",
		type: "LowCardinality(String)",
		comment:
			"How the value matched: full_sha, unique_prefix, number, branch_head, run_id, branch_window, membership, merge_commit, head_sha, or the GitHub link basis.",
	},
	{
		name: "candidate_count",
		type: "UInt32",
		comment:
			"How many targets the value matched; an edge per target, so more than one is a branch or prefix shared by several.",
	},
	{
		name: "details",
		type: "String",
		comment:
			"Small JSON object of further literal values (check label, branch window, ceiling reached, whether the PR head still contains the commit).",
	},
	{
		name: "resolver_version",
		type: "UInt16",
		comment: "Version of the worker rules that wrote the row.",
	},
	{
		name: "revision",
		type: "UInt64",
		comment:
			"Replacing version: monotonic build revision of the worker, so a later build wins.",
	},
	{
		name: "is_active",
		type: "UInt8",
		comment: "1 while the relationship holds; 0 retracts it.",
	},
	{
		name: "written_at",
		type: "DateTime64(3, 'UTC')",
		comment: "UTC millisecond time the worker wrote the row.",
	},
];

export const l1EdgesTable = table({
	database: "rudel",
	name: "l1_edges",
	engine: "SharedReplacingMergeTree(revision)",
	columns: EDGE_COLUMNS,
	primaryKey: L1_EDGES_KEY,
	orderBy: L1_EDGES_KEY,
	settings: SETTINGS,
	comment:
		"L1 edges between runs, sessions, commits, pull requests and CI runs, ordered by source; written only by the reconciliation worker.",
});

export const l1EdgesByTargetTable = table({
	database: "rudel",
	name: "l1_edges_by_target",
	engine: "SharedReplacingMergeTree(revision)",
	columns: EDGE_COLUMNS,
	primaryKey: L1_EDGES_BY_TARGET_KEY,
	orderBy: L1_EDGES_BY_TARGET_KEY,
	settings: SETTINGS,
	comment:
		"Copy of l1_edges ordered by target, filled by l1_edges_by_target_mv; purged separately.",
});

export const l1EdgesByTargetView = materializedView({
	database: "rudel",
	name: "l1_edges_by_target_mv",
	to: { database: "rudel", name: "l1_edges_by_target" },
	as: "SELECT * FROM rudel.l1_edges",
});

export const l1EdgeResolutionsTable = table({
	database: "rudel",
	name: "l1_edge_resolutions",
	engine: "SharedReplacingMergeTree(revision)",
	columns: [
		{
			name: "organization_id",
			type: "String",
			comment: "Owning workspace ID; tenant boundary.",
		},
		{
			name: "user_id",
			type: "String",
			comment: "Session owner.",
		},
		{
			name: "source",
			type: "LowCardinality(String)",
			comment: "Transcript source: claude_code or codex.",
		},
		{
			name: "session_id",
			type: "String",
			comment: "Native session ID.",
		},
		{
			name: "evidence_id",
			type: "String",
			comment: "Stable id of the evidence row, as in l1_edges.",
		},
		{
			name: "target",
			type: "LowCardinality(String)",
			comment:
				"What was resolved from the evidence: repository, commit, pull_request (by number), branch_pull_request (by head branch) or ci_run.",
		},
		{
			name: "status",
			type: "LowCardinality(String)",
			comment:
				"linked, unbound (repository without an active binding), not_github, no_repository, ambiguous (several candidates), or not_found.",
		},
		{
			name: "candidate_count",
			type: "UInt32",
			comment: "How many collected targets matched.",
		},
		{
			name: "repository_id",
			type: "String",
			comment: "Resolved GitHub repository ID; empty when none.",
		},
		{
			name: "repository_basis",
			type: "LowCardinality(String)",
			comment:
				"Where the repository came from: event, session, capture, or empty when none.",
		},
		{
			name: "repository_value",
			type: "String",
			comment:
				"Literal remote, repository or owner/name value it resolved from.",
		},
		{
			name: "matched_value",
			type: "String",
			comment:
				"Literal value resolved: abbreviated SHA, branch, number or run id.",
		},
		{
			name: "evidence_revision",
			type: "UInt64",
			comment:
				"Transcript revision of the evidence generation; zero for captures.",
		},
		{
			name: "resolver_version",
			type: "UInt16",
			comment: "Version of the worker rules that wrote the row.",
		},
		{
			name: "revision",
			type: "UInt64",
			comment: "Replacing version: monotonic build revision of the worker.",
		},
		{
			name: "is_active",
			type: "UInt8",
			comment: "1 while current; 0 retracts it.",
		},
		{
			name: "written_at",
			type: "DateTime64(3, 'UTC')",
			comment: "UTC millisecond time the worker wrote the row.",
		},
	],
	primaryKey: L1_EDGE_RESOLUTIONS_KEY,
	orderBy: L1_EDGE_RESOLUTIONS_KEY,
	settings: SETTINGS,
	comment:
		"Per evidence row and target, whether the worker resolved it and why not; evidence without an edge keeps its reason here.",
});

export default schema(
	l1EdgesTable,
	l1EdgesByTargetTable,
	l1EdgesByTargetView,
	l1EdgeResolutionsTable,
);
