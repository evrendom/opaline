import { expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { runDeletedRowsCleanup } from "./deleted-rows-cleanup.service.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function fakeClickHouse(state: {
	parts: { table: string; physical: number; bytes: number }[];
	live: Record<string, number>;
	running?: string[];
	free?: number;
}) {
	const executed: string[] = [];
	const executor = {
		async close() {},
		async insert() {},
		async execute(statement: ClickHouseStatement) {
			executed.push(statement.query);
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			const sql = statement.query;
			if (sql.includes("FROM system.parts")) return state.parts as T[];
			if (sql.includes("FROM system.mutations"))
				return (state.running ?? []).map((table) => ({ table })) as T[];
			if (sql.includes("FROM system.disks"))
				return [{ free: state.free ?? 100 * GIB }] as T[];
			const table = /FROM rudel\.(\w+)/u.exec(sql)?.[1] ?? "";
			return [{ live: state.live[table] }] as T[];
		},
	} satisfies ClickHouseExecutor;
	return { executor, executed };
}

test("the table with the most deleted bytes is rewritten, one per run", async () => {
	const { executor, executed } = fakeClickHouse({
		parts: [
			{ table: "transcript_records", physical: 1_000, bytes: 900 * MIB },
			{ table: "call_facts", physical: 1_000, bytes: 80 * MIB },
		],
		live: { transcript_records: 300, call_facts: 300 },
	});
	const result = await runDeletedRowsCleanup({ executor });
	expect(result.status).toBe("applied");
	expect(result.table?.table).toBe("transcript_records");
	expect(executed).toEqual([
		"ALTER TABLE rudel.transcript_records APPLY DELETED MASK",
	]);
});

test("a few deleted rows, or too few deleted bytes, are left for later", async () => {
	const { executor, executed } = fakeClickHouse({
		parts: [
			{ table: "transcript_records", physical: 1_000, bytes: 900 * MIB },
			{ table: "run_index", physical: 1_000, bytes: 20 * MIB },
		],
		live: { transcript_records: 900, run_index: 100 },
	});
	expect(await runDeletedRowsCleanup({ executor })).toEqual({
		status: "nothing",
		table: null,
	});
	expect(executed).toEqual([]);
});

test("a table with a mutation still running is skipped", async () => {
	const { executor, executed } = fakeClickHouse({
		parts: [{ table: "call_facts", physical: 1_000, bytes: 900 * MIB }],
		live: { call_facts: 100 },
		running: ["call_facts"],
	});
	expect((await runDeletedRowsCleanup({ executor })).status).toBe("busy");
	expect(executed).toEqual([]);
});

test("nothing is rewritten when the copy would leave the disk nearly full", async () => {
	const { executor, executed } = fakeClickHouse({
		parts: [{ table: "call_facts", physical: 1_000, bytes: 900 * MIB }],
		live: { call_facts: 500 },
		free: 2 * GIB,
	});
	const result = await runDeletedRowsCleanup({ executor });
	expect(result.status).toBe("no_room");
	expect(executed).toEqual([]);
});
