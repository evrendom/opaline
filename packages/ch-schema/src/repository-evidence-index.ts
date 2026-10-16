export const REPOSITORY_EVIDENCE_INDEX_TABLE =
	"repository_session_evidence_index" as const;

/** Adds the setup columns to the evidence index (`REPOSITORY_EVIDENCE_SETUP_COLUMNS`). */
export const REPOSITORY_EVIDENCE_SETUP_MIGRATION =
	"20261016180000_evidence_setup_snapshot.sql" as const;

export interface RepositoryEvidenceSetupColumn {
	readonly name: string;
	readonly type: string;
	readonly comment: string;
}

/**
 * The setup a capture recorded, copied from its manifest as the CLI wrote it
 * (CLI `local-context-source/types.ts`): nothing is classified or derived
 * here; the setup_snapshots SQL view names each item. Captures indexed before
 * these columns existed keep the empty defaults, which the view reads as "not
 * recorded", never as "no setup".
 */
export const REPOSITORY_EVIDENCE_SETUP_COLUMNS: readonly RepositoryEvidenceSetupColumn[] =
	[
		{
			name: "capture_reason",
			type: "LowCardinality(String)",
			comment:
				"manifest.captureReason: empty for a capture taken at the session's own time (its hooks); task-output-sweep for a later capture of an earlier session, whose setup is from the time of the sweep.",
		},
		{
			name: "context_roots",
			type: "Array(Tuple(String, LowCardinality(String), LowCardinality(String), LowCardinality(String), String))",
			comment:
				"manifest.roots: (id, origin repository/user/admin/system, scope, status, absolutePath) of each directory the capture read. Empty for captures indexed before setup columns existed.",
		},
		{
			name: "setup_files",
			type: "Array(Tuple(String, String, Array(LowCardinality(String)), LowCardinality(String), String, UInt32, DateTime64(3, 'UTC')))",
			comment:
				"manifest.entries that are agent setup: (rootId, path, categories, hash status and scope: sha256-source, sha256-stored, git-object or omitted, hash value, size, modifiedAt). Kept: files of every root but the saved tool outputs; in the repository only instruction, skill-definition, agent-config, mcp-config and hook-config files; never a skill's other files nor unclassified files of skill and plugin directories.",
		},
		{
			name: "setup_settings",
			type: "Array(Tuple(LowCardinality(String), LowCardinality(String), String, LowCardinality(String), String, String))",
			comment:
				"manifest.userConfiguration, one item per row: (agent claude_code/codex, settings layer scope, layer path, item kind hook/permission/mcp_server/plugin/setting, name, value). A hook's value is its JSON (matcher, type, command, timeoutSeconds, async), a permission's the rule under its list name, an MCP server's its sanitised JSON, a plugin's true/false/null, a setting's its JSON value.",
		},
		{
			name: "runtime_versions",
			type: "Array(Tuple(String, String))",
			comment:
				"manifest.runtime as (field, value): os.platform, os.release, os.arch, cli.runtime, cli.version, tools.node, tools.bun, tools.git, tools.python, agentHost.name, agentHost.version, agentHost.originator; a field the CLI did not find is left out.",
		},
	];

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
	\`indexed_at\` DateTime64(3, 'UTC'),
${REPOSITORY_EVIDENCE_SETUP_COLUMNS.map((column) => `\t\`${column.name}\` ${column.type} COMMENT ${sqlString(column.comment)}`).join(",\n")}
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

/**
 * The migration that adds the setup columns, for `database`: idempotent and a
 * metadata change only (`ADD COLUMN IF NOT EXISTS`, after the last column).
 */
export function buildRepositoryEvidenceSetupMigrationSql(
	database: string,
): string {
	const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(REPOSITORY_EVIDENCE_INDEX_TABLE)}`;
	return `ALTER TABLE ${qualifiedTable}\n${REPOSITORY_EVIDENCE_SETUP_COLUMNS.map(
		(column) =>
			`\tADD COLUMN IF NOT EXISTS ${quoteIdentifier(column.name)} ${column.type} COMMENT ${sqlString(column.comment)}`,
	).join(",\n")};\n`;
}

function sqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}
