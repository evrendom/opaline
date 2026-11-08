import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	transcriptChunkHitsTable,
	transcriptChunksTable,
} from "../src/db/schema/transcript-search.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

/** Transcript chunks and their hits, for transcript search (OPL-396). */
export const TRANSCRIPT_SEARCH_MIGRATION =
	"20261012150000_transcript_search.sql";
const TABLES = [
	{ definition: transcriptChunksTable, version: "embedded_at" },
	{ definition: transcriptChunkHitsTable, version: "written_at" },
];
/** Columns the migration gives a codec by hand (chkit cannot express it). */
const CODECS: Readonly<Record<string, string>> = {
	"transcript_chunks.text": "CODEC(ZSTD(3))",
};

/**
 * Creates both tables once and journals the migration only after every
 * column, codec, key, engine, setting and comment reads back as defined.
 */
export async function runTranscriptSearchMigration(options: {
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
		(entry) => entry.name === TRANSCRIPT_SEARCH_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Transcript search migration checksum mismatch");
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
			name: TRANSCRIPT_SEARCH_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why the installed tables differ from the definitions, or null. */
async function schemaMismatch(schema: {
	executor: ClickHouseExecutor;
	targetDatabase: string;
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
}): Promise<string | null> {
	for (const { definition, version } of TABLES) {
		const columns = await schema.executor.query<{
			name: string;
			type: string;
			comment: string;
			default_kind: string;
			compression_codec: string;
		}>(`
			SELECT name, type, comment, default_kind, compression_codec FROM system.columns
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
				? engine === `ReplacingMergeTree(${version})`
				: new RegExp(
						`^SharedReplacingMergeTree\\((?:'[^']*',\\s*'[^']*',\\s*)?${version}\\)$`,
						"u",
					).test(engine);
		if (
			columns.length !== definition.columns.length ||
			!columns.every((column, index) => {
				const expected = definition.columns[index];
				return (
					expected &&
					column.name === expected.name &&
					column.type === expected.type &&
					column.comment === expected.comment &&
					column.default_kind === "" &&
					column.compression_codec ===
						(CODECS[`${definition.name}.${column.name}`] ?? "")
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
			return `Transcript search schema mismatch on ${definition.name} (columns, codecs, COMMENTs, engine_full, key, settings)`;
	}
	const indexes = await schema.executor.query<{ name: string; type: string }>(`
		SELECT name, type FROM system.data_skipping_indices
		WHERE database = '${schema.targetDatabase}' AND table = '${transcriptChunkHitsTable.name}'
		LIMIT 4 SETTINGS max_execution_time = 10`);
	if (
		indexes.length !== 1 ||
		indexes[0]?.name !== "ts_minmax" ||
		indexes[0]?.type !== "minmax"
	)
		return `Transcript search schema mismatch on ${transcriptChunkHitsTable.name} (skip index ts_minmax)`;
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runTranscriptSearchMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					TRANSCRIPT_SEARCH_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: target.engine("ReplacingMergeTree"),
			expectedStoragePolicy: target.capabilities.storagePolicy,
		});
		console.log(`Applied/validated: ${TRANSCRIPT_SEARCH_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
