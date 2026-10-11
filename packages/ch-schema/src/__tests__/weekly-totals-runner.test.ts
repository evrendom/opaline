import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	runWeeklyTotalsMigration,
	WEEKLY_TOTALS_MIGRATION,
	WEEKLY_TOTALS_REFRESH,
} from "../../scripts/migrate-weekly-totals.js";
import { weeklyTotalsTable } from "../db/schema/weekly-totals.js";

const TABLE = weeklyTotalsTable as unknown as {
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	comment: string;
};
const KEY = TABLE.orderBy.join(", ");
const SQL = "CREATE TABLE t (a UInt8) ENGINE = Memory;\nSELECT 1;\n";

function tableRow(engine: string) {
	return {
		name: "weekly_totals",
		engine: engine.split("(", 1)[0],
		engine_full: `${engine} PARTITION BY toDate(refreshed_at) PRIMARY KEY (${KEY}) ORDER BY (${KEY}) TTL toDateTime(refreshed_at) + toIntervalDay(14) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 's3'`,
		sorting_key: KEY,
		primary_key: KEY,
		partition_key: "toDate(refreshed_at)",
		storage_policy: "s3",
		comment: TABLE.comment,
		create_table_query: "",
	};
}

function viewRow(refresh: string) {
	return {
		name: "weekly_totals_mv",
		engine: "MaterializedView",
		engine_full: "",
		sorting_key: "",
		primary_key: "",
		partition_key: "",
		storage_policy: "",
		comment: "",
		create_table_query: `CREATE MATERIALIZED VIEW rudel.weekly_totals_mv ${refresh} TO rudel.weekly_totals (\`refreshed_at\` DateTime64(6, 'UTC')) AS SELECT 1 FROM rudel.run_index AS r FINAL`,
	};
}

/**
 * An endpoint whose view appears only after `viewLag` reads (DDL reaching
 * the replica the endpoint routes to), with the given table engine and
 * view refresh clause.
 */
function server(
	options: {
		viewLag?: number;
		engine?: string;
		refresh?: string;
		journal?: { name: string; checksum: string }[];
	} = {},
) {
	let reads = 0;
	const executed: string[] = [];
	const journal = options.journal ?? [];
	const executor = {
		execute: async (statement: string) => {
			executed.push(statement);
		},
		query: async (query: string) => {
			if (query.includes("system.columns"))
				return TABLE.columns.map((column) => ({
					...column,
					default_kind: "",
				}));
			reads++;
			return [
				tableRow(options.engine ?? "MergeTree"),
				...(reads > (options.viewLag ?? 0)
					? [viewRow(options.refresh ?? WEEKLY_TOTALS_REFRESH)]
					: []),
			];
		},
	} as unknown as ClickHouseExecutor;
	const journalStore = {
		readJournal: async () => ({ applied: journal }),
		appendEntry: async (entry: { name: string; checksum: string }) => {
			journal.push(entry);
		},
	} as never;
	const run = (expectedEngine: "MergeTree" | "SharedMergeTree" = "MergeTree") =>
		runWeeklyTotalsMigration({
			executor,
			journalStore,
			migrationSql: SQL,
			targetDatabase: "rudel",
			expectedEngine,
			expectedStoragePolicy: "s3",
			readBack: { attempts: 3, delayMs: 0 },
		});
	return { run, journal, executed, reads: () => reads };
}

describe("weekly totals runner", () => {
	test("applies the migration once and journals it after the read-back", async () => {
		const state = server();
		await state.run();
		await state.run();
		expect(state.executed).toEqual([
			"CREATE TABLE t (a UInt8) ENGINE = Memory;",
			"SELECT 1;",
		]);
		expect(state.journal).toEqual([
			expect.objectContaining({
				name: WEEKLY_TOTALS_MIGRATION,
				checksum: checksumSQL(SQL),
			}),
		]);
	});

	test("waits for a view that has not reached the endpoint yet", async () => {
		const state = server({ viewLag: 1 });
		await state.run();
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(1);
	});

	test("accepts the shared engine production converts the table to", async () => {
		await server({
			engine:
				"SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')",
		}).run("SharedMergeTree");
		await server({ engine: "SharedMergeTree" }).run("SharedMergeTree");
	});

	test("refuses a view that replaces the table instead of appending", async () => {
		const state = server({ refresh: "REFRESH EVERY 1 DAY OFFSET 3 HOUR" });
		await expect(state.run()).rejects.toThrow("Weekly totals view mismatch");
		expect(state.journal).toHaveLength(0);
	});

	test("refuses a journal entry with another checksum", async () => {
		const state = server({
			journal: [{ name: WEEKLY_TOTALS_MIGRATION, checksum: "other" }],
		});
		await expect(state.run()).rejects.toThrow("checksum mismatch");
		expect(state.executed).toEqual([]);
	});
});
