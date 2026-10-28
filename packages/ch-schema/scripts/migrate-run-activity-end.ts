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
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import { FINDING_RUNS_COLUMNS } from "../src/finding-runs.js";
import { RUN_INDEX_COLUMNS, RUN_REQUEST_COLUMNS } from "../src/run-index.js";
import { WEEKLY_TOTALS_MEASURES } from "../src/weekly-totals.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/**
 * Run index 7 ends a run, and each of its requests, at its last activity
 * record (docs/l1-literal-schema.md, `runs`): this says so in the columns'
 * comments. Comments only; no data is rewritten.
 */
export const RUN_ACTIVITY_END_MIGRATION = "20261028150000_run_activity_end.sql";

/**
 * Columns whose comment the migration rewrites, by table. The tables' first
 * runners create them with the original wording and leave these comments to
 * this runner, which verifies them.
 */
export const RUN_ACTIVITY_END_COLUMNS = {
	run_index: ["ended_at", "minutes", "active_minutes"],
	run_requests: ["ended_at"],
	weekly_totals: ["minutes", "active_minutes"],
	analysis_finding_runs: ["minutes", "active_minutes"],
} as const satisfies Record<string, readonly string[]>;

type Table = keyof typeof RUN_ACTIVITY_END_COLUMNS;

/** Each table's columns as defined: the comments to serve. */
const DEFINED: Record<Table, readonly { name: string; comment: string }[]> = {
	run_index: RUN_INDEX_COLUMNS,
	run_requests: RUN_REQUEST_COLUMNS,
	weekly_totals: WEEKLY_TOTALS_MEASURES,
	analysis_finding_runs: FINDING_RUNS_COLUMNS,
};

/** Whether `name` of `table` has its comment from this migration. */
export function commentIsRunActivityEnd(table: Table, name: string): boolean {
	return (RUN_ACTIVITY_END_COLUMNS[table] as readonly string[]).includes(name);
}

interface InstalledComment {
	host: string;
	table: string;
	name: string;
	comment: string;
}

/**
 * Applies the comments once and journals them only after every replica
 * serves them. Rewriting a comment is idempotent, so a migration interrupted
 * halfway is finished, not failed. Safe to run on every deploy: once
 * journaled it only verifies, and it fails if a comment changes back.
 */
export async function runRunActivityEndMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	/** The read-back reads every replica and retries this often while one lags. */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === RUN_ACTIVITY_END_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Run activity end migration checksum mismatch");
	const replicas = await countReplicas(
		options.executor,
		"the run activity end comments",
	);
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
		const mismatch = await commentsMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, finish what has not landed on this endpoint.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: RUN_ACTIVITY_END_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why any replica still serves another comment, or null once all agree. */
async function commentsMismatch(
	options: { executor: ClickHouseExecutor; targetDatabase: string },
	replicas: number,
): Promise<string | null> {
	const tables = Object.keys(RUN_ACTIVITY_END_COLUMNS) as Table[];
	const installed = await options.executor.query<InstalledComment>(`
		SELECT hostName() AS host, table, name, comment
		FROM ${replicas > 1 ? "clusterAllReplicas('default', system.columns)" : "system.columns"}
		WHERE database = '${options.targetDatabase}'
			AND table IN (${tables.map((table) => `'${table}'`).join(", ")})
			AND name IN ('ended_at', 'minutes', 'active_minutes')
		ORDER BY host, table, name LIMIT 32 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const hosts = new Set(installed.map((row) => row.host));
	if (hosts.size < Math.max(1, replicas))
		return `Run activity end comments visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const wrong = tables.flatMap((table) =>
			RUN_ACTIVITY_END_COLUMNS[table]
				.filter((name) => {
					const expected = DEFINED[table].find(
						(column) => column.name === name,
					)?.comment;
					const found = installed.find(
						(row) =>
							row.host === host && row.table === table && row.name === name,
					);
					return found?.comment !== expected;
				})
				.map((name) => `${table}.${name}`),
		);
		if (wrong.length > 0)
			return `Run activity end comments mismatch: ${wrong.join(", ")}${replicas > 1 ? ` on replica ${host}` : ""}`;
	}
	return null;
}

async function main(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	try {
		await runRunActivityEndMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					RUN_ACTIVITY_END_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${RUN_ACTIVITY_END_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
