import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	RUN_INDEX_TEXT_COLUMNS,
	runIndexTable,
} from "../src/db/schema/run-index.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { columnDeclaration } from "./migrate-run-index.js";
import { openMigrationTarget } from "./migration-target.js";

/**
 * Raw transcripts, `transcript_records`, `run_index` and `session_lineage` are kept until a
 * deletion request (docs/l1-retention.md): this removes the table TTLs and the
 * run index's free-text column TTLs that earlier migrations installed.
 */
export const L1_RETENTION_MIGRATION = "20261011120000_l1_retention_removed.sql";

/** Tables that held a table TTL (raw transcripts, records, run index, lineage). */
export const L1_RETENTION_TABLES = [
	"claude_sessions",
	"codex_sessions",
	"transcript_records",
	"run_index",
	"session_lineage",
] as const;

/** Run index columns whose comment the migration rewrites (no retention wording). */
export const RUN_INDEX_RETENTION_COMMENT_COLUMNS: readonly string[] = [
	"session_date",
	...RUN_INDEX_TEXT_COLUMNS,
];

const RUN_INDEX = runIndexTable as unknown as {
	columns: { name: string; comment: string }[];
};

interface InstalledTable {
	host: string;
	name: string;
	engine_full: string;
	create_table_query: string;
}

interface InstalledComment {
	host: string;
	name: string;
	comment: string;
}

/**
 * Removes the retention TTLs, journaling only after every replica serves the
 * tables without them. `REMOVE TTL` fails on a table or column that has none,
 * so each such statement runs only while its TTL is still installed (a
 * migration interrupted halfway, or a table created without one, is
 * finished, not failed). Safe to run on every deploy: once journaled it only
 * verifies, and it fails if a TTL comes back.
 */
export async function runL1RetentionMigration(options: {
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
		(entry) => entry.name === L1_RETENTION_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("L1 retention migration checksum mismatch");
	const replicas = await countReplicas(
		options.executor,
		"the L1 tables without retention",
	);
	const apply = async () => {
		// The statements run on the endpoint this executor reaches, so what
		// still applies is what that endpoint serves, not a lagging replica.
		const installed = await readTables(options, 0);
		for (const statement of extractExecutableStatements(options.migrationSql))
			if (statementApplies(statement, options.targetDatabase, installed))
				await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const mismatch = await retentionMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, finish what has not landed on this endpoint.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: L1_RETENTION_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

const REMOVE_TABLE_TTL = /^ALTER TABLE ([\w.]+) REMOVE TTL$/iu;
const REMOVE_COLUMN_TTL =
	/^ALTER TABLE ([\w.]+) MODIFY COLUMN (\w+) REMOVE TTL$/iu;

/** Whether a statement still has work to do; only REMOVE TTL is conditional. */
function statementApplies(
	statement: string,
	database: string,
	installed: readonly InstalledTable[],
): boolean {
	const text = statement.trim().replace(/;$/u, "");
	const column = REMOVE_COLUMN_TTL.exec(text);
	const table = column ?? REMOVE_TABLE_TTL.exec(text);
	if (!table) return true;
	const name = table[1]?.split(".").at(-1) ?? "";
	const found = installed.filter((row) => row.name === name);
	if (found.length === 0)
		throw new Error(
			`Table ${database}.${name} is missing: apply the migration that creates it first`,
		);
	return found.some((row) =>
		column
			? hasColumnTtl(row.create_table_query, column[2] ?? "")
			: hasTableTtl(row.engine_full),
	);
}

function hasTableTtl(engineFull: string): boolean {
	return /\sTTL\s/u.test(` ${engineFull.split(" SETTINGS ", 1)[0]} `);
}

function hasColumnTtl(createQuery: string, column: string): boolean {
	return /\sTTL\s/u.test(columnDeclaration(createQuery, column));
}

const tableList = L1_RETENTION_TABLES.map((name) => `'${name}'`).join(", ");

async function readTables(
	options: { executor: ClickHouseExecutor; targetDatabase: string },
	replicas: number,
): Promise<InstalledTable[]> {
	const source =
		replicas > 1
			? "clusterAllReplicas('default', system.tables)"
			: "system.tables";
	return options.executor.query<InstalledTable>(`
		SELECT hostName() AS host, name, engine_full, create_table_query
		FROM ${source}
		WHERE database = '${options.targetDatabase}' AND name IN (${tableList})
		ORDER BY host, name LIMIT 8 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
}

/** Why any replica still differs from "no retention", or null once all agree. */
async function retentionMismatch(
	options: { executor: ClickHouseExecutor; targetDatabase: string },
	replicas: number,
): Promise<string | null> {
	const tables = await readTables(options, replicas);
	const hosts = new Set(tables.map((row) => row.host));
	const comments = await options.executor.query<InstalledComment>(`
		SELECT hostName() AS host, name, comment
		FROM ${replicas > 1 ? "clusterAllReplicas('default', system.columns)" : "system.columns"}
		WHERE database = '${options.targetDatabase}' AND table = 'run_index'
			AND name IN (${RUN_INDEX_RETENTION_COMMENT_COLUMNS.map((name) => `'${name}'`).join(", ")})
		ORDER BY host, name LIMIT 16 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	if (hosts.size < Math.max(1, replicas))
		return `Retention tables visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const rows = tables.filter((row) => row.host === host);
		const missing = L1_RETENTION_TABLES.filter(
			(name) => !rows.some((row) => row.name === name),
		);
		const where = replicas > 1 ? ` on replica ${host}` : "";
		if (missing.length > 0)
			return `Tables missing: ${missing.join(", ")}${where}`;
		const withTtl = rows.filter((row) => hasTableTtl(row.engine_full));
		if (withTtl.length > 0)
			return `Tables still have a TTL: ${withTtl.map((row) => row.name).join(", ")}${where}`;
		const runIndex = rows.find((row) => row.name === "run_index");
		const timed = RUN_INDEX_TEXT_COLUMNS.filter((name) =>
			hasColumnTtl(runIndex?.create_table_query ?? "", name),
		);
		if (timed.length > 0)
			return `Run index text columns still have a TTL: ${timed.join(", ")}${where}`;
		const installed = comments.filter((row) => row.host === host);
		const wrong = RUN_INDEX_RETENTION_COMMENT_COLUMNS.filter((name) => {
			const expected = RUN_INDEX.columns.find(
				(column) => column.name === name,
			)?.comment;
			return installed.find((row) => row.name === name)?.comment !== expected;
		});
		if (wrong.length > 0)
			return `Run index comments mismatch: ${wrong.join(", ")}${where}`;
	}
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runL1RetentionMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", L1_RETENTION_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${L1_RETENTION_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
