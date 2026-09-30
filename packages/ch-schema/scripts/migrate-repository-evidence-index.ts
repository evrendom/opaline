import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type ClickHouseExecutor,
	createClickHouseExecutor,
} from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	isLocalClickHouseEndpoint,
	resolveClickHouseUsername,
} from "../src/clickhouse-connection.js";
import { REPOSITORY_EVIDENCE_INDEX_TABLE } from "../src/repository-evidence-index.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export const REPOSITORY_EVIDENCE_INDEX_MIGRATION =
	"20260930120000_repository_evidence_index.sql";
const DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE = "rudel";

const REPOSITORY_EVIDENCE_INDEX_COMMENT =
	"Compact latest-state index for versioned repository/session evidence captures. Organization and repository filters lead the replacing identity; unknown coverage remains explicit.";
const REPOSITORY_EVIDENCE_INDEX_KEY =
	"organization_id, repository_id, worktree_id, session_source, session_id, run_id, segment_id, agent_id, context_id";
const CLICKHOUSE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const EXPECTED_COLUMNS: readonly RepositoryEvidenceIndexColumn[] = [
	column("organization_id", "String"),
	column("user_id", "String"),
	column("repository_id", "String"),
	column("repository_provider", "LowCardinality(String)", "DEFAULT", "''"),
	column("repository_host", "LowCardinality(String)", "DEFAULT", "''"),
	column("repository_owner", "String", "DEFAULT", "''"),
	column("repository_name", "String", "DEFAULT", "''"),
	column("worktree_id", "String"),
	column("context_id", "UUID"),
	column("capture_id", "String"),
	column("parent_context_id", "Nullable(UUID)"),
	column("manifest_object_id", "String"),
	column("session_source", "LowCardinality(String)"),
	column("session_id", "String"),
	column("run_id", "String"),
	column("segment_id", "String"),
	column("agent_id", "String"),
	column("parent_agent_id", "String", "DEFAULT", "''"),
	column(
		"capture_lifecycle",
		"Enum8('start' = 1, 'resume' = 2, 'checkpoint' = 3, 'end' = 4)",
	),
	column("capture_started_at", "DateTime64(3, 'UTC')"),
	column("first_action_at", "Nullable(DateTime64(3, 'UTC'))"),
	column(
		"first_action_basis",
		"Enum8('native-hook' = 1, 'transcript-watermark' = 2, 'unavailable' = 3)",
	),
	column(
		"first_action_relationship",
		"Enum8('before-first-action' = 1, 'after-first-action' = 2, 'unknown' = 3)",
	),
	column(
		"capture_status",
		"Enum8('collecting' = 1, 'complete' = 2, 'failed' = 3)",
	),
	column("capture_completed_at", "Nullable(DateTime64(3, 'UTC'))"),
	column(
		"coverage_status",
		"Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3)",
	),
	column(
		"coverage_areas",
		"Array(Tuple(LowCardinality(String), Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), String))",
	),
	column("available_skills", "Array(String)"),
	column(
		"skill_assessments",
		"Array(Tuple(String, Enum8('observed-used' = 1, 'no-observed-use' = 2, 'unknown' = 3), Enum8('none' = 0, 'session' = 1, 'run' = 2, 'agent' = 3), String, Enum8('complete' = 1, 'partial' = 2, 'unavailable' = 3), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6)))",
	),
	column(
		"context_facets",
		"Array(Tuple(Enum8('agents-instructions' = 1, 'claude-instructions' = 2, 'plans' = 3, 'hooks' = 4, 'mcp' = 5, 'package-context' = 6), String, Enum8('present' = 1, 'absent' = 2, 'unknown' = 3), Enum8('complete' = 1, 'denied' = 2, 'excluded' = 3, 'truncated' = 4, 'unavailable' = 5), Enum8('readable' = 1, 'reference-only' = 2, 'denied' = 3, 'truncated' = 4, 'unavailable' = 5, 'unknown' = 6), UInt32))",
	),
	column("index_version", "UInt64"),
	column("indexed_at", "DateTime64(3, 'UTC')"),
];

interface RepositoryEvidenceIndexColumn {
	default_expression: string;
	default_kind: string;
	name: string;
	type: string;
}

interface RepositoryEvidenceIndexTable {
	comment: string;
	engine: string;
	engine_full: string;
	partition_key: string;
	primary_key: string;
	sorting_key: string;
	storage_policy: string;
}

export interface RepositoryEvidenceIndexMigrationOptions {
	executor: ClickHouseExecutor;
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
	journalStore: MigrationJournalStore;
	log: (message: string) => void;
	migrationSql: string;
	targetDatabase: string;
}

