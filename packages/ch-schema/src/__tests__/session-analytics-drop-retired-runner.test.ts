import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL } from "chkit/dist/bin/lib.js";
import {
	runSessionAnalyticsDropRetiredMigration,
	SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
} from "../../scripts/migrate-session-analytics-drop-retired.js";
import { DROPPED_SESSION_ANALYTICS_COLUMNS } from "../session-analytics-mv.js";

const sql = readFileSync(
	new URL(
		`../../chx/migrations/${SESSION_ANALYTICS_DROP_RETIRED_MIGRATION}`,
		import.meta.url,
	),
	"utf8",
);
const JOURNALED = {
	name: SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
	checksum: checksumSQL(sql),
};
const FRESH = "SELECT * EXCEPT (_dedupe_rank) FROM (SELECT 1 AS error_count)";
const STALE = `${FRESH}, 'standard' AS session_archetype`;

/**
 * Replica clickhouse-1 serves the dropped columns for `presentReads` column
 * reads, and the old Codex view query when `staleView` is set. Only `hosts`
 * answer the column reads.
 */
function cluster(
	presentReads: number,
	options: {
		journal?: { name: string; checksum: string }[];
		hosts?: string[];
		staleView?: boolean;
	} = {},
) {
	const journal = options.journal ?? [];
	const replicas = ["clickhouse-0", "clickhouse-1"];
	const hosts = options.hosts ?? replicas;
	let reads = 0;
	const executed: string[] = [];
	const executor = {
		execute: async (statement: string) => {
			executed.push(statement);
		},
		query: async (query: string) => {
			if (query.includes("system.clusters")) return [{ replicas: 2 }];
			if (query.includes("system.tables"))
				return replicas.flatMap((host) => [
					{ host, name: "session_analytics_mv", as_select: FRESH },
					{
						host,
						name: "codex_session_analytics_mv",
						as_select:
							host === "clickhouse-1" && options.staleView ? STALE : FRESH,
					},
				]);
			reads++;
			return hosts.flatMap((host) => [
				{ host, name: "session_id" },
				...(host === "clickhouse-1" && reads <= presentReads
					? DROPPED_SESSION_ANALYTICS_COLUMNS.map((name) => ({ host, name }))
					: []),
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

const run = (state: ReturnType<typeof cluster>, attempts = 5) =>
	runSessionAnalyticsDropRetiredMigration({
		executor: state.executor,
		journalStore: state.journalStore,
		migrationSql: sql,
		targetDatabase: "rudel",
		readBack: { attempts, delayMs: 0 },
	});

describe("session analytics drop retired migration", () => {
	test("drops exactly the dropped columns, idempotently", () => {
		expect(
			[...sql.matchAll(/DROP COLUMN IF EXISTS (\w+)/gu)].map(
				(match) => match[1],
			),
		).toEqual([...DROPPED_SESSION_ANALYTICS_COLUMNS]);
	});

	test("bootstrap applies it", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		expect(manifest.scripts["ch:migrate:session-analytics-drop-retired"]).toBe(
			"bun scripts/migrate-session-analytics-drop-retired.ts",
		);
		expect(
			readFileSync(
				new URL("../../scripts/bootstrap.ts", import.meta.url),
				"utf8",
			),
		).toContain(
			`"${SESSION_ANALYTICS_DROP_RETIRED_MIGRATION}",\n\t\t"migrate-session-analytics-drop-retired.ts",`,
		);
	});
});

describe("session analytics drop retired runner", () => {
	test("drops once and journals only after every replica serves the table without the columns", async () => {
		const state = cluster(2);
		await run(state);
		expect(state.executed).toHaveLength(1);
		expect(state.reads()).toBe(3);
		expect(state.journal).toEqual([expect.objectContaining(JOURNALED)]);
	});

	test("refuses to drop while a replica's view still names a retired column", async () => {
		const state = cluster(Number.POSITIVE_INFINITY, { staleView: true });
		await expect(run(state)).rejects.toThrow(
			"codex_session_analytics_mv on replica clickhouse-1: session_archetype",
		);
		expect(state.executed).toHaveLength(0);
		expect(state.journal).toHaveLength(0);
	});

	test("fails without journaling when a replica keeps the columns, after dropping once more", async () => {
		const state = cluster(Number.POSITIVE_INFINITY);
		await expect(run(state, 4)).rejects.toThrow(
			"Retired session analytics columns still present: error_pattern on replica clickhouse-1, session_archetype on replica clickhouse-1",
		);
		expect(state.executed).toHaveLength(2);
		expect(state.journal).toHaveLength(0);
	});

	test("fails when a replica does not answer", async () => {
		const state = cluster(0, { hosts: ["clickhouse-0"] });
		await expect(run(state, 1)).rejects.toThrow(
			"session_analytics visible on 1 of 2 replicas",
		);
		expect(state.journal).toHaveLength(0);
	});

	test("drops again when a journaled migration's columns came back, without journaling it again", async () => {
		const state = cluster(1, { journal: [JOURNALED] });
		await run(state);
		expect(state.executed).toHaveLength(1);
		expect(state.journal).toHaveLength(1);
	});

	test("only checks a journaled migration whose columns are gone", async () => {
		const state = cluster(0, { journal: [JOURNALED] });
		await run(state);
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(1);
	});

	test("refuses a journaled migration whose SQL changed", async () => {
		const state = cluster(0, {
			journal: [
				{ name: SESSION_ANALYTICS_DROP_RETIRED_MIGRATION, checksum: "other" },
			],
		});
		await expect(run(state)).rejects.toThrow("checksum mismatch");
		expect(state.executed).toHaveLength(0);
		expect(state.reads()).toBe(0);
	});
});
