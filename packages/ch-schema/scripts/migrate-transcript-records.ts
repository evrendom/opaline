import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import transcriptRecordsSchema from "../src/db/schema/transcript-records.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

// Apply only these forward migrations, in order: the merged history contains
// older schema experiments that must never be replayed against an existing
// production DB.
export const TRANSCRIPT_RECORDS_MIGRATION =
	"20260930105809_transcript_records.sql";
/** Additive parser v6 fact columns (docs/l1-literal-schema.md, step 7). */
export const TRANSCRIPT_RECORDS_FACTS_MIGRATION =
	"20261009150000_transcript_records_facts.sql";
const FACT_COLUMNS_FROM = "agent_version";

type Column = {
	name: string;
	type: string;
	nullable?: boolean;
	comment?: string;
};

export async function runTranscriptRecordsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	factsMigrationSql: string;
	targetDatabase: string;
	/**
	 * ClickHouse Cloud applies DDL to replicas asynchronously, so a read right
	 * after ALTER can miss a column; the check retries this often.
	 */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const journal = (await options.journalStore.readJournal()).applied;
	const steps = [
		[TRANSCRIPT_RECORDS_MIGRATION, options.migrationSql],
		[TRANSCRIPT_RECORDS_FACTS_MIGRATION, options.factsMigrationSql],
	].map(([name = "", sql = ""]) => {
		const checksum = checksumSQL(sql);
		const applied = journal.filter((entry) => entry.name === name);
		if (applied.some((entry) => entry.checksum !== checksum))
			throw new Error(
				`Transcript records migration checksum mismatch: ${name}`,
			);
		return { name, sql, checksum, applied: applied.length > 0 };
	});
	const apply = async () => {
		for (const step of steps)
			if (!step.applied)
				for (const statement of extractExecutableStatements(step.sql))
					await options.executor.execute(statement);
	};
	await apply();
	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const mismatch = await factColumnsMismatch(
			options.executor,
			options.targetDatabase,
		);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, apply the idempotent statements again in case they did not land.
		if (attempt === Math.ceil(attempts / 2)) await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	for (const step of steps)
		if (!step.applied)
			await appendJournalEntryWithReconciliation(options.journalStore, {
				name: step.name,
				checksum: step.checksum,
				appliedAt: new Date().toISOString().replace("Z", ""),
			});
}

/**
 * Why the installed fact columns differ from the schema, or null. Reads the
 * replica that answers, like the other forward migrations: the production
 * migration user may not read system.clusters.
 */
async function factColumnsMismatch(
	executor: ClickHouseExecutor,
	database: string,
): Promise<string | null> {
	const table = (
		transcriptRecordsSchema as unknown as { columns: Column[] }[]
	)[0];
	if (!table) throw new Error("transcript_records schema is missing");
	const expected = table.columns.slice(
		table.columns.findIndex((column) => column.name === FACT_COLUMNS_FROM),
	);
	const installed = await executor.query<InstalledColumn>(`
		SELECT name, type, comment, default_kind, compression_codec
		FROM system.columns
		WHERE database = '${database}' AND table = 'transcript_records'
		ORDER BY position LIMIT 64
		SETTINGS max_execution_time = 10`);
	const from = installed.findIndex(
		(column) => column.name === FACT_COLUMNS_FROM,
	);
	const facts = from === -1 ? [] : installed.slice(from);
	const wrong = expected.filter((column, index) => {
		const found = facts[index];
		return (
			!found ||
			found.name !== column.name ||
			found.type !==
				(column.nullable ? `Nullable(${column.type})` : column.type) ||
			found.comment !== column.comment ||
			found.default_kind !== "" ||
			(column.name === "facts" && found.compression_codec !== "CODEC(ZSTD(3))")
		);
	});
	return wrong.length === 0 && facts.length === expected.length
		? null
		: `Transcript records fact columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`;
}

type InstalledColumn = {
	name: string;
	type: string;
	comment: string;
	default_kind: string;
	compression_codec: string;
};

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		const read = (name: string) =>
			readFile(resolve(import.meta.dir, "../chx/migrations", name), "utf8");
		await runTranscriptRecordsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await read(TRANSCRIPT_RECORDS_MIGRATION),
			factsMigrationSql: await read(TRANSCRIPT_RECORDS_FACTS_MIGRATION),
			targetDatabase: "rudel",
		});
		console.log(
			`Applied/validated: ${TRANSCRIPT_RECORDS_MIGRATION}, ${TRANSCRIPT_RECORDS_FACTS_MIGRATION}`,
		);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