interface RepositoryEvidenceIndexRuntimeEnv {
	[name: string]: string | undefined;
	CLICKHOUSE_URL?: string | undefined;
	REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE?: string | undefined;
	REPOSITORY_EVIDENCE_INDEX_EXPECTED_STORAGE_POLICY?: string | undefined;
	REPOSITORY_EVIDENCE_INDEX_TARGET_DATABASE?: string | undefined;
}

export interface RepositoryEvidenceIndexRuntimeConfig {
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
	targetDatabase: string;
}

export function resolveRepositoryEvidenceIndexRuntimeConfig(
	env: RepositoryEvidenceIndexRuntimeEnv,
): RepositoryEvidenceIndexRuntimeConfig {
	const expectedEngine =
		env.REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE ?? "SharedReplacingMergeTree";
	if (
		expectedEngine !== "ReplacingMergeTree" &&
		expectedEngine !== "SharedReplacingMergeTree"
	) {
		throw new Error(
			`Unsupported repository evidence index engine: ${JSON.stringify(expectedEngine)}`,
		);
	}
	const expectedStoragePolicy =
		env.REPOSITORY_EVIDENCE_INDEX_EXPECTED_STORAGE_POLICY ?? "s3";
	assertClickHouseIdentifier(expectedStoragePolicy);
	const targetDatabase =
		env.REPOSITORY_EVIDENCE_INDEX_TARGET_DATABASE ??
		DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE;
	assertClickHouseIdentifier(targetDatabase);
	const usesNonProductionOverride =
		expectedEngine !== "SharedReplacingMergeTree" ||
		expectedStoragePolicy !== "s3" ||
		targetDatabase !== DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE;
	if (
		usesNonProductionOverride &&
		!isLocalClickHouseEndpoint(env.CLICKHOUSE_URL)
	) {
		throw new Error(
			"Repository evidence index runtime overrides are only allowed for a local ClickHouse endpoint",
		);
	}
	return { expectedEngine, expectedStoragePolicy, targetDatabase };
}

export function retargetRepositoryEvidenceIndexMigration(
	migrationSql: string,
	targetDatabase: string,
	expectedStoragePolicy = "s3",
): string {
	assertClickHouseIdentifier(targetDatabase);
	assertClickHouseIdentifier(expectedStoragePolicy);
	if (
		targetDatabase === DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE &&
		expectedStoragePolicy === "s3"
	) {
		return migrationSql;
	}
	const databaseStatement = `CREATE DATABASE IF NOT EXISTS ${DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE};`;
	const tableName = `${DEFAULT_REPOSITORY_EVIDENCE_INDEX_DATABASE}.${REPOSITORY_EVIDENCE_INDEX_TABLE}`;
	const storagePolicySetting = "storage_policy = 's3'";
	if (
		!migrationSql.includes(databaseStatement) ||
		!migrationSql.includes(tableName) ||
		!migrationSql.includes(storagePolicySetting)
	) {
		throw new Error(
			"Repository evidence index migration does not contain the expected database-qualified statements",
		);
	}
	return migrationSql
		.replace(
			databaseStatement,
			`CREATE DATABASE IF NOT EXISTS \`${targetDatabase}\`;`,
		)
		.replaceAll(
			tableName,
			`\`${targetDatabase}\`.${REPOSITORY_EVIDENCE_INDEX_TABLE}`,
		)
		.replace(
			storagePolicySetting,
			`storage_policy = '${expectedStoragePolicy}'`,
		);
}

function column(
	name: string,
	type: string,
	defaultKind = "",
	defaultExpression = "",
): RepositoryEvidenceIndexColumn {
	return {
		name,
		type,
		default_kind: defaultKind,
		default_expression: defaultExpression,
	};
}

export async function runRepositoryEvidenceIndexMigration(
	options: RepositoryEvidenceIndexMigrationOptions,
): Promise<void> {
	assertClickHouseIdentifier(options.targetDatabase);
	const checksum = checksumSQL(options.migrationSql);
	const matchingEntries = (
		await options.journalStore.readJournal()
	).applied.filter(
		(entry) => entry.name === REPOSITORY_EVIDENCE_INDEX_MIGRATION,
	);
	if (matchingEntries.some((entry) => entry.checksum !== checksum)) {
		throw new Error(
			`Repository evidence index migration checksum mismatch: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`,
		);
	}
	const applied = matchingEntries.length > 0;
	if (!applied) {
		for (const statement of extractExecutableStatements(options.migrationSql)) {
			await options.executor.execute(statement);
		}
	}

	await assertRepositoryEvidenceIndexSchema(options);
	if (!applied) {
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: REPOSITORY_EVIDENCE_INDEX_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
	}
	options.log(
		`${applied ? "Already applied" : "Applied"}: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`,
	);
}

