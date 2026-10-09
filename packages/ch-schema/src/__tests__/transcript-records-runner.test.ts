import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import { runTranscriptRecordsMigration } from "../../scripts/migrate-transcript-records.js";
import transcriptRecordsSchema from "../db/schema/transcript-records.js";

type Column = {
	name: string;
	type: string;
	nullable?: boolean;
	comment?: string;
};

const columns = (
	transcriptRecordsSchema as unknown as { columns: Column[] }[]
)[0]?.columns.map((column) => ({
	name: column.name,
	type: column.nullable ? `Nullable(${column.type})` : column.type,
	comment: column.comment ?? "",
	default_kind: "",
	compression_codec:
		column.name === "facts" || column.name === "text" ? "CODEC(ZSTD(3))" : "",
}));
const CURRENT = columns ?? [];
const STALE = CURRENT.slice(
	0,
	CURRENT.findIndex((column) => column.name === "agent_version"),
);

/**
 * A server that serves the table without the fact columns for its first
 * `staleReads` reads.
 */
function server(staleReads: number) {
	let reads = 0;
	const queries: string[] = [];
	const journal: { name: string; checksum: string }[] = [];
	const executor = {
		execute: async () => {},
		query: async (sql: string) => {
			queries.push(sql);
			reads++;
			return reads <= staleReads ? STALE : CURRENT;
		},
	} as unknown as ClickHouseExecutor;
	const journalStore = {
		readJournal: async () => ({ applied: journal }),
		appendEntry: async (entry: { name: string; checksum: string }) => {
			journal.push(entry);
		},
	} as never;
	const run = () =>
		runTranscriptRecordsMigration({
			executor,
			journalStore,
			migrationSql: "SELECT 1;",
			factsMigrationSql: "SELECT 2;",
			targetDatabase: "rudel",
			readBack: { attempts: 3, delayMs: 0 },
		});
	return { run, journal, queries, reads: () => reads };
}

describe("transcript records runner", () => {
	test("waits until the fact columns read back before journaling", async () => {
		const state = server(1);
		await state.run();
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(2);
	});

	test("fails without journaling while the fact columns stay missing", async () => {
		const state = server(Number.POSITIVE_INFINITY);
		await expect(state.run()).rejects.toThrow(
			"fact columns mismatch: agent_version",
		);
		expect(state.journal).toHaveLength(0);
	});

	// The production migration user lacks SELECT(cluster) ON system.clusters.
	test("reads only system.columns", async () => {
		const state = server(0);
		await state.run();
		expect(state.journal).toHaveLength(2);
		expect(
			state.queries.every(
				(sql) =>
					sql.includes("FROM system.columns") &&
					!sql.includes("system.clusters") &&
					!sql.includes("clusterAllReplicas"),
			),
		).toBe(true);
	});
});
