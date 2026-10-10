import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	RUN_INDEX_MIGRATION,
	runRunIndexMigration,
} from "../../scripts/migrate-run-index.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import {
	RUN_INDEX_TEXT_COLUMNS,
	RUN_INDEX_TEXT_RETENTION_DAYS,
} from "../db/schema/run-index.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: "default",
});
const database = `opaline_run_index_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

test("creates the run index once, keeps every build, expires its text before its runs, and rejects drift", async () => {
	const sql = (
		await readFile(
			resolve(import.meta.dir, "../../chx/migrations", RUN_INDEX_MIGRATION),
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
	await runRunIndexMigration(options);
	await runRunIndexMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === RUN_INDEX_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(sql)]);

	// A run past the text retention keeps its facts and loses its text; a
	// recent run keeps both. Expired text reads NULL, never empty.
	const day = (offset: number) =>
		new Date(Date.now() + offset * 86_400_000)
			.toISOString()
			.replace("T", " ")
			.replace("Z", "");
	const text = Object.fromEntries(
		RUN_INDEX_TEXT_COLUMNS.map((column) => [column, `${column} text`]),
	);
	await executor.execute(
		`INSERT INTO ${database}.run_index (organization_id, user_id, session_id, revision, parser_version, index_version, agent_id, start_record, row_kind, source, turn_idx, build_revision, session_date, tool_calls, ${RUN_INDEX_TEXT_COLUMNS.join(", ")})
		 VALUES ('org', 'u', 'old', 1, 8, 1, '', 1, 'run', 'claude_code', 1, 1, '${day(-(RUN_INDEX_TEXT_RETENTION_DAYS + 30))}', 3, ${RUN_INDEX_TEXT_COLUMNS.map((column) => `'${text[column]}'`).join(", ")}),
		        ('org', 'u', 'new', 1, 8, 1, '', 1, 'run', 'claude_code', 1, 1, '${day(-1)}', 4, ${RUN_INDEX_TEXT_COLUMNS.map((column) => `'${text[column]}'`).join(", ")})`,
	);
	await executor.execute(
		`ALTER TABLE ${database}.run_index MATERIALIZE TTL SETTINGS mutations_sync = 2`,
	);
	const rows = await executor.query<Record<string, unknown>>(
		`SELECT session_id, tool_calls, ${RUN_INDEX_TEXT_COLUMNS.join(", ")}
		 FROM ${database}.run_index FINAL ORDER BY session_id`,
	);
	expect(rows).toEqual([
		{
			session_id: "new",
			tool_calls: 4,
			...text,
		},
		{
			session_id: "old",
			tool_calls: 3,
			...Object.fromEntries(
				RUN_INDEX_TEXT_COLUMNS.map((column) => [column, null]),
			),
		},
	]);

	// Each build is its own snapshot: a later build of the same generation
	// never replaces or merges away the rows of an earlier one.
	await executor.execute(
		`INSERT INTO ${database}.run_index (organization_id, user_id, session_id, revision, parser_version, index_version, build_revision, agent_id, start_record, row_kind, session_date, tool_calls)
		 VALUES ('org', 'u', 'builds', 1, 8, 1, 10, '', 1, 'run', '${day(-1)}', 5),
		        ('org', 'u', 'builds', 1, 8, 1, 11, '', 1, 'run', '${day(-1)}', 6)`,
	);
	await executor.execute(`OPTIMIZE TABLE ${database}.run_index FINAL`);
	expect(
		await executor.query<{ build_revision: string; tool_calls: number }>(
			`SELECT toString(build_revision) AS build_revision, tool_calls FROM ${database}.run_index FINAL
			 WHERE session_id = 'builds' ORDER BY build_revision`,
		),
	).toEqual([
		{ build_revision: "10", tool_calls: 5 },
		{ build_revision: "11", tool_calls: 6 },
	]);

	await expect(
		runRunIndexMigration({ ...options, migrationSql: `${sql}\nSELECT 1;\n` }),
	).rejects.toThrow("checksum mismatch");
	await executor.execute(
		`ALTER TABLE ${database}.run_index MODIFY COLUMN goal REMOVE TTL`,
	);
	await expect(runRunIndexMigration(options)).rejects.toThrow(
		"text columns without their TTL: goal",
	);
	await executor.execute(
		`ALTER TABLE ${database}.run_index MODIFY COLUMN model LowCardinality(Nullable(String)) COMMENT 'wrong'`,
	);
	await expect(runRunIndexMigration(options)).rejects.toThrow(
		"columns mismatch: model",
	);
	await journalExecutor.close();
});