async function assertRepositoryEvidenceIndexSchema(
	options: RepositoryEvidenceIndexMigrationOptions,
): Promise<void> {
	const columns = await options.executor.query<RepositoryEvidenceIndexColumn>(`
		SELECT name, type, default_kind, default_expression
		FROM system.columns
		WHERE database = '${options.targetDatabase}'
			AND table = '${REPOSITORY_EVIDENCE_INDEX_TABLE}'
		ORDER BY position
		LIMIT ${EXPECTED_COLUMNS.length + 1}
		SETTINGS max_execution_time = 10
	`);
	const tables = await options.executor.query<RepositoryEvidenceIndexTable>(`
		SELECT engine, engine_full, sorting_key, primary_key, partition_key, storage_policy, comment
		FROM system.tables
		WHERE database = '${options.targetDatabase}'
			AND name = '${REPOSITORY_EVIDENCE_INDEX_TABLE}'
		LIMIT 2
		SETTINGS max_execution_time = 10
	`);
	const table = tables[0];
	const columnsMatch =
		columns.length === EXPECTED_COLUMNS.length &&
		columns.every((observed, index) => {
			const expected = EXPECTED_COLUMNS[index];
			return (
				expected !== undefined &&
				observed.name === expected.name &&
				observed.type === expected.type &&
				observed.default_kind === expected.default_kind &&
				observed.default_expression === expected.default_expression
			);
		});
	const tableMatches =
		tables.length === 1 &&
		table !== undefined &&
		// ObsessionDB reports `engine` as SharedMergeTree for every replicated
		// table; the replacing engine and its version are validated from engine_full.
		hasExpectedReplacingVersion(table.engine_full, options.expectedEngine) &&
		table.sorting_key === REPOSITORY_EVIDENCE_INDEX_KEY &&
		table.primary_key === REPOSITORY_EVIDENCE_INDEX_KEY &&
		table.partition_key === "" &&
		table.storage_policy === options.expectedStoragePolicy &&
		table.comment === REPOSITORY_EVIDENCE_INDEX_COMMENT;
	if (!columnsMatch || !tableMatches) {
		throw new Error(
			`Repository evidence index schema validation failed: expected ${JSON.stringify({ columns: EXPECTED_COLUMNS, table: { comment: REPOSITORY_EVIDENCE_INDEX_COMMENT, engine: options.expectedEngine, engine_full: `${options.expectedEngine}(..., index_version)`, partition_key: "", primary_key: REPOSITORY_EVIDENCE_INDEX_KEY, sorting_key: REPOSITORY_EVIDENCE_INDEX_KEY, storage_policy: options.expectedStoragePolicy } })}; observed ${JSON.stringify({ columns, tables })}. Do not deploy the API until schema drift is resolved.`,
		);
	}
}

function hasExpectedReplacingVersion(
	engineFull: string,
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree",
): boolean {
	const engineClause = engineFull.split(" PRIMARY KEY ", 1)[0] ?? "";
	if (expectedEngine === "ReplacingMergeTree") {
		return engineClause === "ReplacingMergeTree(index_version)";
	}
	return (
		engineClause === "SharedReplacingMergeTree(index_version)" ||
		(engineClause.startsWith("SharedReplacingMergeTree(") &&
			engineClause.endsWith(", index_version)"))
	);
}

function assertClickHouseIdentifier(identifier: string): void {
	if (!CLICKHOUSE_IDENTIFIER.test(identifier)) {
		throw new Error(
			`Unsafe ClickHouse identifier: ${JSON.stringify(identifier)}`,
		);
	}
}

async function run(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const runtimeConfig = resolveRepositoryEvidenceIndexRuntimeConfig(
		process.env,
	);
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: process.env.CLICKHOUSE_DB ?? "default",
	});
	try {
		const canonicalMigrationSql = await readFile(
			resolve(
				import.meta.dir,
				"../chx/migrations",
				REPOSITORY_EVIDENCE_INDEX_MIGRATION,
			),
			"utf8",
		);
		const migrationSql = retargetRepositoryEvidenceIndexMigration(
			canonicalMigrationSql,
			runtimeConfig.targetDatabase,
			runtimeConfig.expectedStoragePolicy,
		);
		await runRepositoryEvidenceIndexMigration({
			executor,
			expectedEngine: runtimeConfig.expectedEngine,
			expectedStoragePolicy: runtimeConfig.expectedStoragePolicy,
			journalStore: createJournalStore(executor),
			log: console.log,
			migrationSql,
			targetDatabase: runtimeConfig.targetDatabase,
		});
	} finally {
		await executor.close();
	}
}

if (import.meta.main) {
	run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
