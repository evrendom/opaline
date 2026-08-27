import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
	listMigrations,
} from "chkit/dist/bin/lib.js";
import {
	isLocalClickHouseEndpoint,
	resolveClickHouseUsername,
} from "../src/clickhouse-connection.js";
import { appendJournalEntryWithReconciliation } from "./migrate-f16.js";

const FIRST_F16_MIGRATION = "20260826090550_f16_preservation.sql";
const MIGRATIONS_DIR = resolve(import.meta.dir, "..", "chx", "migrations");

function assertDisposableCiEnvironment(clickhouseUrl: string): void {
	const enabled = process.env.F16_NONPROD_APPLY_PREREQUISITES?.trim();
	const isCi = process.env.CI === "true" || process.env.CI === "1";
	if (
		enabled !== "ci-only" ||
		!isCi ||
		!isLocalClickHouseEndpoint(clickhouseUrl)
	) {
		throw new Error(
			"F16_NONPROD_APPLY_PREREQUISITES=ci-only requires CI=true and a local disposable ClickHouse endpoint",
		);
	}
}

async function run(): Promise<void> {
	const clickhouseUrl =
		process.env.CLICKHOUSE_URL?.trim() || "http://localhost:8123";
	assertDisposableCiEnvironment(clickhouseUrl);
	const executor = createClickHouseExecutor({
		database: process.env.CLICKHOUSE_DB?.trim() || "default",
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		url: clickhouseUrl,
		username: resolveClickHouseUsername(process.env, clickhouseUrl),
	});
	try {
		const migrationNames = await listMigrations(MIGRATIONS_DIR);
		const preF16MigrationNames = migrationNames.filter(
			(name) => name < FIRST_F16_MIGRATION,
		);
		if (preF16MigrationNames.length === 0) {
			throw new Error("No pre-F16 ClickHouse migrations were found");
		}
		const journalStore = createJournalStore(executor);
		const journal = await journalStore.readJournal();
		const appliedEntries = [...journal.applied];
		const appliedNames = new Set(appliedEntries.map((entry) => entry.name));
		const firstMissingName = preF16MigrationNames.find(
			(name) => !appliedNames.has(name),
		);
		const firstMissingIndex = firstMissingName
			? preF16MigrationNames.indexOf(firstMissingName)
			: -1;
		if (
			firstMissingIndex >= 0 &&
			preF16MigrationNames
				.slice(firstMissingIndex + 1)
				.some((name) => appliedEntries.some((entry) => entry.name === name))
		) {
			throw new Error(
				"Pre-F16 journal is out of order; refusing disposable CI prerequisite apply",
			);
		}
		if (
			appliedEntries.some((entry) => entry.name >= FIRST_F16_MIGRATION) &&
			firstMissingIndex >= 0
		) {
			throw new Error(
				"An F16-or-later migration is journaled while a pre-F16 prerequisite is missing",
			);
		}
		for (const name of preF16MigrationNames) {
			const sql = await readFile(resolve(MIGRATIONS_DIR, name), "utf8");
			const checksum = checksumSQL(sql);
			const applied = appliedEntries.find((entry) => entry.name === name);
			if (applied) {
				if (applied.checksum && applied.checksum !== checksum) {
					throw new Error(
						`Applied pre-F16 migration checksum mismatch for ${name}`,
					);
				}
				console.log(`Already applied prerequisite: ${name}`);
				continue;
			}
			for (const statement of extractExecutableStatements(sql)) {
				await executor.execute(statement);
			}
			const entry = {
				appliedAt: new Date().toISOString().replace("Z", ""),
				checksum,
				name,
			};
			await appendJournalEntryWithReconciliation(journalStore, entry);
			appliedEntries.push(entry);
			console.log(`Applied prerequisite: ${name}`);
		}
	} finally {
		await executor.close();
	}
}

if (import.meta.main) {
	run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
