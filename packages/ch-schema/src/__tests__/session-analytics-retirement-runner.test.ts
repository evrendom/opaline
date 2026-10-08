import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { runSessionAnalyticsRetirementMigration } from "../../scripts/migrate-session-analytics-retirement.js";

const FRESH = "SELECT * EXCEPT (_dedupe_rank) FROM (SELECT 1 AS error_count)";
const STALE = `${FRESH}, 'standard' AS session_archetype`;
const SQL =
	"ALTER TABLE rudel.codex_session_analytics_mv MODIFY QUERY SELECT 1;\nALTER TABLE rudel.session_analytics_mv MODIFY QUERY SELECT 1;\n";

/** A replica that serves `stale` reads of the Codex view before the new query. */
function cluster(staleReads: number) {
	let reads = 0;
	const executed: string[] = [];
	const journal: { name: string; checksum: string }[] = [];
	const executor = {
		execute: async (statement: string) => {
			executed.push(statement);
		},
		query: async () => {
			reads++;
			return [
				{ name: "session_analytics_mv", as_select: FRESH },
				{
					name: "codex_session_analytics_mv",
					as_select: reads <= staleReads ? STALE : FRESH,
				},
			];
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
		).rejects.toThrow("codex_session_analytics_mv: session_archetype");
		expect(state.journal).toHaveLength(0);
		expect(state.executed).toHaveLength(4);
	});
});
