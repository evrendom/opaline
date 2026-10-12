import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	NOT_FOUND_UNKNOWN_MIGRATION,
	notFoundUnknownVisible,
	runIndexNotFoundStatement,
	runNotFoundUnknownMigration,
	weeklyTotalsNotFoundStatement,
} from "../../scripts/migrate-not-found-unknown.js";
import { runIndexTable } from "../db/schema/run-index.js";
import { weeklyTotalsTable } from "../db/schema/weekly-totals.js";

const sql = readFileSync(
	new URL(
		`../../chx/migrations/${NOT_FOUND_UNKNOWN_MIGRATION}`,
		import.meta.url,
	),
	"utf8",
);
const columnsOf = (table: unknown) =>
	(table as { columns: { name: string; type: string; comment: string }[] })
		.columns;
const column = (table: unknown, name: string) => {
	const found = columnsOf(table).find((candidate) => candidate.name === name);
	if (!found) throw new Error(`no column ${name}`);
	return found;
};
/** The columns every replica must serve, as defined. */
const EXPECTED = [
	["run_index", column(runIndexTable, "not_found")],
	["run_index", column(runIndexTable, "repository")],
	["weekly_totals", column(weeklyTotalsTable, "not_found_known_runs")],
	["weekly_totals", column(weeklyTotalsTable, "not_found")],
] as const;
const rows = (hosts: string[]) =>
	hosts.flatMap((host) =>
		EXPECTED.map(([table, { name, type, comment }]) => ({
			host,
			table,
			name,
			type,
			comment,
		})),
	);
const view = (host: string) => ({
	host,
	create_table_query:
		"CREATE MATERIALIZED VIEW rudel.weekly_totals_mv REFRESH EVERY 1 DAY OFFSET 3 HOUR APPEND TO rudel.weekly_totals AS SELECT countIf(r.row_kind = 'run' AND NOT has(r.unrecorded_facts, 'not_found')) AS not_found_known_runs FROM rudel.run_index AS r FINAL",
});

describe("not-found migration", () => {
	test("changes only not_found, the repository comment and the weekly view, destroying no data", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements.map((statement) => statement.split("\n")[0])).toEqual([
			"ALTER TABLE rudel.run_index",
			"ALTER TABLE rudel.weekly_totals",
			"DROP VIEW IF EXISTS rudel.weekly_totals_mv;",
			"CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.weekly_totals_mv",
		]);
		expect(sql).not.toMatch(
			/\bDROP TABLE\b|\bDELETE\b|\bTRUNCATE\b|\bDROP COLUMN\b|\bUPDATE\b/u,
		);
		// The runners that check these tables bring the same definitions.
		const flat = (statement: string) => statement.replaceAll(/\s+/gu, " ");
		expect(flat(statements[0] ?? "")).toBe(
			`${flat(runIndexNotFoundStatement("rudel"))};`,
		);
		expect(flat(statements[1] ?? "")).toBe(
			`${flat(weeklyTotalsNotFoundStatement("rudel"))};`,
		);
		// Index 2 builds counted only failures with not-found text: not known.
		expect(statements[3]).toContain(
			"countIf(r.row_kind = 'run' AND r.index_version >= 3 AND NOT has(r.unrecorded_facts, 'not_found')) AS not_found_known_runs",
		);
		expect(statements[3]).toContain(
			"sumIf(r.not_found, r.row_kind = 'run' AND r.index_version >= 3 AND NOT has(r.unrecorded_facts, 'not_found')) AS not_found",
		);
		expect(column(runIndexTable, "not_found").type).toBe("Nullable(UInt32)");
		expect(column(weeklyTotalsTable, "not_found").type).toBe(
			"Nullable(UInt64)",
		);
	});

	test("the snapshot holds the changed columns", () => {
		const snapshot = JSON.parse(
			readFileSync(
				new URL("../../chx/meta/snapshot.json", import.meta.url),
				"utf8",
			),
		) as {
			definitions: {
				name: string;
				columns: { name: string; type: string; comment: string }[];
			}[];
		};
		for (const [table, expected] of EXPECTED)
			expect(
				snapshot.definitions
					.find((definition) => definition.name === table)
					?.columns.find((candidate) => candidate.name === expected.name),
			).toEqual(expected);
	});

	test("bootstrap delegates the migration to its runner", () => {
		expect(
			readFileSync(
				new URL("../../scripts/bootstrap.ts", import.meta.url),
				"utf8",
			),
		).toContain(
			'["20261012120000_not_found_unknown.sql", "migrate-not-found-unknown.ts"]',
		);
		expect(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		).toMatch(/ch:migrate:weekly-totals ch:migrate:not-found-unknown"/u);
	});

	test("publication proof rejects lagging replicas, old column types and the old view", () => {
		expect(
			notFoundUnknownVisible(rows(["a", "b"]), [view("a"), view("b")], 2),
		).toBe(true);
		expect(notFoundUnknownVisible(rows(["a"]), [view("a")], 2)).toBe(false);
		expect(
			notFoundUnknownVisible(
				rows(["a", "b"]).map((row) =>
					row.host === "b" &&
					row.table === "run_index" &&
					row.name === "not_found"
						? { ...row, type: "UInt32" }
						: row,
				),
				[view("a"), view("b")],
				2,
			),
		).toBe(false);
		expect(
			notFoundUnknownVisible(
				rows(["a", "b"]),
				[
					view("a"),
					{
						host: "b",
						create_table_query: view("b").create_table_query.replace(
							"AS not_found_known_runs",
							"AS n",
						),
					},
				],
				2,
			),
		).toBe(false);
		expect(notFoundUnknownVisible([], [], 1)).toBe(false);
	});

	test("applies the migration once and journals it after every replica serves it", async () => {
		const executed: string[] = [];
		const journal: { name: string; checksum: string }[] = [];
		let reads = 0;
		const executor = {
			execute: async (statement: string) => {
				executed.push(statement);
			},
			query: async (query: string) => {
				if (query.includes("system.clusters")) return [{ replicas: 2 }];
				if (query.includes("system.columns")) {
					reads++;
					// Replica b lags on the first read.
					return rows(reads === 1 ? ["a"] : ["a", "b"]);
				}
				return [view("a"), view("b")];
			},
		} as unknown as ClickHouseExecutor;
		const journalStore = {
			readJournal: async () => ({ applied: journal }),
			appendEntry: async (entry: { name: string; checksum: string }) => {
				journal.push(entry);
			},
		} as never;
		const run = () =>
			runNotFoundUnknownMigration({
				executor,
				journalStore,
				migrationSql: sql,
				targetDatabase: "rudel",
				readBack: { attempts: 3, delayMs: 0 },
			});
		await run();
		await run();
		expect(executed).toEqual(extractExecutableStatements(sql));
		expect(reads).toBe(3);
		expect(journal).toEqual([
			expect.objectContaining({
				name: NOT_FOUND_UNKNOWN_MIGRATION,
				checksum: checksumSQL(sql),
			}),
		]);
		await expect(
			runNotFoundUnknownMigration({
				executor,
				journalStore,
				migrationSql: `${sql}\nSELECT 1;\n`,
				targetDatabase: "rudel",
			}),
		).rejects.toThrow("checksum mismatch");
	});
});
