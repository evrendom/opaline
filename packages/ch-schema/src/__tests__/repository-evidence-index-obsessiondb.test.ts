import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	REPOSITORY_EVIDENCE_INDEX_MIGRATION,
	type RepositoryEvidenceIndexMigrationOptions,
	runRepositoryEvidenceIndexMigration,
} from "../../scripts/migrate-repository-evidence-index.js";
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

function createOptions(
	table: typeof productionMetadata.table,
	logs: string[],
): RepositoryEvidenceIndexMigrationOptions {
	const executor = {
		execute: async () => {
			throw new Error("an applied migration must not execute DDL");
		},
		query: async (sql: string) =>
			sql.includes("system.columns") ? productionMetadata.columns : [table],
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
				],
			}),
		} as unknown as RepositoryEvidenceIndexMigrationOptions["journalStore"],
		log: (message) => logs.push(message),
		migrationSql,
		targetDatabase: "rudel",
	};
}

describe("repository evidence index on ObsessionDB", () => {
	test("accepts production metadata that reports the engine as SharedMergeTree", async () => {
		const logs: string[] = [];

		await runRepositoryEvidenceIndexMigration(
			createOptions(productionMetadata.table, logs),
		);

		expect(productionMetadata.table.engine).toBe("SharedMergeTree");
		expect(logs).toEqual([
			`Already applied: ${REPOSITORY_EVIDENCE_INDEX_MIGRATION}`,
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
