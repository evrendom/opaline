import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	REPOSITORY_EVIDENCE_INDEX_MIGRATION,
	REPOSITORY_EVIDENCE_SETUP_MIGRATION,
	type RepositoryEvidenceIndexMigrationOptions,
	runRepositoryEvidenceIndexMigration,
} from "../../scripts/migrate-repository-evidence-index.js";
import { REPOSITORY_EVIDENCE_SETUP_COLUMNS } from "../repository-evidence-index.js";
import productionMetadata from "./fixtures/obsessiondb-repository-evidence-index.json" with {
	type: "json",
};

const migrationSql = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations",
		REPOSITORY_EVIDENCE_INDEX_MIGRATION,
	),
	"utf8",
);

const setupMigrationSql = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations",
		REPOSITORY_EVIDENCE_SETUP_MIGRATION,
	),
	"utf8",
);
/** The setup columns as system.columns reports them once added. */
const setupColumns = REPOSITORY_EVIDENCE_SETUP_COLUMNS.map((column) => ({
	name: column.name,
	type: column.type,
	default_kind: "",
	default_expression: "",
}));

function createOptions(
	table: typeof productionMetadata.table,
	logs: string[],
	setup: { journaled: boolean; executed?: string[] } = { journaled: false },
): RepositoryEvidenceIndexMigrationOptions {
	let added = setup.journaled;
	const executor = {
		execute: async (statement: string) => {
			if (
				!statement.startsWith(
					"ALTER TABLE `rudel`.`repository_session_evidence_index`",
				)
			)
				throw new Error("an applied migration must not execute DDL");
			setup.executed?.push(statement);
			added = true;
		},
		query: async (sql: string) =>
			sql.includes("system.columns")
				? [...productionMetadata.columns, ...(added ? setupColumns : [])]
				: [table],
	} as unknown as ClickHouseExecutor;
	return {
		executor,
		expectedEngine: "SharedReplacingMergeTree",
		expectedStoragePolicy: "s3",
		journalStore: {
			readJournal: async () => ({
				applied: [
					{
						appliedAt: "2026-09-30 17:08:39",
						checksum: checksumSQL(migrationSql),
						name: REPOSITORY_EVIDENCE_INDEX_MIGRATION,
					},
					...(setup.journaled
						? [
								{
									appliedAt: "2026-10-16 17:00:00",
									checksum: checksumSQL(setupMigrationSql),
									name: REPOSITORY_EVIDENCE_SETUP_MIGRATION,
								},
							]
						: []),
				],
			}),
			appendEntry: async (entry: { name: string }) => {
				logs.push(`journaled ${entry.name}`);
			},
		} as unknown as RepositoryEvidenceIndexMigrationOptions["journalStore"],
		log: (message) => logs.push(message),
		migrationSql,
		setupMigrationSql,
		readBack: { attempts: 1, delayMs: 0 },
		targetDatabase: "rudel",
	};
}

describe("repository evidence index on ObsessionDB", () => {
	test("accepts production metadata that reports the engine as SharedMergeTree", async () => {
		const logs: string[] = [];

		await runRepositoryEvidenceIndexMigration(
			createOptions(productionMetadata.table, logs, { journaled: true }),
		);

		expect(productionMetadata.table.engine).toBe("SharedMergeTree");
		expect(logs).toEqual([
			`Already applied: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`,
			`Already applied: ${REPOSITORY_EVIDENCE_SETUP_MIGRATION}`,
		]);
	});

	test("adds the setup columns to the production table once, then validates them", async () => {
		const logs: string[] = [];
		const executed: string[] = [];

		await runRepositoryEvidenceIndexMigration(
			createOptions(productionMetadata.table, logs, {
				journaled: false,
				executed,
			}),
		);

		expect(executed).toHaveLength(1);
		for (const column of REPOSITORY_EVIDENCE_SETUP_COLUMNS)
			expect(executed[0]).toContain(
				`ADD COLUMN IF NOT EXISTS \`${column.name}\` ${column.type}`,
			);
		expect(logs).toEqual([
			`Already applied: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`,
			`journaled ${REPOSITORY_EVIDENCE_SETUP_MIGRATION}`,
			`Applied: ${REPOSITORY_EVIDENCE_SETUP_MIGRATION}`,
		]);
	});

	test("still rejects a table whose engine_full is not the replacing engine", async () => {
		const table = {
			...productionMetadata.table,
			engine_full: productionMetadata.table.engine_full.replace(
				"SharedReplacingMergeTree(index_version)",
				"SharedMergeTree",
			),
		};

		await expect(
			runRepositoryEvidenceIndexMigration(createOptions(table, [])),
		).rejects.toThrow("Repository evidence index schema validation failed");
	});
});
