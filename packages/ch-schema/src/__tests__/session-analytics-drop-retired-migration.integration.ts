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
	runSessionAnalyticsDropRetiredMigration,
	SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
} from "../../scripts/migrate-session-analytics-drop-retired.js";
import {
	runSessionAnalyticsRetirementMigration,
	SESSION_ANALYTICS_RETIREMENT_MIGRATION,
} from "../../scripts/migrate-session-analytics-retirement.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { DROPPED_SESSION_ANALYTICS_COLUMNS } from "../session-analytics-mv.js";
import { createTestExecutor } from "./helpers/executor.js";

setDefaultTimeout(180_000);

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createTestExecutor();
const database = `opaline_drop_retired_${Date.now()}`;
const journalExecutor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database,
});
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await journalExecutor.close();
	await executor.close();
});

const migration = async (name: string) =>
	(
		await readFile(
			resolve(import.meta.dir, "../../chx/migrations", name),
			"utf8",
		)
	).replaceAll("rudel.", `${database}.`);

const droppedColumnsLeft = async () =>
	(
		await executor.query<{ name: string }>(
			`SELECT name FROM system.columns WHERE database = '${database}' AND table = 'session_analytics' AND name IN (${DROPPED_SESSION_ANALYTICS_COLUMNS.map((name) => `'${name}'`).join(", ")}) ORDER BY name`,
		)
	).map((row) => row.name);

test("drops the retired columns only after the views stop naming them, journals once, and drops them again if they come back", async () => {
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
	await executor.execute(
		`ALTER TABLE ${database}.session_analytics ADD COLUMN error_pattern LowCardinality(String) DEFAULT '', ADD COLUMN session_archetype String DEFAULT 'standard'`,
	);
	// A reverted Codex view: the product launch query still writes both columns.
	const reverted = extractExecutableStatements(
		await migration("20260913190000_product_launch.sql"),
	).find((statement) =>
		statement.startsWith(
			`ALTER TABLE ${database}.codex_session_analytics_mv MODIFY QUERY`,
		),
	);
	if (!reverted) throw new Error("reverted Codex view query not found");
	await executor.execute(
		`CREATE MATERIALIZED VIEW ${database}.codex_session_analytics_mv TO ${database}.session_analytics AS ${reverted.replace(
			`ALTER TABLE ${database}.codex_session_analytics_mv MODIFY QUERY`,
			"",
		)}`,
	);
	await executor.execute(
		`CREATE MATERIALIZED VIEW ${database}.session_analytics_mv TO ${database}.session_analytics AS SELECT session_id, organization_id FROM ${database}.claude_sessions WHERE 0`,
	);

	const journalStore = createJournalStore(journalExecutor);
	const dropOptions = {
		executor,
		journalStore,
		migrationSql: await migration(SESSION_ANALYTICS_DROP_RETIRED_MIGRATION),
		targetDatabase: database,
		readBack: { attempts: 1, delayMs: 0 },
	};
	await expect(
		runSessionAnalyticsDropRetiredMigration(dropOptions),
	).rejects.toThrow("Refusing to drop");
	expect(await droppedColumnsLeft()).toEqual([
		"error_pattern",
		"session_archetype",
	]);

	await runSessionAnalyticsRetirementMigration({
		executor,
		journalStore,
		migrationSql: await migration(SESSION_ANALYTICS_RETIREMENT_MIGRATION),
		targetDatabase: database,
	});
	await runSessionAnalyticsDropRetiredMigration(dropOptions);
	await runSessionAnalyticsDropRetiredMigration(dropOptions);
	expect(await droppedColumnsLeft()).toEqual([]);
	expect(
		(await journalStore.readJournal()).applied
			.filter(
				(entry) => entry.name === SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
			)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(dropOptions.migrationSql)]);

	await executor.insert({
		table: `${database}.codex_sessions`,
		values: [
			{
				session_date: "2026-11-07 10:00:00.000",
				last_interaction_date: "2026-11-07 10:00:00.000",
				session_id: "dropped",
				organization_id: "org",
				project_path: "/repo",
				git_remote: "github.com/opalinehq/athena",
				package_name: "",
				package_type: "",
				content: await readFile(
					resolve(import.meta.dir, "fixtures/codex-session-with-errors.jsonl"),
					"utf8",
				),
				filter_version: 0,
				revision: "1",
				ingested_at: "2026-11-07 10:00:00.000",
				user_id: "user",
				git_branch: "main",
				git_sha: "a".repeat(40),
				tag: "",
			},
		],
	});
	const [written] = await executor.query<{ rows: string }>(
		`SELECT count() AS rows FROM ${database}.session_analytics WHERE session_id = 'dropped'`,
	);
	expect(Number(written?.rows)).toBe(1);

	await executor.execute(
		`ALTER TABLE ${database}.session_analytics ADD COLUMN session_archetype String DEFAULT 'standard'`,
	);
	await runSessionAnalyticsDropRetiredMigration(dropOptions);
	expect(await droppedColumnsLeft()).toEqual([]);
	expect(
		(await journalStore.readJournal()).applied.filter(
			(entry) => entry.name === SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
		),
	).toHaveLength(1);
});
