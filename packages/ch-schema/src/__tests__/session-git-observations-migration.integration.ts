import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	runSessionGitObservationsMigration,
	SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION,
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
const upgraded = `opaline_a3_upgrade_${Date.now()}`;
const interrupted = `opaline_a3_interrupted_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.execute(`DROP DATABASE IF EXISTS ${upgraded}`);
	await executor.execute(`DROP DATABASE IF EXISTS ${interrupted}`);
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
	const runIdsSql = (
		await readFile(
			resolve(
				import.meta.dir,
				"../../chx/migrations",
				SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION,
			),
			"utf8",
		)
	).replaceAll("rudel", database);
	const options = {
		executor,
		journalStore: createJournalStore(journalExecutor),
		migrationSql: sql,
		runIdsMigrationSql: runIdsSql,
		targetDatabase: database,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
	};
	await runSessionGitObservationsMigration(options);
	await runSessionGitObservationsMigration(options);
	const columns = await executor.query<{ comment: string }>(
		`SELECT comment FROM system.columns WHERE database = '${database}' AND table = 'session_git_observations'`,
	);
	expect(columns).toHaveLength(25);
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

test("an installed table gains run_id once, keeps its rows and records each migration once", async () => {
	const read = async (name: string) =>
		(
			await readFile(
				resolve(import.meta.dir, "../../chx/migrations", name),
				"utf8",
			)
		).replaceAll("rudel", upgraded);
	const sql = await read(SESSION_GIT_OBSERVATIONS_MIGRATION);
	const runIdsSql = await read(SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION);
	await executor.execute(`CREATE DATABASE ${upgraded}`);
	const journalExecutor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: upgraded,
	});
	const journalStore = createJournalStore(journalExecutor);
	for (const statement of extractExecutableStatements(sql))
		await executor.execute(statement);
	await journalStore.appendEntry({
		name: SESSION_GIT_OBSERVATIONS_MIGRATION,
		checksum: checksumSQL(sql),
		appliedAt: new Date().toISOString().replace("Z", ""),
	});
	await executor.execute(
		`INSERT INTO ${upgraded}.session_git_observations (organization_id, user_id, source, session_id, revision, parser_version, transcript_parser_version, agent_id, record_idx, block_idx, call_id, kind, label, ts) VALUES ('org', 'user', 'claude_code', 'legacy', 1, 517, 5, '', 3, 0, 'call', 'push_range', 'observed', now64(3))`,
	);
	const options = {
		executor,
		journalStore,
		migrationSql: sql,
		runIdsMigrationSql: runIdsSql,
		targetDatabase: upgraded,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
	};
	await runSessionGitObservationsMigration(options);
	await runSessionGitObservationsMigration(options);
	const rows = await executor.query<{ session_id: string; run_id: string }>(
		`SELECT session_id, run_id FROM ${upgraded}.session_git_observations`,
	);
	expect(rows).toEqual([{ session_id: "legacy", run_id: "" }]);
	const journal = (await journalStore.readJournal()).applied;
	const applied = journal.map((entry) => entry.name);
	expect(
		journal
			.filter((entry) => entry.name === SESSION_GIT_OBSERVATIONS_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(sql)]);
	expect(
		applied.filter(
			(name) => name === SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION,
		),
	).toHaveLength(1);
	await executor.execute(
		`ALTER TABLE ${upgraded}.session_git_observations MODIFY COLUMN run_id LowCardinality(String)`,
	);
	await expect(runSessionGitObservationsMigration(options)).rejects.toThrow(
		"schema mismatch",
	);
	await journalExecutor.close();
});

test("an interrupted upgrade is completed, and a wrong run_id is never journaled", async () => {
	const read = async (name: string) =>
		(
			await readFile(
				resolve(import.meta.dir, "../../chx/migrations", name),
				"utf8",
			)
		).replaceAll("rudel", interrupted);
	const sql = await read(SESSION_GIT_OBSERVATIONS_MIGRATION);
	const runIdsSql = await read(SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION);
	await executor.execute(`CREATE DATABASE ${interrupted}`);
	const journalExecutor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: interrupted,
	});
	const journalStore = createJournalStore(journalExecutor);
	for (const statement of extractExecutableStatements(sql))
		await executor.execute(statement);
	await journalStore.appendEntry({
		name: SESSION_GIT_OBSERVATIONS_MIGRATION,
		checksum: checksumSQL(sql),
		appliedAt: new Date().toISOString().replace("Z", ""),
	});
	const options = {
		executor,
		journalStore,
		migrationSql: sql,
		runIdsMigrationSql: runIdsSql,
		targetDatabase: interrupted,
		expectedEngine: "ReplacingMergeTree" as const,
		expectedStoragePolicy: "s3",
	};
	const runIdEntries = async () =>
		(await journalStore.readJournal()).applied.filter(
			(entry) => entry.name === SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION,
		);
	// A run_id of the wrong type already exists, so ADD COLUMN IF NOT EXISTS skips it.
	await executor.execute(
		`ALTER TABLE ${interrupted}.session_git_observations ADD COLUMN run_id LowCardinality(String)`,
	);
	await expect(runSessionGitObservationsMigration(options)).rejects.toThrow(
		"schema mismatch",
	);
	expect(await runIdEntries()).toHaveLength(0);
	// The right type with another comment, or with a default, is rejected too.
	const comment = /COMMENT '([^']*)'/u.exec(runIdsSql)?.[1] ?? "";
	expect(comment.length).toBeGreaterThan(0);
	for (const column of [
		"run_id String COMMENT 'another comment'",
		`run_id String DEFAULT 'none' COMMENT '${comment}'`,
	]) {
		await executor.execute(
			`ALTER TABLE ${interrupted}.session_git_observations DROP COLUMN run_id`,
		);
		await executor.execute(
			`ALTER TABLE ${interrupted}.session_git_observations ADD COLUMN ${column}`,
		);
		await expect(runSessionGitObservationsMigration(options)).rejects.toThrow(
			"schema mismatch",
		);
		expect(await runIdEntries()).toHaveLength(0);
	}
	// The additive DDL ran, but the run stopped before journaling it.
	await executor.execute(
		`ALTER TABLE ${interrupted}.session_git_observations DROP COLUMN run_id`,
	);
	for (const statement of extractExecutableStatements(runIdsSql))
		await executor.execute(statement);
	await runSessionGitObservationsMigration(options);
	await runSessionGitObservationsMigration(options);
	expect((await runIdEntries()).map((entry) => entry.checksum)).toEqual([
		checksumSQL(runIdsSql),
	]);
	await journalExecutor.close();
});
