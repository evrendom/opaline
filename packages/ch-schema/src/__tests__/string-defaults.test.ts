import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import type { ColumnDefinition } from "@chkit/core";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	runStringDefaultsMigration,
	STRING_DEFAULTS,
	STRING_DEFAULTS_MIGRATION,
	stringDefaultExpression,
	stringDefaultsStatements,
} from "../../scripts/migrate-string-defaults.js";

const sql = readFileSync(
	new URL(`../../chx/migrations/${STRING_DEFAULTS_MIGRATION}`, import.meta.url),
	"utf8",
);

interface Definition {
	kind: string;
	name: string;
	columns?: ColumnDefinition[];
}

async function sourceTables(): Promise<Definition[]> {
	const directory = new URL("../db/schema/", import.meta.url);
	const modules = await Promise.all(
		readdirSync(directory)
			.filter((file) => file.endsWith(".ts"))
			.map(
				(file) =>
					import(new URL(file, directory).href) as Promise<{
						default?: Definition[];
					}>,
			),
	);
	return modules.flatMap((module) =>
		(module.default ?? []).filter((definition) => definition.kind === "table"),
	);
}

describe("string defaults", () => {
	test("no schema column declares a string default as SQL: chkit quotes it again", async () => {
		const quoted = (await sourceTables()).flatMap((table) =>
			(table.columns ?? [])
				.filter(
					(column) =>
						typeof column.default === "string" &&
						!column.default.startsWith("fn:") &&
						(/^'.*'$/su.test(column.default) || column.default === "NULL"),
				)
				.map((column) => `${table.name}.${column.name}`),
		);
		expect(quoted).toEqual([]);
	});

	test("the migration sets each live column to its source default and nothing else", async () => {
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/u);
		const migrated = Object.fromEntries(
			stringDefaultsStatements(sql).map((statement) => {
				const table = /^ALTER TABLE rudel\.(\w+)\s/u.exec(statement)?.[1];
				const clauses = statement
					.replace(/^ALTER TABLE rudel\.\w+\s+/u, "")
					.split(/,\s*(?=MODIFY COLUMN)/u);
				return [
					table,
					Object.fromEntries(
						clauses.map((clause) => {
							const match = /^MODIFY COLUMN (\w+) DEFAULT '([^'\\]*)'$/u.exec(
								clause.trim().replace(/;$/u, ""),
							);
							if (!match) throw new Error(`unexpected clause: ${clause}`);
							return [match[1], match[2]];
						}),
					),
				];
			}),
		);
		expect(migrated).toEqual(STRING_DEFAULTS);

		const tables = await sourceTables();
		for (const [table, columns] of Object.entries(STRING_DEFAULTS))
			for (const [name, value] of Object.entries(columns))
				expect<unknown[]>([table, name, value]).toEqual([
					table,
					name,
					tables
						.find((definition) => definition.name === table)
						?.columns?.find((column) => column.name === name)?.default,
				]);
	});

	test("the snapshot holds the source's defaults", () => {
		const snapshot = JSON.parse(
			readFileSync(
				new URL("../../chx/meta/snapshot.json", import.meta.url),
				"utf8",
			),
		) as { definitions: Definition[] };
		for (const [table, columns] of Object.entries(STRING_DEFAULTS))
			for (const [name, value] of Object.entries(columns))
				expect<unknown[]>([table, name, value]).toEqual([
					table,
					name,
					snapshot.definitions
						.find((definition) => definition.name === table)
						?.columns?.find((column) => column.name === name)?.default,
				]);
	});

	test("ClickHouse reports a string default as a quoted literal", () => {
		expect(stringDefaultExpression("standard")).toBe("'standard'");
		expect(stringDefaultExpression("")).toBe("''");
		expect(stringDefaultExpression("it's")).toBe("'it\\'s'");
	});

	test("production and bootstrap apply the string defaults migration", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		expect(manifest.scripts["ch:migrate:production"]).toContain(
			"ch:migrate:string-defaults",
		);
		expect(manifest.scripts["ch:migrate:string-defaults"]).toBe(
			"bun scripts/migrate-string-defaults.ts",
		);
		expect(
			readFileSync(
				new URL("../../scripts/bootstrap.ts", import.meta.url),
				"utf8",
			),
		).toContain(
			`["${STRING_DEFAULTS_MIGRATION}", "migrate-string-defaults.ts"]`,
		);
	});
});

