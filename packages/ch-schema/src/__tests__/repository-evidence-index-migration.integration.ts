import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { createJournalStore } from "chkit/dist/bin/lib.js";
import {
	REPOSITORY_EVIDENCE_INDEX_MIGRATION,
	REPOSITORY_EVIDENCE_SETUP_MIGRATION,
	resolveRepositoryEvidenceIndexRuntimeConfig,
	retargetRepositoryEvidenceIndexMigration,
	runRepositoryEvidenceIndexMigration,
} from "../../scripts/migrate-repository-evidence-index.js";
import {
	buildRepositoryEvidenceIndexDdl,
	REPOSITORY_EVIDENCE_SETUP_COLUMNS,
} from "../repository-evidence-index.js";

setDefaultTimeout(120_000);

const connection = {
	url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
	username:
		process.env.CLICKHOUSE_USERNAME ?? process.env.CLICKHOUSE_USER ?? "default",
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
};
const rootExecutor = createClickHouseExecutor({
	...connection,
	database: process.env.CLICKHOUSE_DB ?? "default",
});
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const freshDatabase = `opaline_repository_migration_fresh_${suffix}`;
const mismatchDatabase = `opaline_repository_migration_mismatch_${suffix}`;
const entrypointDatabase = `opaline_repository_migration_entrypoint_${suffix}`;
const databaseNames = [
	freshDatabase,
	mismatchDatabase,
	entrypointDatabase,
] as const;
const tableComment =
	"Compact latest-state index for versioned repository/session evidence captures. Organization and repository filters lead the replacing identity; unknown coverage remains explicit.";

afterAll(async () => {
	for (const database of databaseNames) {
		await rootExecutor
			.execute(`DROP DATABASE IF EXISTS \`${database}\``)
			.catch(() => {});
	}
	await rootExecutor.close();
});

