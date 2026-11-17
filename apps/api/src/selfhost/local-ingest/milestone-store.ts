import type postgres from "postgres";

export const INITIAL_IMPORT_MILESTONE = "initial_import";

export interface MilestoneStore {
	reachedAt(name: string): Promise<Date | null>;
	reach(name: string, at: Date): Promise<void>;
}

export function createMilestoneStore(sql: postgres.Sql): MilestoneStore {
	return {
		async reachedAt(name) {
			const [row] = await sql<{ reachedMs: number }[]>`
				SELECT (extract(epoch FROM reached_at) * 1000)::float8 AS "reachedMs"
				FROM local_ingest_milestone
				WHERE name = ${name}
			`;
			return row ? new Date(Number(row.reachedMs)) : null;
		},
		async reach(name, at) {
			await sql`
				INSERT INTO local_ingest_milestone (name, reached_at)
				VALUES (${name}, ${at.toISOString()}::timestamptz)
				ON CONFLICT (name) DO NOTHING
			`;
		},
	};
}

export function memoryMilestoneStore(): MilestoneStore {
	const reached = new Map<string, Date>();
	return {
		async reachedAt(name) {
			return reached.get(name) ?? null;
		},
		async reach(name, at) {
			if (!reached.has(name)) reached.set(name, at);
		},
	};
}
