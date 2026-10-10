import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	L1_RETENTION_MIGRATION,
	runL1RetentionMigration,
} from "../../scripts/migrate-l1-retention.js";
import {
	RUN_INDEX_MIGRATION,
	runRunIndexMigration,
} from "../../scripts/migrate-run-index.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { RUN_INDEX_TEXT_COLUMNS } from "../db/schema/run-index.js";

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
const database = `opaline_l1_retention_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

/** Tables created by earlier migrations, reduced to the columns the TTL and this test use. */
const STAND_INS = [
	"claude_sessions",
	"codex_sessions",
	"transcript_records",
	"session_lineage",
];

const read = (name: string) =>
	readFile(resolve(import.meta.dir, "../../chx/migrations", name), "utf8");
const day = (offset: number) =>
	new Date(Date.now() + offset * 86_400_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");

test("removes every retention TTL, keeps old rows through TTL merges, and rejects a TTL that returns", async () => {
	const runIndexSql = (await read(RUN_INDEX_MIGRATION)).replaceAll(
		"rudel.",
		`${database}.`,
	);
	const retentionSql = (await read(L1_RETENTION_MIGRATION)).replaceAll(
		"rudel.",
		`${database}.`,
	);
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = createClickHouseExecutor({
		...credentials,
		database,
	});
	const journalStore = createJournalStore(journalExecutor);

	// The tables as earlier migrations left them: the run index from its
	// migration (a 1,095-day table TTL and 365-day text column TTLs), the raw
	// and record tables with their 365-day table TTL (reduced to the columns
	// the TTL and this test use).
	const runIndexOptions = {
		executor,
		journalStore,
		migrationSql: runIndexSql,
		targetDatabase: database,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runRunIndexMigration(runIndexOptions);
	for (const table of STAND_INS)
		await executor.execute(
			`CREATE TABLE ${database}.${table} (organization_id String, session_id String, session_date DateTime64(3, 'UTC'), body String)
			 ENGINE = MergeTree ORDER BY (organization_id, session_id)
			 TTL toDate(session_date) + toIntervalDay(365)`,
		);
	const textTtls = async () =>
		(
			await executor.query<{ create_table_query: string }>(
				`SELECT create_table_query FROM system.tables WHERE database = '${database}' AND name = 'run_index'`,
			)
		)[0]?.create_table_query ?? "";
	expect(await textTtls()).toContain("toIntervalDay(365)");

	const options = {
		executor,
		journalStore,
		migrationSql: retentionSql,
		targetDatabase: database,
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runL1RetentionMigration(options);
	await runL1RetentionMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === L1_RETENTION_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(retentionSql)]);
	expect(await textTtls()).not.toMatch(/toIntervalDay\((365|1095)\)/u);

	// A session older than any former TTL survives a forced merge, text included.
	const text = RUN_INDEX_TEXT_COLUMNS.map((column) => `'${column} text'`);
	await executor.execute(
		`INSERT INTO ${database}.run_index (organization_id, user_id, session_id, revision, parser_version, index_version, agent_id, start_record, row_kind, source, turn_idx, build_revision, session_date, tool_calls, ${RUN_INDEX_TEXT_COLUMNS.join(", ")})
		 VALUES ('org', 'u', 'ancient', 1, 8, 1, '', 1, 'run', 'claude_code', 1, 1, '${day(-4_000)}', 3, ${text.join(", ")})`,
	);
	for (const table of STAND_INS)
		await executor.execute(
			`INSERT INTO ${database}.${table} VALUES ('org', 'ancient', '${day(-4_000)}', 'kept')`,
		);
	for (const table of ["run_index", ...STAND_INS]) {
		await executor.execute(`OPTIMIZE TABLE ${database}.${table} FINAL`);
	}
	expect(
		await executor.query<Record<string, unknown>>(
			`SELECT session_id, tool_calls, ${RUN_INDEX_TEXT_COLUMNS.join(", ")} FROM ${database}.run_index FINAL`,
		),
	).toEqual([
		{
			session_id: "ancient",
			tool_calls: 3,
			...Object.fromEntries(
				RUN_INDEX_TEXT_COLUMNS.map((column) => [column, `${column} text`]),
			),
		},
	]);
	for (const table of STAND_INS)
		expect(
			await executor.query<{ rows: string }>(
				`SELECT toString(count()) AS rows FROM ${database}.${table}`,
			),
		).toEqual([{ rows: "1" }]);

	// The run index runner of every later deploy still passes: it no longer
	// expects TTLs, and the retention runner owns the reworded comments.
	await runRunIndexMigration(runIndexOptions);

	await expect(
		runL1RetentionMigration({
			...options,
			migrationSql: `${retentionSql}\nSELECT 1;\n`,
		}),
	).rejects.toThrow("checksum mismatch");
	await executor.execute(
		`ALTER TABLE ${database}.transcript_records MODIFY TTL toDate(session_date) + toIntervalDay(365)`,
	);
	await expect(runL1RetentionMigration(options)).rejects.toThrow(
		"Tables still have a TTL: transcript_records",
	);
	await executor.execute(
		`ALTER TABLE ${database}.transcript_records REMOVE TTL`,
	);
	await executor.execute(
		`ALTER TABLE ${database}.run_index MODIFY COLUMN goal Nullable(String) TTL toDate(session_date) + toIntervalDay(365)`,
	);
	await expect(runL1RetentionMigration(options)).rejects.toThrow(
		"Run index text columns still have a TTL: goal",
	);
	await journalExecutor.close();
});
