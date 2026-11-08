import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

export const PARSER_V9_MIGRATION = "20261010130000_parser_v9.sql";
const COLUMNS = [
	["usage_events", "recorded_cache_write_5m_input_tokens", "Nullable(UInt64)"],
	["usage_events", "recorded_cache_write_1h_input_tokens", "Nullable(UInt64)"],
	["usage_events", "cache_write_input_tokens", "Nullable(UInt64)"],
	["run_index", "failed_edits", "Nullable(UInt32)"],
	["run_index", "refused_edits", "Nullable(UInt32)"],
] as const;

export function parserV9ColumnsVisible(
	rows: readonly { host: string; table: string; name: string; type: string }[],
	replicas: number,
): boolean {
	const hosts = new Set(rows.map((row) => row.host));
	return (
		Number.isSafeInteger(replicas) &&
		replicas > 0 &&
		hosts.size >= replicas &&
		[...hosts].every((host) =>
			COLUMNS.every(([table, name, type]) =>
				rows.some(
					(row) =>
						row.host === host &&
						row.table === table &&
						row.name === name &&
						row.type === type,
				),
			),
		)
	);
}

export async function runParserV9Migration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === PARSER_V9_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Parser 9 migration checksum mismatch");
	if (applied.length === 0)
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	const replicas = await countReplicas(
		options.executor,
		"the parser 9 columns",
	);
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
		}>(
			`SELECT hostName() AS host, table, name, type FROM ${replicas > 1 ? "clusterAllReplicas('default', system.columns)" : "system.columns"} WHERE database = 'rudel' AND table IN ('usage_events', 'run_index') AND name IN (${COLUMNS.map((column) => `'${column[1]}'`).join(",")}) ORDER BY host, table, name LIMIT 16 BY host SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`,
		);
		if (parserV9ColumnsVisible(rows, replicas)) break;
		if (attempt >= attempts)
			throw new Error(
				"Parser 9 columns are not visible with the expected types on every replica",
			);
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: PARSER_V9_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runParserV9Migration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", PARSER_V9_MIGRATION),
				"utf8",
			),
		});
		console.log(`Applied/validated: ${PARSER_V9_MIGRATION}`);
	} finally {
		await target.close();
	}
}
if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
