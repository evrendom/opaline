import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import { appendJournalEntryWithReconciliation } from "./migrate-f16.js";

// Apply only this forward migration: the merged history contains older schema
// experiments that must never be replayed against an existing production DB.
const name = "20260913190000_product_launch.sql";
const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: "default",
});
try {
	const sql = await readFile(
		resolve(import.meta.dir, "../chx/migrations", name),
		"utf8",
	);
	const checksum = checksumSQL(sql);
	const journal = createJournalStore(executor);
	const applied = (await journal.readJournal()).applied.find(
		(entry) => entry.name === name,
	);
	if (applied) {
		if (applied.checksum !== checksum)
			throw new Error("Product launch migration checksum mismatch");
		console.log(`Already applied: ${name}`);
	} else {
		for (const statement of extractExecutableStatements(sql))
			await executor.execute(statement);
		await appendJournalEntryWithReconciliation(journal, {
			name,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
		console.log(`Applied: ${name}`);
	}
} finally {
	await executor.close();
}
