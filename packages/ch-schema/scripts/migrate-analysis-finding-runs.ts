import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	FINDING_RUNS_COLUMNS,
	FINDING_RUNS_COMMENT,
	FINDING_RUNS_ORDER_BY,
} from "../src/finding-runs.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { commentIsRunActivityEnd } from "./migrate-run-activity-end.js";
import { openMigrationTarget } from "./migration-target.js";

/** Finding impact: each saved finding's cited runs (`src/finding-runs.ts`). */
export const ANALYSIS_FINDING_RUNS_MIGRATION =
	"20261012150000_analysis_finding_runs.sql";
const TABLE = "analysis_finding_runs";

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

/**
 * Creates `rudel.analysis_finding_runs` once and journals it only after the
 * endpoint serves the exact schema: columns, comments, engine, key, settings
 * and comment. ClickHouse Cloud applies DDL to replicas asynchronously, so
 * the read-back retries while a replica lags. The API writes the table when
 * an analysis is saved, so production applies this before the API deploys.
 */
export async function runAnalysisFindingRunsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === ANALYSIS_FINDING_RUNS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Analysis finding runs migration checksum mismatch");
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
		// Halfway, apply the idempotent statement again in case it did not land.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: ANALYSIS_FINDING_RUNS_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why the installed table differs from its definition, or null. */
async function schemaMismatch(schema: {
	executor: ClickHouseExecutor;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
}): Promise<string | null> {
	const database = schema.targetDatabase;
	const columns = await schema.executor.query<{
		name: string;
		type: string;
		comment: string;
		default_kind: string;
	}>(`
		SELECT name, type, comment, default_kind FROM system.columns
		WHERE database = '${database}' AND table = '${TABLE}'
		ORDER BY position LIMIT 256 SETTINGS max_execution_time = 10`);
	const wrong = FINDING_RUNS_COLUMNS.filter((expected, index) => {
		const column = columns[index];
		return (
			!column ||
			column.name !== expected.name ||
			column.type !== expected.type ||
			// Run index 7's wording, which its own runner verifies.
			(column.comment !== expected.comment &&
				!commentIsRunActivityEnd("analysis_finding_runs", expected.name)) ||
			column.default_kind !== ""
		);
	});
	if (wrong.length > 0 || columns.length !== FINDING_RUNS_COLUMNS.length)
		return `Analysis finding runs columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`;

	const [table] = await schema.executor.query<{
		engine_full: string;
		sorting_key: string;
		primary_key: string;
		partition_key: string;
		storage_policy: string;
		comment: string;
	}>(`
		SELECT engine_full, sorting_key, primary_key, partition_key,
			storage_policy, comment
		FROM system.tables
		WHERE database = '${database}' AND name = '${TABLE}'
		LIMIT 1 SETTINGS max_execution_time = 10`);
	if (!table) return "Analysis finding runs table is missing";
	const engine = table.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
	const engineMatches =
		schema.expectedEngine === "ReplacingMergeTree"
			? engine === "ReplacingMergeTree(visibility_revision)"
			: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?visibility_revision\)$/u.test(
					engine,
				);
	if (
		!engineMatches ||
		table.sorting_key !== FINDING_RUNS_ORDER_BY.join(", ") ||
		table.primary_key !== table.sorting_key ||
		table.partition_key !== "" ||
		table.storage_policy !== schema.expectedStoragePolicy ||
		table.comment !== FINDING_RUNS_COMMENT
	)
		return "Analysis finding runs table mismatch (engine, key, storage policy, comment)";
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runAnalysisFindingRunsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					ANALYSIS_FINDING_RUNS_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: target.engine("ReplacingMergeTree"),
			expectedStoragePolicy: target.capabilities.storagePolicy,
		});
		console.log(`Applied/validated: ${ANALYSIS_FINDING_RUNS_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