describe("controlled repository evidence index migration", () => {
	test("keeps production validation strict and rejects unsafe engine overrides", () => {
		const canonicalSql =
			"CREATE DATABASE IF NOT EXISTS rudel; CREATE TABLE IF NOT EXISTS rudel.repository_session_evidence_index (index_version UInt64) ENGINE = ReplacingMergeTree(index_version) SETTINGS storage_policy = 's3';";
		expect(
			resolveRepositoryEvidenceIndexRuntimeConfig({
				CLICKHOUSE_URL: "https://clickhouse.example.com",
			}),
		).toEqual({
			expectedEngine: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
			targetDatabase: "rudel",
		});
		expect(() =>
			resolveRepositoryEvidenceIndexRuntimeConfig({
				CLICKHOUSE_URL: "http://127.0.0.1:58123",
				REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE: "MergeTree",
			}),
		).toThrow("Unsupported repository evidence index engine");
		expect(() =>
			resolveRepositoryEvidenceIndexRuntimeConfig({
				CLICKHOUSE_URL: "https://clickhouse.example.com",
				REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE: "ReplacingMergeTree",
			}),
		).toThrow("only allowed for a local ClickHouse endpoint");
		expect(
			retargetRepositoryEvidenceIndexMigration(canonicalSql, "rudel", "s3"),
		).toBe(canonicalSql);
	});

	test("runs the CI engine expectation through the script entry point", async () => {
		await rootExecutor.execute(`CREATE DATABASE \`${entrypointDatabase}\``);
		const processResult = Bun.spawn({
			cmd: [
				process.execPath,
				resolve(
					import.meta.dir,
					"../../scripts/migrate-repository-evidence-index.ts",
				),
			],
			env: {
				...process.env,
				CLICKHOUSE_DB: entrypointDatabase,
				REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE: "ReplacingMergeTree",
				REPOSITORY_EVIDENCE_INDEX_EXPECTED_STORAGE_POLICY: "default",
				REPOSITORY_EVIDENCE_INDEX_TARGET_DATABASE: entrypointDatabase,
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		const [exitCode, stderr, stdout] = await Promise.all([
			processResult.exited,
			new Response(processResult.stderr).text(),
			new Response(processResult.stdout).text(),
		]);
		expect(exitCode).toBe(0);
		expect(stderr).not.toContain(
			"Repository evidence index schema validation failed",
		);
		expect(stdout).toContain(`Applied: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`);

		const executor = createClickHouseExecutor({
			...connection,
			database: entrypointDatabase,
		});
		const [table] = await executor.query<{ engine: string }>(`
			SELECT engine
			FROM system.tables
			WHERE database = '${entrypointDatabase}'
				AND name = 'repository_session_evidence_index'
		`);
		expect(table?.engine).toBe("ReplacingMergeTree");
		const appliedEntries = (
			await createJournalStore(executor).readJournal()
		).applied.filter(
			(entry) => entry.name === REPOSITORY_EVIDENCE_INDEX_MIGRATION,
		);
		expect(appliedEntries).toHaveLength(1);
		// The setup columns come after the create migration, journaled on their own.
		expect(stdout).toContain(`Applied: ${REPOSITORY_EVIDENCE_SETUP_MIGRATION}`);
		const setupColumns = await executor.query<{ name: string; type: string }>(`
			SELECT name, type FROM system.columns
			WHERE database = '${entrypointDatabase}'
				AND table = 'repository_session_evidence_index'
				AND name IN (${REPOSITORY_EVIDENCE_SETUP_COLUMNS.map((column) => `'${column.name}'`).join(", ")})
			ORDER BY position
		`);
		expect(setupColumns).toEqual(
			REPOSITORY_EVIDENCE_SETUP_COLUMNS.map(({ name, type }) => ({
				name,
				type,
			})),
		);
		const setupEntries = (
			await createJournalStore(executor).readJournal()
		).applied.filter(
			(entry) => entry.name === REPOSITORY_EVIDENCE_SETUP_MIGRATION,
		);
		expect(setupEntries).toHaveLength(1);
		await executor.close();
	});

	test("applies a fresh schema once and verifies it again on rerun", async () => {
		await rootExecutor.execute(`CREATE DATABASE \`${freshDatabase}\``);
		const executor = createClickHouseExecutor({
			...connection,
			database: freshDatabase,
		});
		const journalStore = createJournalStore(executor);
		const migrationSql = buildMigrationSql(freshDatabase);

		await runRepositoryEvidenceIndexMigration({
			executor,
			expectedEngine: "ReplacingMergeTree",
			expectedStoragePolicy: "default",
			journalStore,
			log: () => {},
			migrationSql,
			targetDatabase: freshDatabase,
		});
		await runRepositoryEvidenceIndexMigration({
			executor,
			expectedEngine: "ReplacingMergeTree",
			expectedStoragePolicy: "default",
			journalStore,
			log: () => {},
			migrationSql,
			targetDatabase: freshDatabase,
		});

		const appliedEntries = (await journalStore.readJournal()).applied.filter(
			(entry) => entry.name === REPOSITORY_EVIDENCE_INDEX_MIGRATION,
		);
		expect(appliedEntries).toHaveLength(1);
		await executor.close();
	});

	test("rejects the wrong replacement version without journaling success", async () => {
		await rootExecutor.execute(`CREATE DATABASE \`${mismatchDatabase}\``);
		const executor = createClickHouseExecutor({
			...connection,
			database: mismatchDatabase,
		});
		await executor.execute(
			`${buildRepositoryEvidenceIndexDdl(mismatchDatabase).replace(
				"ReplacingMergeTree(index_version)",
				"ReplacingMergeTree(indexed_at)",
			)}\nCOMMENT '${tableComment}'`,
		);
		const journalStore = createJournalStore(executor);

		await expect(
			runRepositoryEvidenceIndexMigration({
				executor,
				expectedEngine: "ReplacingMergeTree",
				expectedStoragePolicy: "default",
				journalStore,
				log: () => {},
				migrationSql: buildMigrationSql(mismatchDatabase),
				targetDatabase: mismatchDatabase,
			}),
		).rejects.toThrow("Repository evidence index schema validation failed");
		const appliedEntries = (await journalStore.readJournal()).applied.filter(
			(entry) => entry.name === REPOSITORY_EVIDENCE_INDEX_MIGRATION,
		);
		expect(appliedEntries).toEqual([]);
		await executor.close();
	});
});

function buildMigrationSql(database: string): string {
	return `CREATE DATABASE IF NOT EXISTS \`${database}\`;
${buildRepositoryEvidenceIndexDdl(database)}
COMMENT '${tableComment}';`;
}
