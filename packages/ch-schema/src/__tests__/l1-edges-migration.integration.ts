import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	L1_EDGES_MIGRATION,
	runL1EdgesMigration,
} from "../../scripts/migrate-l1-edges.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: "default",
});
const database = `opaline_l1_edges_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

test("creates the edge tables and reverse view once, copies edges by target, and rejects drift", async () => {
	const sql = (
		await readFile(
			resolve(import.meta.dir, "../../chx/migrations", L1_EDGES_MIGRATION),
			"utf8",
		)
	).replaceAll("rudel.", `${database}.`);
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
	const journalStore = createJournalStore(journalExecutor);
	const options = {
		executor,
		journalStore,
		migrationSql: sql,
		targetDatabase: database,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
		// One server: no replica lag to wait for, and drift must fail fast.
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runL1EdgesMigration(options);
	await runL1EdgesMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === L1_EDGES_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(sql)]);

	await executor.execute(
		`INSERT INTO ${database}.l1_edges (organization_id, from_kind, from_id, relation, to_kind, to_id, evidence_id, basis, revision, is_active)
		 VALUES ('org', 'run', 'u/claude_code/s//4', 'commit_pushed', 'commit', '101/d4e5f6a', 'obs:1', 'transcript', 1, 1),
		        ('org', 'run', 'u/claude_code/s//4', 'commit_pushed', 'commit', '101/d4e5f6a', 'obs:1', 'transcript', 2, 0)`,
	);
	const reverse = await executor.query<{ from_id: string; is_active: number }>(
		`SELECT from_id, is_active FROM ${database}.l1_edges_by_target FINAL
		 WHERE organization_id = 'org' AND to_kind = 'commit' AND to_id = '101/d4e5f6a'`,
	);
	// Every version is copied, so a retraction reaches the reverse direction too.
	expect(reverse).toEqual([{ from_id: "u/claude_code/s//4", is_active: 0 }]);

	await expect(
		runL1EdgesMigration({ ...options, migrationSql: `${sql}\nSELECT 1;\n` }),
	).rejects.toThrow("checksum mismatch");
	await executor.execute(
		`ALTER TABLE ${database}.l1_edges MODIFY COLUMN relation LowCardinality(String) COMMENT 'wrong'`,
	);
	await expect(runL1EdgesMigration(options)).rejects.toThrow(
		"schema mismatch on l1_edges",
	);
	await journalExecutor.close();
});
