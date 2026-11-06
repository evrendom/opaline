import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	runStringDefaultsMigration,
	STRING_DEFAULTS,
	STRING_DEFAULTS_MIGRATION,
} from "../../scripts/migrate-string-defaults.js";
import { repairOrganization } from "../../scripts/repair-string-defaults.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { createTestExecutor } from "./helpers/executor.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const credentials = {
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
};
const executor = createTestExecutor();
const database = `opaline_string_defaults_${Date.now()}`;
beforeAll(async () => {
	await executor.execute(`CREATE DATABASE ${database}`);
});
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${database}`);
	await executor.close();
});

test("stores the intended strings for omitted columns, journals once, and re-applies a reverted default", async () => {
	const journalStore = createJournalStore(
		createClickHouseExecutor({ ...credentials, database }),
	);
	for (const [table, columns] of Object.entries(STRING_DEFAULTS))
		await executor.execute(
			`CREATE TABLE ${database}.${table} (session_id String, ${Object.entries(
				columns,
			)
				.map(
					([name, value]) =>
						`${name} String DEFAULT '${value === "" ? "''''" : `''${value}''`}'`,
				)
				.join(", ")}) ENGINE = MergeTree ORDER BY session_id`,
		);
	await executor.insert({
		table: `${database}.session_analytics`,
		values: [{ session_id: "before" }],
	});

	const migrationSql = (
		await readFile(
			resolve(
				import.meta.dir,
				"../../chx/migrations",
				STRING_DEFAULTS_MIGRATION,
			),
			"utf8",
		)
	).replaceAll("rudel.", `${database}.`);
	const options = {
		executor,
		journalStore,
		migrationSql,
		targetDatabase: database,
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runStringDefaultsMigration(options);
	await runStringDefaultsMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === STRING_DEFAULTS_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(migrationSql)]);

	await executor.insert({
		table: `${database}.session_analytics`,
		values: [{ session_id: "after" }],
	});
	const rows = await executor.query<Record<string, string>>(
		`SELECT * FROM ${database}.session_analytics ORDER BY session_id`,
	);
	expect(rows.find((row) => row.session_id === "after")).toEqual({
		session_id: "after",
		...STRING_DEFAULTS.session_analytics,
	});
	expect(
		rows.find((row) => row.session_id === "before")?.session_archetype,
	).toBe("'standard'");

	await executor.execute(
		`ALTER TABLE ${database}.claude_sessions MODIFY COLUMN git_remote DEFAULT '\\'\\''`,
	);
	await runStringDefaultsMigration(options);
	const [reapplied] = await executor.query<{ default_expression: string }>(
		`SELECT default_expression FROM system.columns WHERE database = '${database}' AND table = 'claude_sessions' AND name = 'git_remote'`,
	);
	expect(reapplied?.default_expression).toBe("''");
});

test("the repair rewrites an affected row at its revision and leaves other rows alone", async () => {
	const [created] = await executor.query<{ statement: string }>(
		"SHOW CREATE TABLE rudel.session_analytics",
	);
	if (!created) throw new Error("rudel.session_analytics is missing");
	const table = `${database}.session_analytics_repair`;
	await executor.execute(
		created.statement.replace("rudel.session_analytics", table),
	);
	const row = (sessionId: string, archetype: string, errorPattern: string) => ({
		session_date: "2026-11-01 10:00:00.000",
		last_interaction_date: "2026-11-01 10:30:00.000",
		session_id: sessionId,
		organization_id: "org_repair",
		project_path: "/repo",
		git_remote: "github.com/opalinehq/athena",
		revision: "115807295561596928",
		ingested_at: "2026-11-01 10:31:00.000",
		user_id: "user",
		git_branch: null,
		source: "codex",
		skills: ["a"],
		native_subagents: [["explorer", "find files"]],
		total_tokens: "123456789012",
		avg_period_sec: 0.1,
		model_used: "gpt",
		session_archetype: archetype,
		error_pattern: errorPattern,
	});
	await executor.insert({
		table,
		values: [
			row("affected", "'standard'", "''"),
			row("classified", "deep_work", "TimeoutError"),
		],
	});
	const read = () =>
		executor.query<Record<string, unknown>>(
			`SELECT * FROM ${table} FINAL ORDER BY session_id`,
		);
	const before = await read();

	expect(await repairOrganization(executor, "org_repair", 10, table)).toBe(1);
	expect(await repairOrganization(executor, "org_repair", 10, table)).toBe(0);

	const after = await read();
	expect(after).toHaveLength(2);
	expect(after.find((r) => r.session_id === "affected")).toEqual({
		...before.find((r) => r.session_id === "affected"),
		session_archetype: "standard",
		error_pattern: "",
	});
	expect(after.find((r) => r.session_id === "classified")).toEqual(
		before.find((r) => r.session_id === "classified"),
	);
});
