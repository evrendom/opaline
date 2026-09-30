export const REPOSITORY_EVIDENCE_INDEX_TABLE =
	"repository_session_evidence_index" as const;

const CLICKHOUSE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Builds portable DDL for an isolated database or the production schema.
 *
 * The database is deliberately required: callers must choose their target and
 * integration tests can create a unique database without rewriting SQL.
 */
export function buildRepositoryEvidenceIndexDdl(database: string): string {
	const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(REPOSITORY_EVIDENCE_INDEX_TABLE)}`;
	return `CREATE TABLE IF NOT EXISTS ${qualifiedTable}
(
	\`organization_id\` String,
	\`user_id\` String,
	\`repository_id\` String,
	\`repository_provider\` LowCardinality(String) DEFAULT '',
	\`repository_host\` LowCardinality(String) DEFAULT '',
	\`repository_owner\` String DEFAULT '',
	\`repository_name\` String DEFAULT '',
	\`worktree_id\` String,
	\`context_id\` UUID,
	\`capture_id\` String,
	\`parent_context_id\` Nullable(UUID),
	\`manifest_object_id\` String,
	\`session_source\` LowCardinality(String),
	\`session_id\` String,
	\`run_id\` String,
	\`segment_id\` String,
	\`agent_id\` String,
	\`parent_agent_id\` String DEFAULT '',
	\`capture_lifecycle\` Enum8('start' = 1, 'resume' = 2, 'checkpoint' = 3, 'end' = 4),
	\`capture_started_at\` DateTime64(3, 'UTC'),
	\`first_action_at\` Nullable(DateTime64(3, 'UTC')),
	\`first_action_basis\` Enum8('native-hook' = 1, 'transcript-watermark' = 2, 'unavailable' = 3),
	\`first_action_relationship\` Enum8('before-first-action' = 1, 'after-first-action' = 2, 'unknown' = 3),
	\`capture_status\` Enum8('collecting' = 1, 'complete' = 2, 'failed' = 3),
	\`capture_completed_at\` Nullable(DateTime64(3, 'UTC')),
	\`coverage_status\` Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3),
	\`coverage_areas\` Array(Tuple(LowCardinality(String), Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), String)),
	\`available_skills\` Array(String),
	\`skill_assessments\` Array(Tuple(String, Enum8('observed-used' = 1, 'no-observed-use' = 2, 'unknown' = 3), Enum8('none' = 0, 'session' = 1, 'run' = 2, 'agent' = 3), String, Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6))),
	\`context_facets\` Array(Tuple(Enum8('agents-instructions' = 1, 'claude-instructions' = 2, 'plans' = 3, 'hooks' = 4, 'mcp' = 5, 'package-context' = 6), String, Enum8('present' = 1, 'absent' = 2, 'unknown' = 3), Enum8('complete' = 1, 'denied' = 2, 'excluded' = 3, 'truncated' = 4, 'unavailable' = 5), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6), UInt32)),
	\`index_version\` UInt64,
	\`indexed_at\` DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(index_version)
PRIMARY KEY (organization_id, repository_id, worktree_id, session_source, session_id, run_id, segment_id, agent_id, context_id)
ORDER BY (organization_id, repository_id, worktree_id, session_source, session_id, run_id, segment_id, agent_id, context_id)
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 1000`;
}

function quoteIdentifier(identifier: string): string {
	if (!CLICKHOUSE_IDENTIFIER.test(identifier)) {
		throw new Error(
			`Unsafe ClickHouse identifier: ${JSON.stringify(identifier)}`,
		);
	}
	return `\`${identifier}\``;
}
