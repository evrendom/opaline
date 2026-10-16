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
import { runIndexTable } from "../src/db/schema/run-index.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/**
 * The run index columns of the capture gaps: where each run worked (the
 * directory its shell commands ran in) and the repository the session's
 * own records tie that directory to, with what ties it, next to the
 * session's one repository; the MCP servers its stream last recorded as
 * unavailable; and the subtype of the prompt each run starts with.
 */
export const RUN_INDEX_CAPTURE_GAPS_MIGRATION =
	"20261016150000_run_index_capture_gaps.sql";

interface Column {
	name: string;
	type: string;
	comment: string;
}
/** The columns the migration adds, in table order, and the column each follows. */
export const ADDED = [
	["prompt_subtype", "genuine_prompts"],
	["cwd", "repository"],
	["cwd_repository", "cwd"],
	["cwd_repository_basis", "cwd_repository"],
	["mcp_unavailable", "mcp_servers"],
] as const;
const definition = (name: string): Column => {
	const column = (
		runIndexTable as unknown as { columns: Column[] }
	).columns.find((candidate) => candidate.name === name);
	if (!column) throw new Error(`Missing column definition: ${name}`);
	return column;
};
const sqlString = (value: string) =>
	`'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/**
 * The migration's statement, for the run index runner too, whose read-back
 * checks every column as defined: idempotent, and only a metadata change.
 */
export function runIndexCaptureGapsStatement(database: string): string {
	return `ALTER TABLE ${database}.run_index ${ADDED.map(([name, after]) => {
		const column = definition(name);
		return `ADD COLUMN IF NOT EXISTS ${name} ${column.type} COMMENT ${sqlString(column.comment)} AFTER ${after}`;
	}).join(", ")}`;
}

/** Whether every replica serves the added columns as defined. */
export function runIndexCaptureGapsVisible(
	rows: readonly {
		host: string;
		name: string;
		type: string;
		comment: string;
	}[],
	replicas: number,
): boolean {
	const hosts = new Set(rows.map((row) => row.host));
	return (
		Number.isSafeInteger(replicas) &&
		replicas > 0 &&
		hosts.size >= replicas &&
		[...hosts].every((host) =>
			ADDED.every(([name]) => {
				const column = definition(name);
				return rows.some(
					(row) =>
						row.host === host &&
						row.name === name &&
						row.type === column.type &&
						row.comment === column.comment,
				);
			}),
		)
	);
}

/** Applies the migration once and journals it only after every replica serves the columns. */
export async function runRunIndexCaptureGapsMigration(options: {
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
		(entry) => entry.name === RUN_INDEX_CAPTURE_GAPS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Run index capture gaps migration checksum mismatch");
	if (applied.length === 0)
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	const replicas = await countReplicas(
		options.executor,
		"the run index capture gaps columns",
	);
	const columns =
		replicas > 1
			? "clusterAllReplicas('default', system.columns)"
			: "system.columns";
	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const rows = await options.executor.query<{
			host: string;
			name: string;
			type: string;
			comment: string;
		}>(
			`SELECT hostName() AS host, name, type, comment FROM ${columns} WHERE database = '${database}' AND table = 'run_index' AND name IN (${ADDED.map(([name]) => `'${name}'`).join(",")}) ORDER BY host, name LIMIT ${ADDED.length} BY host SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`,
		);
		if (runIndexCaptureGapsVisible(rows, replicas)) break;
		if (attempt >= attempts)
			throw new Error(
				"Run index capture gaps columns are not visible as defined on every replica",
			);
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: RUN_INDEX_CAPTURE_GAPS_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
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
		await runRunIndexCaptureGapsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					RUN_INDEX_CAPTURE_GAPS_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${RUN_INDEX_CAPTURE_GAPS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}
if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
