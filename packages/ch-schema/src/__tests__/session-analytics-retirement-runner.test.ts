import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	runSessionAnalyticsRetirementMigration,
	SESSION_ANALYTICS_RETIREMENT_MIGRATION,
} from "../../scripts/migrate-session-analytics-retirement.js";

const FRESH = "SELECT * EXCEPT (_dedupe_rank) FROM (SELECT 1 AS error_count)";
const STALE = `${FRESH}, 'standard' AS session_archetype`;
const SQL =
	"ALTER TABLE rudel.codex_session_analytics_mv MODIFY QUERY SELECT 1;\nALTER TABLE rudel.session_analytics_mv MODIFY QUERY SELECT 1;\n";
const JOURNALED = {
	name: SESSION_ANALYTICS_RETIREMENT_MIGRATION,
	checksum: checksumSQL(SQL),
};

/** Replica clickhouse-1 serves `stale` reads of the Codex view before the new query. */
function cluster(
	staleReads: number,
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
			return hosts.flatMap((host) => [
				{ host, name: "session_analytics_mv", as_select: FRESH },
				{
					host,
					name: "codex_session_analytics_mv",
					as_select:
						host === "clickhouse-1" && reads <= staleReads ? STALE : FRESH,
				},
			]);
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

describe("session analytics retirement runner", () => {
	test("waits for every replica to serve the new view queries before journaling", async () => {
		const state = cluster(2);
		await runSessionAnalyticsRetirementMigration({
			executor: state.executor,
			journalStore: state.journalStore,
			migrationSql: SQL,
			targetDatabase: "rudel",
			readBack: { attempts: 5, delayMs: 0 },
		});
		expect(state.reads()).toBe(3);
		expect(state.journal).toHaveLength(1);
	});

	test("fails without journaling when a view stays stale, after applying once more", async () => {
		const state = cluster(Number.POSITIVE_INFINITY);
		await expect(
			runSessionAnalyticsRetirementMigration({
				executor: state.executor,
				journalStore: state.journalStore,
				migrationSql: SQL,
				targetDatabase: "rudel",
				readBack: { attempts: 4, delayMs: 0 },
			}),
		).rejects.toThrow(
			"codex_session_analytics_mv on replica clickhouse-1: session_archetype",
		);
		expect(state.journal).toHaveLength(0);
		expect(state.executed).toHaveLength(4);
	});

	test("fails without journaling when a replica does not answer", async () => {
		const state = cluster(0, [], ["clickhouse-0"]);
		await expect(
			runSessionAnalyticsRetirementMigration({
				executor: state.executor,
				journalStore: state.journalStore,
				migrationSql: SQL,
				targetDatabase: "rudel",
				readBack: { attempts: 1, delayMs: 0 },
			}),
		).rejects.toThrow("session analytics views visible on 1 of 2 replicas");
		expect(state.journal).toHaveLength(0);
	});

	test("re-applies a journaled migration whose views reverted, without journaling it again", async () => {
		const state = cluster(2, [JOURNALED]);
		await runSessionAnalyticsRetirementMigration({
			executor: state.executor,
			journalStore: state.journalStore,
			migrationSql: SQL,
			targetDatabase: "rudel",
			readBack: { attempts: 5, delayMs: 0 },
		});
		expect(state.executed).toHaveLength(2);
		expect(state.reads()).toBe(3);
		expect(state.journal).toHaveLength(1);
	});

	test("re-applies a journaled migration again halfway when its views stay reverted", async () => {
		const state = cluster(Number.POSITIVE_INFINITY, [JOURNALED]);
		await expect(
			runSessionAnalyticsRetirementMigration({
				executor: state.executor,
				journalStore: state.journalStore,
				migrationSql: SQL,
				targetDatabase: "rudel",
				readBack: { attempts: 4, delayMs: 0 },
			}),
		).rejects.toThrow(
			"codex_session_analytics_mv on replica clickhouse-1: session_archetype",
		);
		expect(state.executed).toHaveLength(4);
		expect(state.journal).toHaveLength(1);
	});

	test("only checks a journaled migration whose views are current", async () => {
		const state = cluster(0, [JOURNALED]);
		await runSessionAnalyticsRetirementMigration({
			executor: state.executor,
			journalStore: state.journalStore,
			migrationSql: SQL,
			targetDatabase: "rudel",
			readBack: { attempts: 5, delayMs: 0 },
		});
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(1);
	});

	test("applies and journals an unjournaled migration once", async () => {
		const state = cluster(0);
		await runSessionAnalyticsRetirementMigration({
			executor: state.executor,
			journalStore: state.journalStore,
			migrationSql: SQL,
			targetDatabase: "rudel",
			readBack: { attempts: 5, delayMs: 0 },
		});
		expect(state.executed).toHaveLength(2);
		expect(state.reads()).toBe(1);
		expect(state.journal).toEqual([expect.objectContaining(JOURNALED)]);
	});

	test("refuses a journaled migration whose SQL changed", async () => {
		const state = cluster(Number.POSITIVE_INFINITY, [
			{ name: SESSION_ANALYTICS_RETIREMENT_MIGRATION, checksum: "other" },
		]);
		await expect(
			runSessionAnalyticsRetirementMigration({
				executor: state.executor,
				journalStore: state.journalStore,
				migrationSql: SQL,
				targetDatabase: "rudel",
				readBack: { attempts: 4, delayMs: 0 },
			}),
		).rejects.toThrow("checksum mismatch");
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(0);
	});
});
