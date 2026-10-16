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
import transcriptRecordsSchema from "../src/db/schema/transcript-records.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/**
 * Parser 12: `transcript_records.record_uuid`, the line's own id as the agent
 * wrote it (Claude Code `uuid`), and its bloom filter skip index, so the run
 * tool can open a record by that id within one workspace.
 */
export const TRANSCRIPT_RECORD_UUID_MIGRATION =
	"20261016120000_transcript_record_uuid.sql";

const COLUMN = "record_uuid";
/** The column the added column follows. */
const AFTER = "call_id";
const INDEX = "record_uuid_bloom";

interface Column {
	name: string;
	type: string;
	comment: string;
}
interface Index {
	name: string;
	expression: string;
	type: string;
	typeArgs?: string;
	granularity: number;
}
const table = (
	transcriptRecordsSchema as unknown as {
		columns: Column[];
		indexes?: Index[];
	}[]
)[0];
const definition = (): { column: Column; index: Index } => {
	const column = table?.columns.find((candidate) => candidate.name === COLUMN);
	const index = table?.indexes?.find((candidate) => candidate.name === INDEX);
	if (!column || !index)
		throw new Error(`Missing ${COLUMN} or ${INDEX} in the schema`);
	return { column, index };
};
const indexType = (index: Index) =>
	index.typeArgs === undefined
		? index.type
		: `${index.type}(${index.typeArgs})`;
/** ClickHouse reports an expression as written, with or without outer parentheses. */
const bare = (expression: string) =>
	expression.replaceAll(/\s+/gu, "").replace(/^\((.*)\)$/u, "$1");
const sqlString = (value: string) =>
	`'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

/**
 * The migration's statements, as the table defines the column and the index:
 * idempotent, and only metadata changes. The column comes first, so the index
 * names a column every replica already has.
 */
export function transcriptRecordUuidStatements(database: string): string[] {
	const { column, index } = definition();
	return [
		`ALTER TABLE ${database}.transcript_records ADD COLUMN IF NOT EXISTS ${COLUMN} ${column.type} COMMENT ${sqlString(column.comment)} AFTER ${AFTER}`,
		`ALTER TABLE ${database}.transcript_records ADD INDEX IF NOT EXISTS ${INDEX} (${index.expression}) TYPE ${indexType(index)} GRANULARITY ${index.granularity}`,
	];
}

export interface InstalledColumn {
	host: string;
	name: string;
	type: string;
	comment: string;
}
export interface InstalledIndex {
	host: string;
	name: string;
	type_full: string;
	expr: string;
	granularity: number | string;
}

/** Whether every replica serves the column and the index as defined. */
export function transcriptRecordUuidVisible(
	columns: readonly InstalledColumn[],
	indexes: readonly InstalledIndex[],
	replicas: number,
): boolean {
	const { column, index } = definition();
	const hosts = new Set([
		...columns.map((row) => row.host),
		...indexes.map((row) => row.host),
	]);
	return (
		Number.isSafeInteger(replicas) &&
		replicas > 0 &&
		hosts.size >= replicas &&
		[...hosts].every(
			(host) =>
				columns.some(
					(row) =>
						row.host === host &&
						row.name === COLUMN &&
						row.type === column.type &&
						row.comment === column.comment,
				) &&
				indexes.some(
					(row) =>
						row.host === host &&
						row.name === INDEX &&
						bare(row.type_full) === bare(indexType(index)) &&
						bare(row.expr) === bare(index.expression) &&
						Number(row.granularity) === index.granularity,
				),
		)
	);
}

/** Applies the migration once and journals it only after every replica serves the column and the index. */
export async function runTranscriptRecordUuidMigration(options: {
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
		(entry) => entry.name === TRANSCRIPT_RECORD_UUID_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Transcript record uuid migration checksum mismatch");
	if (applied.length === 0)
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	const replicas = await countReplicas(
		options.executor,
		"the transcript record uuid column and index",
	);
	const system = (name: string) =>
		replicas > 1
			? `clusterAllReplicas('default', system.${name})`
			: `system.${name}`;
	const settings =
		"SETTINGS max_execution_time = 10, skip_unavailable_shards = 0";
	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const columns = await options.executor.query<InstalledColumn>(
			`SELECT hostName() AS host, name, type, comment FROM ${system("columns")} WHERE database = '${database}' AND table = 'transcript_records' AND name = '${COLUMN}' ORDER BY host LIMIT 16 ${settings}`,
		);
		const indexes = await options.executor.query<InstalledIndex>(
			`SELECT hostName() AS host, name, type_full, expr, granularity FROM ${system("data_skipping_indices")} WHERE database = '${database}' AND table = 'transcript_records' AND name = '${INDEX}' ORDER BY host LIMIT 16 ${settings}`,
		);
		if (transcriptRecordUuidVisible(columns, indexes, replicas)) break;
		if (attempt >= attempts)
			throw new Error(
				"The transcript record uuid column and index are not visible as defined on every replica",
			);
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: TRANSCRIPT_RECORD_UUID_MIGRATION,
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
		await runTranscriptRecordUuidMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					TRANSCRIPT_RECORD_UUID_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${TRANSCRIPT_RECORD_UUID_MIGRATION}`);
	} finally {
		await executor.close();
	}
}
if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
