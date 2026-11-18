import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	l1EdgeResolutionsTable,
	l1EdgesByTargetTable,
	l1EdgesTable,
} from "../src/db/schema/l1-edges.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

/** L1 edges, their reverse copy and resolutions (docs/adr/0003-l1-evidence-entities-edges.md). */
export const L1_EDGES_MIGRATION = "20261009120000_l1_edges.sql";
const TABLES = [l1EdgesTable, l1EdgesByTargetTable, l1EdgeResolutionsTable];
const VIEW = "l1_edges_by_target_mv";

export async function runL1EdgesMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
	/**
	 * ClickHouse Cloud applies DDL to replicas asynchronously, so a read right
	 * after CREATE can miss a table; the check retries this often.
	 */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === L1_EDGES_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("L1 edges migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, apply the idempotent statements again in case they did not land.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: L1_EDGES_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why the installed edge schema differs from the definitions, or null. */
async function schemaMismatch(schema: {
	executor: ClickHouseExecutor;
	targetDatabase: string;
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
}): Promise<string | null> {
	for (const definition of TABLES) {
		const columns = await schema.executor.query<{
			name: string;
			type: string;
			comment: string;
			default_kind: string;
		}>(`
			SELECT name, type, comment, default_kind FROM system.columns
			WHERE database = '${schema.targetDatabase}' AND table = '${definition.name}'
			ORDER BY position LIMIT 64 SETTINGS max_execution_time = 10`);
		const tables = await schema.executor.query<{
			engine_full: string;
			sorting_key: string;
			primary_key: string;
			partition_key: string;
			storage_policy: string;
			comment: string;
		}>(`
			SELECT engine_full, sorting_key, primary_key, partition_key, storage_policy, comment
			FROM system.tables
			WHERE database = '${schema.targetDatabase}' AND name = '${definition.name}'
			LIMIT 2 SETTINGS max_execution_time = 10`);
		const table = tables[0];
		const engine = table?.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
		const engineMatches =
			schema.expectedEngine === "ReplacingMergeTree"
				? engine === "ReplacingMergeTree(revision)"
				: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?revision\)$/u.test(
						engine,
					);
		if (
			columns.length !== definition.columns.length ||
			!columns.every((column, index) => {
				const expected = definition.columns[index];
				return (
					expected &&
					column.name === expected.name &&
					column.type === expected.type &&
					column.comment === expected.comment &&
					column.default_kind === ""
				);
			}) ||
			tables.length !== 1 ||
			!table ||
			!engineMatches ||
			table.sorting_key !== definition.orderBy.join(", ") ||
			table.primary_key !== table.sorting_key ||
			table.partition_key !== "" ||
			table.storage_policy !== schema.expectedStoragePolicy ||
			table.comment !== definition.comment ||
			![
				"index_granularity = 1024",
				"index_granularity_bytes = 1048576",
				"non_replicated_deduplication_window = 1000",
			].every((setting) => table.engine_full.includes(setting))
		)
			return `L1 edges schema mismatch on ${definition.name} (columns, COMMENTs, engine_full, key, settings)`;
	}
	const views = await schema.executor.query<{ as_select: string }>(`
		SELECT as_select FROM system.tables
		WHERE database = '${schema.targetDatabase}' AND name = '${VIEW}'
		LIMIT 2 SETTINGS max_execution_time = 10`);
	const sources = await schema.executor.query<{ feeds_view: number }>(`
		SELECT has(dependencies_table, '${VIEW}') AS feeds_view FROM system.tables
		WHERE database = '${schema.targetDatabase}' AND name = 'l1_edges'
		LIMIT 2 SETTINGS max_execution_time = 10`);
	if (
		views.length !== 1 ||
		!/FROM\s+\S*l1_edges\b/iu.test(views[0]?.as_select ?? "") ||
		Number(sources[0]?.feeds_view ?? 0) !== 1
	)
		return `L1 edges schema mismatch on ${VIEW}`;
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runL1EdgesMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", L1_EDGES_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: target.engine("ReplacingMergeTree"),
			expectedStoragePolicy: target.capabilities.storagePolicy,
		});
		console.log(`Applied/validated: ${L1_EDGES_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
