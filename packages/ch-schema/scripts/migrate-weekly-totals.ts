import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { weeklyTotalsTable } from "../src/db/schema/weekly-totals.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { weeklyTotalsNotFoundStatement } from "./migrate-not-found-unknown.js";
import { commentIsRunActivityEnd } from "./migrate-run-activity-end.js";
import { openMigrationTarget } from "./migration-target.js";

/** Weekly totals and the refreshable view that appends them (docs/l1-literal-schema.md, "Weekly totals"). */
export const WEEKLY_TOTALS_MIGRATION = "20261011150000_weekly_totals.sql";
const TABLE = weeklyTotalsTable as unknown as {
	name: string;
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	partitionBy: string;
	comment: string;
};
const VIEW = "weekly_totals_mv";
/** The schedule and mode the view must have; a replace refresh is unsafe on uncoordinated replicas. */
export const WEEKLY_TOTALS_REFRESH = "REFRESH EVERY 1 DAY OFFSET 3 HOUR APPEND";

type Engine = "MergeTree" | "SharedMergeTree";

/**
 * Creates `rudel.weekly_totals` and its refreshable view `weekly_totals_mv`
 * once, and journals them only after the endpoint serves the exact schema:
 * the table's columns, comments, engine, key, partition, TTL and settings,
 * and the view's schedule, APPEND mode, target and source. chkit cannot
 * express REFRESH, so this runner replaces `chkit migrate` for the file.
 * Creating the view starts its first refresh at once, which only reads the
 * run index and appends a snapshot.
 */
export async function runWeeklyTotalsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
	/**
	 * ClickHouse Cloud applies DDL to replicas asynchronously, so a read right
	 * after CREATE can miss the table or view; the check retries this often.
	 */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === WEEKLY_TOTALS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Weekly totals migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();
	// The not-found migration's column changes (OPL-384), which the read-back
	// below checks; that migration recreates the view.
	await options.executor.execute(
		weeklyTotalsNotFoundStatement(options.targetDatabase),
	);

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
			name: WEEKLY_TOTALS_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why the installed table or view differs from the definitions, or null. */
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
		WHERE database = '${database}' AND table = '${TABLE.name}'
		ORDER BY position LIMIT 256 SETTINGS max_execution_time = 10`);
	const wrong = TABLE.columns.filter((expected, index) => {
		const column = columns[index];
		return (
			!column ||
			column.name !== expected.name ||
			column.type !== expected.type ||
			// Run index 7's wording, which its own runner verifies.
			(column.comment !== expected.comment &&
				!commentIsRunActivityEnd("weekly_totals", expected.name)) ||
			column.default_kind !== ""
		);
	});
	if (wrong.length > 0 || columns.length !== TABLE.columns.length)
		return `Weekly totals columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`;

	const tables = await schema.executor.query<{
		name: string;
		engine: string;
		engine_full: string;
		sorting_key: string;
		primary_key: string;
		partition_key: string;
		storage_policy: string;
		comment: string;
		create_table_query: string;
	}>(`
		SELECT name, engine, engine_full, sorting_key, primary_key, partition_key,
			storage_policy, comment, create_table_query
		FROM system.tables
		WHERE database = '${database}' AND name IN ('${TABLE.name}', '${VIEW}')
		ORDER BY name LIMIT 4 SETTINGS max_execution_time = 10`);
	const table = tables.find((row) => row.name === TABLE.name);
	if (!table) return "Weekly totals table is missing";
	const engine =
		table.engine_full.split(/ (?:PARTITION BY|PRIMARY KEY|ORDER BY) /u, 1)[0] ??
		"";
	const engineMatches =
		schema.expectedEngine === "MergeTree"
			? engine === "MergeTree"
			: /^SharedMergeTree(?:\('[^']*',\s*'[^']*'\))?$/u.test(engine);
	if (
		!engineMatches ||
		table.sorting_key !== TABLE.orderBy.join(", ") ||
		table.primary_key !== table.sorting_key ||
		table.partition_key !== TABLE.partitionBy ||
		table.storage_policy !== schema.expectedStoragePolicy ||
		table.comment !== TABLE.comment ||
		!table.engine_full.includes(
			"TTL toDateTime(refreshed_at) + toIntervalDay(14)",
		) ||
		!table.engine_full.includes("ttl_only_drop_parts = 1")
	)
		return "Weekly totals table mismatch (engine_full, key, partition, TTL, settings, comment)";

	const view = tables.find((row) => row.name === VIEW);
	const query = view?.create_table_query ?? "";
	if (
		view?.engine !== "MaterializedView" ||
		!query.includes(WEEKLY_TOTALS_REFRESH) ||
		!query.includes(` TO ${database}.${TABLE.name} `) ||
		!/FROM\s+\S*run_index\s+AS\s+r\s+FINAL/iu.test(query)
	)
		return `Weekly totals view mismatch on ${VIEW} (schedule, APPEND, target or source)`;
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runWeeklyTotalsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", WEEKLY_TOTALS_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: target.engine("MergeTree"),
			expectedStoragePolicy: target.capabilities.storagePolicy,
		});
		console.log(`Applied/validated: ${WEEKLY_TOTALS_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