const QUOTED = "'\\'\\''";
const JOURNALED = {
	name: STRING_DEFAULTS_MIGRATION,
	checksum: checksumSQL(sql),
};

function cluster(
	revertedReads: number,
	journal: { name: string; checksum: string }[] = [],
	hosts = ["clickhouse-0", "clickhouse-1"],
) {
	let reads = 0;
	const executed: string[] = [];
	const executor = {
		execute: async (statement: string) => {
			executed.push(statement);
		},
		query: async (query: string) => {
			if (query.includes("system.clusters")) return [{ replicas: 2 }];
			reads++;
			return hosts.flatMap((host) =>
				Object.entries(STRING_DEFAULTS).flatMap(([table, columns]) =>
					Object.entries(columns).map(([name, value]) => ({
						host,
						table,
						name,
						default_kind: "DEFAULT",
						default_expression:
							host === "clickhouse-1" &&
							name === "model_used" &&
							reads <= revertedReads
								? QUOTED
								: stringDefaultExpression(value),
					})),
				),
			);
		},
	} as unknown as ClickHouseExecutor;
	const journalStore = {
		readJournal: async () => ({ applied: journal }),
		appendEntry: async (entry: { name: string; checksum: string }) => {
			journal.push(entry);
		},
	} as never;
	return { executor, journalStore, executed, journal, reads: () => reads };
}

const run = (
	state: ReturnType<typeof cluster>,
	attempts = 5,
	migrationSql = sql,
) =>
	runStringDefaultsMigration({
		executor: state.executor,
		journalStore: state.journalStore,
		migrationSql,
		targetDatabase: "rudel",
		readBack: { attempts, delayMs: 0 },
	});

describe("string defaults runner", () => {
	const statements = stringDefaultsStatements(sql).length;

	test("applies once and journals only after every replica serves the defaults", async () => {
		const state = cluster(2);
		await run(state);
		expect(state.executed).toHaveLength(statements);
		expect(state.reads()).toBe(3);
		expect(state.journal).toEqual([expect.objectContaining(JOURNALED)]);
	});

	test("fails without journaling when a replica keeps the quoted default", async () => {
		const state = cluster(Number.POSITIVE_INFINITY);
		await expect(run(state, 4)).rejects.toThrow(
			"String defaults mismatch: session_analytics.model_used on replica clickhouse-1",
		);
		expect(state.journal).toHaveLength(0);
		expect(state.executed).toHaveLength(statements * 2);
	});

	test("fails when a replica does not answer", async () => {
		const state = cluster(0, [], ["clickhouse-0"]);
		await expect(run(state, 1)).rejects.toThrow(
			"String defaults visible on 1 of 2 replicas",
		);
		expect(state.journal).toHaveLength(0);
	});

	test("re-applies a journaled migration whose defaults reverted, without journaling it again", async () => {
		const state = cluster(1, [JOURNALED]);
		await run(state);
		expect(state.executed).toHaveLength(statements);
		expect(state.journal).toHaveLength(1);
	});

	test("only checks a journaled migration whose defaults are current", async () => {
		const state = cluster(0, [JOURNALED]);
		await run(state);
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(1);
	});

	test("refuses a journaled migration whose SQL changed", async () => {
		const state = cluster(0, [
			{ name: STRING_DEFAULTS_MIGRATION, checksum: "other" },
		]);
		await expect(run(state)).rejects.toThrow("checksum mismatch");
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(0);
	});
});
