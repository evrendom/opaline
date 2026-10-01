import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { createJournalStore } from "chkit/dist/bin/lib.js";
import {
	runSessionGitObservationsMigration,
	SESSION_GIT_OBSERVATIONS_MIGRATION,
} from "../../scripts/migrate-session-git-observations.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: "default",
});
const database = `opaline_a3_migration_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

test("additive runner is idempotent, checks COMMENTs and rejects non-replacing engine_full", async () => {
	const sql = (
		await readFile(
			resolve(
				import.meta.dir,
				"../../chx/migrations",
				SESSION_GIT_OBSERVATIONS_MIGRATION,
			),
			"utf8",
		)
	).replaceAll("rudel", database);
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
	const options = {
		executor,
		journalStore: createJournalStore(journalExecutor),
		migrationSql: sql,
		targetDatabase: database,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
	};
	await runSessionGitObservationsMigration(options);
	await runSessionGitObservationsMigration(options);
	const columns = await executor.query<{ comment: string }>(
		`SELECT comment FROM system.columns WHERE database = '${database}' AND table = 'session_git_observations'`,
	);
	expect(columns).toHaveLength(24);
	expect(columns.every((column) => column.comment.length > 0)).toBe(true);
	await executor.execute(
		`ALTER TABLE ${database}.session_git_observations MODIFY COLUMN branch String COMMENT 'wrong'`,
	);
	await expect(runSessionGitObservationsMigration(options)).rejects.toThrow(
		"schema mismatch",
	);
	await executor.execute(`DROP TABLE ${database}.session_git_observations`);
	await executor.execute(
		sql.split("CREATE TABLE IF NOT EXISTS")[1]
			? `CREATE TABLE IF NOT EXISTS${sql.split("CREATE TABLE IF NOT EXISTS")[1]}`.replace(
					"ReplacingMergeTree()",
					"MergeTree()",
				)
			: "invalid",
	);
	await expect(runSessionGitObservationsMigration(options)).rejects.toThrow(
		"engine_full",
	);
	await journalExecutor.close();
});
