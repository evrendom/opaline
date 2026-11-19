import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	RUN_ACTIVITY_END_COLUMNS,
	RUN_ACTIVITY_END_MIGRATION,
	runRunActivityEndMigration,
} from "../../scripts/migrate-run-activity-end.js";
import {
	RUN_INDEX_MIGRATION,
	runRunIndexMigration,
} from "../../scripts/migrate-run-index.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { RUN_INDEX_COLUMNS } from "../run-index.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const credentials = {
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
};
const executor = createClickHouseExecutor({
	...credentials,
	database: "default",
});
const database = `opaline_run_activity_end_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

const read = (name: string) =>
	readFile(resolve(import.meta.dir, "../../chx/migrations", name), "utf8").then(
		(sql) => sql.replaceAll("rudel.", `${database}.`),
	);

/** The other tables as their first migrations left them, reduced to the
 * columns whose comment this migration rewrites. */
const STAND_INS = {
	run_requests:
		"ended_at DateTime64(3, 'UTC') COMMENT 'Time of the request\\'s last non-meta record.'",
	weekly_totals:
		"minutes Float64 COMMENT 'old', active_minutes Float64 COMMENT 'old'",
	analysis_finding_runs:
		"minutes Float64 COMMENT 'old', active_minutes Float64 COMMENT 'old'",
};

const comments = async () =>
	Object.fromEntries(
		(
			await executor.query<{ table: string; name: string; comment: string }>(
				`SELECT table, name, comment FROM system.columns
				 WHERE database = '${database}' AND name IN ('ended_at', 'minutes', 'active_minutes')
				 ORDER BY table, name`,
			)
		).map((row) => [`${row.table}.${row.name}`, row.comment]),
	);

test("rewrites the run time comments once, lets the run index runner pass, and rejects a comment that changes back", async () => {
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalStore = createJournalStore(
		createClickHouseExecutor({ ...credentials, database }),
	);
	const runIndexOptions = {
		executor,
		journalStore,
		migrationSql: await read(RUN_INDEX_MIGRATION),
		targetDatabase: database,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
		readBack: { attempts: 1, delayMs: 0 },
	};
	// The run index as its first migration creates it: the old wording.
	await runRunIndexMigration(runIndexOptions);
	for (const [table, columns] of Object.entries(STAND_INS))
		await executor.execute(
			`CREATE TABLE ${database}.${table} (organization_id String, ${columns}) ENGINE = MergeTree ORDER BY organization_id`,
		);
	expect((await comments())["run_index.minutes"]).toContain("non-meta");

	const migrationSql = await read(RUN_ACTIVITY_END_MIGRATION);
	const options = {
		executor,
		journalStore,
		migrationSql,
		targetDatabase: database,
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runRunActivityEndMigration(options);
	await runRunActivityEndMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === RUN_ACTIVITY_END_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(migrationSql)]);
	const after = await comments();
	expect(Object.keys(after).sort()).toEqual(
		Object.entries(RUN_ACTIVITY_END_COLUMNS)
			.flatMap(([table, names]) => names.map((name) => `${table}.${name}`))
			.sort(),
	);
	for (const comment of Object.values(after))
		expect(comment).toContain("activity record");
	expect(after["run_index.minutes"]).toBe(
		RUN_INDEX_COLUMNS.find((column) => column.name === "minutes")?.comment,
	);
	// The run index's own runner, run again on every deploy, accepts the
	// new wording.
	await runRunIndexMigration(runIndexOptions);

	await executor.execute(
		`ALTER TABLE ${database}.run_index COMMENT COLUMN minutes 'changed back'`,
	);
	await expect(runRunActivityEndMigration(options)).rejects.toThrow(
		"Run activity end comments mismatch: run_index.minutes",
	);
});
