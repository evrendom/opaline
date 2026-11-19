import type { ClickHouseExecutor } from "../clickhouse.js";

const DATABASE = "rudel";
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export interface DeletedRowsCleanupOptions {
	readonly executor: ClickHouseExecutor;
	readonly minDeadShare?: number;
	readonly minDeadBytes?: number;
	readonly minFreeBytesAfter?: number;
}

export interface DeletedRowsTable {
	readonly table: string;
	readonly physicalRows: number;
	readonly liveRows: number;
	readonly bytes: number;
	readonly deadBytes: number;
}

export type DeletedRowsCleanup =
	| { readonly status: "applied"; readonly table: DeletedRowsTable }
	| {
			readonly status: "nothing" | "busy" | "no_room";
			readonly table: DeletedRowsTable | null;
	  };

interface PartRow {
	table: string;
	physical: string | number;
	bytes: string | number;
}

export async function runDeletedRowsCleanup({
	executor,
	minDeadShare = 0.25,
	minDeadBytes = 64 * MIB,
	minFreeBytesAfter = 2 * GIB,
}: DeletedRowsCleanupOptions): Promise<DeletedRowsCleanup> {
	const parts = await executor.query<PartRow>({
		query: `SELECT table, sum(rows) AS physical, sum(bytes_on_disk) AS bytes
FROM system.parts
WHERE active AND database = {database:String}
GROUP BY table
HAVING countIf(has_lightweight_delete) > 0`,
		query_params: { database: DATABASE },
		format: "JSONEachRow",
	});
	if (parts.length === 0) return { status: "nothing", table: null };
	const running = new Set(
		(
			await executor.query<{ table: string }>({
				query: `SELECT DISTINCT table FROM system.mutations
WHERE database = {database:String} AND NOT is_done`,
				query_params: { database: DATABASE },
				format: "JSONEachRow",
			})
		).map((row) => row.table),
	);
	const tables: DeletedRowsTable[] = [];
	for (const part of parts) {
		if (running.has(part.table) || !/^[A-Za-z0-9_]+$/u.test(part.table))
			continue;
		const [live] = await executor.query<{ live: string | number }>({
			query: `SELECT count() AS live FROM ${DATABASE}.${part.table}`,
			format: "JSONEachRow",
		});
		const physicalRows = Number(part.physical);
		const liveRows = Number(live?.live ?? physicalRows);
		const bytes = Number(part.bytes);
		const share = physicalRows > 0 ? 1 - liveRows / physicalRows : 0;
		tables.push({
			table: part.table,
			physicalRows,
			liveRows,
			bytes,
			deadBytes: Math.round(bytes * share),
		});
	}
	const worth = tables
		.filter(
			(table) =>
				table.deadBytes >= minDeadBytes &&
				table.physicalRows > 0 &&
				1 - table.liveRows / table.physicalRows >= minDeadShare,
		)
		.sort((left, right) => right.deadBytes - left.deadBytes);
	const target = worth[0];
	if (!target)
		return {
			status: running.size > 0 ? "busy" : "nothing",
			table: null,
		};
	const [disk] = await executor.query<{ free: string | number }>({
		query: "SELECT free_space AS free FROM system.disks WHERE name = 'default'",
		format: "JSONEachRow",
	});
	const rewritten = target.bytes - target.deadBytes;
	if (disk && Number(disk.free) - rewritten < minFreeBytesAfter)
		return { status: "no_room", table: target };
	await executor.execute({
		query: `ALTER TABLE ${DATABASE}.${target.table} APPLY DELETED MASK`,
	});
	return { status: "applied", table: target };
}
