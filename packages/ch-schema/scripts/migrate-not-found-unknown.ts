import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { runIndexTable } from "../src/db/schema/run-index.js";
import { weeklyTotalsTable } from "../src/db/schema/weekly-totals.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

/**
 * OPL-384 (docs/l1-literal-schema.md, "Scale" and "Weekly totals"):
 * `run_index.not_found` is unknown (NULL) where it cannot be recorded, every
 * run carries the session repository, and weekly totals sum `not_found` over
 * the runs that can record it.
 */
export const NOT_FOUND_UNKNOWN_MIGRATION =
	"20261012120000_not_found_unknown.sql";
const VIEW = "weekly_totals_mv";

interface Column {
	name: string;
	type: string;
	comment: string;
}
const definition = (table: unknown, name: string): Column => {
	const column = (table as { columns: Column[] }).columns.find(
		(candidate) => candidate.name === name,
	);
	if (!column) throw new Error(`Missing column definition: ${name}`);
	return column;
};
const sqlString = (value: string) =>
	`'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/** The columns the migration changes, as every replica must serve them. */
const COLUMNS = [
	["run_index", definition(runIndexTable, "not_found")],
	["run_index", definition(runIndexTable, "repository")],
	["weekly_totals", definition(weeklyTotalsTable, "not_found_known_runs")],
	["weekly_totals", definition(weeklyTotalsTable, "not_found")],
] as const;

/**
 * The run index columns this migration changes, for the run index runner,
 * whose read-back checks the current definitions: idempotent, and only a
 * metadata change once applied.
 */
export function runIndexNotFoundStatement(database: string): string {
	const notFound = definition(runIndexTable, "not_found");
	const repository = definition(runIndexTable, "repository");
	return `ALTER TABLE ${database}.run_index MODIFY COLUMN not_found ${notFound.type} COMMENT ${sqlString(notFound.comment)}, COMMENT COLUMN repository ${sqlString(repository.comment)}`;
}

/** The same for the weekly totals runner's read-back. */
export function weeklyTotalsNotFoundStatement(database: string): string {
	const known = definition(weeklyTotalsTable, "not_found_known_runs");
	const notFound = definition(weeklyTotalsTable, "not_found");
	return `ALTER TABLE ${database}.weekly_totals ADD COLUMN IF NOT EXISTS not_found_known_runs ${known.type} COMMENT ${sqlString(known.comment)} AFTER searches, MODIFY COLUMN not_found ${notFound.type} COMMENT ${sqlString(notFound.comment)}`;
}

export function notFoundUnknownVisible(
	rows: readonly {
		host: string;
		table: string;
		name: string;
		type: string;
		comment: string;
	}[],
	views: readonly { host: string; create_table_query: string }[],
	replicas: number,
): boolean {
	const hosts = new Set(rows.map((row) => row.host));
	return (
		Number.isSafeInteger(replicas) &&
		replicas > 0 &&
		hosts.size >= replicas &&
		[...hosts].every(
			(host) =>
				COLUMNS.every(([table, column]) =>
					rows.some(
						(row) =>
							row.host === host &&
							row.table === table &&
							row.name === column.name &&
							row.type === column.type &&
							row.comment === column.comment,
					),
				) &&
				views.some(
					(view) =>
						view.host === host &&
						view.create_table_query.includes(
							"REFRESH EVERY 1 DAY OFFSET 3 HOUR APPEND",
						) &&
						view.create_table_query.includes("AS not_found_known_runs"),
				),
		)
	);
}

/**
 * Applies the migration once and journals it only after every replica
 * serves the new column types and comments and the recreated view.
 */
export async function runNotFoundUnknownMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	const database = options.targetDatabase;
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(database))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === NOT_FOUND_UNKNOWN_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Not found migration checksum mismatch");
	if (applied.length === 0)
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	const replicas = await countReplicas(
		options.executor,
		"the not found columns and the weekly totals view",
	);
	const read = (table: string) =>
		replicas > 1 ? `clusterAllReplicas('default', ${table})` : table;
	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const rows = await options.executor.query<{
			host: string;
			table: string;
			name: string;
			type: string;
			comment: string;
		}>(
			`SELECT hostName() AS host, table, name, type, comment FROM ${read("system.columns")} WHERE database = '${database}' AND table IN ('run_index', 'weekly_totals') AND name IN (${COLUMNS.map(([, column]) => `'${column.name}'`).join(",")}) ORDER BY host, table, name LIMIT 16 BY host SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`,
		);
		const views = await options.executor.query<{
			host: string;
			create_table_query: string;
		}>(
			`SELECT hostName() AS host, create_table_query FROM ${read("system.tables")} WHERE database = '${database}' AND name = '${VIEW}' ORDER BY host LIMIT 1 BY host SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`,
		);
		if (notFoundUnknownVisible(rows, views, replicas)) break;
		if (attempt >= attempts)
			throw new Error(
				"Not found columns or the weekly totals view are not visible as defined on every replica",
			);
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: NOT_FOUND_UNKNOWN_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runNotFoundUnknownMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					NOT_FOUND_UNKNOWN_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${NOT_FOUND_UNKNOWN_MIGRATION}`);
	} finally {
		await target.close();
	}
}
if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
