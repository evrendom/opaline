import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	runSessionAnalyticsRetirementMigration,
	SESSION_ANALYTICS_RETIREMENT_MIGRATION,
} from "../../scripts/migrate-session-analytics-retirement.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { RETIRED_SESSION_ANALYTICS_COLUMNS } from "../session-analytics-mv.js";
import { createTestExecutor } from "./helpers/executor.js";

setDefaultTimeout(180_000);

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createTestExecutor();
const database = `opaline_retirement_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

const migrations = (name: string) =>
	readFile(resolve(import.meta.dir, "../../chx/migrations", name), "utf8");

test("both views stop writing retired interpretations in place: live columns are unchanged and the step is journaled once", async () => {
	await executor.execute(`CREATE DATABASE ${database}`);
	for (const table of [
		"claude_sessions",
		"codex_sessions",
		"session_analytics",
	]) {
		const [created] = await executor.query<{ statement: string }>(
			`SHOW CREATE TABLE rudel.${table}`,
		);
		if (!created) throw new Error(`rudel.${table} is missing`);
		await executor.execute(
			created.statement.replace(`rudel.${table}`, `${database}.${table}`),
		);
	}
	// The deployed view: the product launch query, which still writes them.
	const deployed = extractExecutableStatements(
		await migrations("20260913190000_product_launch.sql"),
	).find((statement) =>
		statement.startsWith(
			"ALTER TABLE rudel.codex_session_analytics_mv MODIFY QUERY",
		),
	);
	if (!deployed) throw new Error("deployed Codex view query not found");
	await executor.execute(
		`CREATE MATERIALIZED VIEW ${database}.codex_session_analytics_mv TO ${database}.session_analytics AS ${deployed
			.replace("ALTER TABLE rudel.codex_session_analytics_mv MODIFY QUERY", "")
			.replaceAll("rudel.", `${database}.`)}`,
	);
	// Only the Codex view is exercised with rows; the Claude one is replaced too.
	await executor.execute(
		`CREATE MATERIALIZED VIEW ${database}.session_analytics_mv TO ${database}.session_analytics AS SELECT session_id, organization_id FROM ${database}.claude_sessions WHERE 0`,
	);

	const content = await readFile(
		resolve(import.meta.dir, "fixtures/codex-session-with-errors.jsonl"),
		"utf8",
	);
	const insert = async (revision: string) =>
		executor.insert({
			table: `${database}.codex_sessions`,
			values: [
				{
					session_date: "2026-10-08 10:00:00.000",
					last_interaction_date: "2026-10-08 10:00:00.000",
					session_id: "retirement",
					organization_id: "org",
					project_path: "/repo",
					git_remote: "github.com/opalinehq/athena",
					package_name: "",
					package_type: "",
					content,
					filter_version: 0,
					revision,
					ingested_at: "2026-10-08 10:00:00.000",
					user_id: "user",
					git_branch: "main",
					git_sha: "a".repeat(40),
					tag: "",
				},
			],
		});
	const read = async (revision: string) => {
		const [row] = await executor.query<Record<string, unknown>>(
			`SELECT * FROM ${database}.session_analytics WHERE session_id = 'retirement' AND revision = ${Number(revision)}`,
		);
		if (!row) throw new Error(`revision ${revision} not written`);
		return row;
	};
	await insert("1");
	const before = await read("1");
	expect(before.has_commit).toBe(1);
	expect(before.error_pattern).not.toBe("");

	const migrationSql = (
		await migrations(SESSION_ANALYTICS_RETIREMENT_MIGRATION)
	).replaceAll("rudel.", `${database}.`);
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
		migrationSql,
		targetDatabase: database,
	};
	await runSessionAnalyticsRetirementMigration(options);
	await runSessionAnalyticsRetirementMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === SESSION_ANALYTICS_RETIREMENT_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(migrationSql)]);

	await insert("2");
	const after = await read("2");
	// The columns' defaults; chkit wrote the two string ones with doubled
	// quotes, so they are the literal texts `'standard'` and `''`.
	for (const column of RETIRED_SESSION_ANALYTICS_COLUMNS)
		expect([column, after[column]]).toEqual([
			column,
			column === "session_archetype"
				? "'standard'"
				: column === "error_pattern"
					? "''"
					: 0,
		]);
	for (const column of [
		"error_count",
		"total_tokens",
		"total_interactions",
		"actual_duration_min",
		"skills",
		"model_used",
		"subagent_count",
	])
		expect([column, after[column]]).toEqual([column, before[column]]);

	await expect(
		runSessionAnalyticsRetirementMigration({
			...options,
			migrationSql: `${migrationSql}\nSELECT 1;\n`,
		}),
	).rejects.toThrow("checksum mismatch");
	await journalExecutor.close();
});
