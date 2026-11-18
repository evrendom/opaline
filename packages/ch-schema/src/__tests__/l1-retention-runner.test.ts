import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	L1_RETENTION_MIGRATION,
	L1_RETENTION_TABLES,
	RUN_INDEX_RETENTION_COMMENT_COLUMNS,
	runL1RetentionMigration,
} from "../../scripts/migrate-l1-retention.js";
import {
	RUN_INDEX_TEXT_COLUMNS,
	runIndexTable,
} from "../db/schema/run-index.js";

const MIGRATION_SQL = await readFile(
	resolve(import.meta.dir, "../../chx/migrations", L1_RETENTION_MIGRATION),
	"utf8",
);
const RUN_INDEX = runIndexTable as unknown as {
	columns: { name: string; type: string; comment: string }[];
};
const OLD_COMMENT = " (retention wording)";

interface TableState {
	tableTtl: boolean;
	textTtl: Set<string>;
	comments: Map<string, string>;
}
type HostState = Map<string, TableState>;

function initialState(
	options: { tableTtl?: boolean; textTtl?: boolean } = {},
): HostState {
	const { tableTtl = true, textTtl = true } = options;
	return new Map(
		L1_RETENTION_TABLES.map((name) => [
			name,
			{
				tableTtl,
				textTtl: new Set<string>(
					textTtl && name === "run_index" ? RUN_INDEX_TEXT_COLUMNS : [],
				),
				comments: new Map(
					RUN_INDEX.columns.map((column) => [
						column.name,
						RUN_INDEX_RETENTION_COMMENT_COLUMNS.includes(column.name)
							? `${column.comment}${OLD_COMMENT}`
							: column.comment,
					]),
				),
			},
		]),
	);
}

function tableOf(state: HostState, name: string): TableState {
	const table = state.get(name);
	if (!table) throw new Error(`No table ${name} in the fake`);
	return table;
}

function createQuery(table: TableState): string {
	const columns = RUN_INDEX.columns
		.map(
			(column) =>
				`\`${column.name}\` ${column.type} COMMENT '${(table.comments.get(column.name) ?? "").replaceAll("'", "\\'")}'${table.textTtl.has(column.name) ? " TTL toDate(session_date) + toIntervalDay(365)" : ""}`,
		)
		.join(", ");
	return `CREATE TABLE rudel.t (${columns}) ENGINE = ReplacingMergeTree(build_revision) ORDER BY organization_id`;
}

function engineFull(table: TableState): string {
	return `ReplacingMergeTree(build_revision) PRIMARY KEY organization_id ORDER BY organization_id${table.tableTtl ? " TTL toDate(session_date) + toIntervalDay(1095)" : ""} SETTINGS index_granularity = 1024, storage_policy = 's3'`;
}

/**
 * A cluster of `replicas` sharing one schema. Replica b serves the schema as
 * it was before the migration for its first `staleReads` table reads.
 */
function cluster(options: {
	replicas: number;
	staleReads?: number;
	state?: HostState;
	journaled?: boolean;
	missing?: string;
}) {
	const state = options.state ?? initialState();
	if (options.missing) state.delete(options.missing);
	const stale = initialState();
	const executed: string[] = [];
	let tableReads = 0;
	const hosts = options.replicas > 1 ? ["a", "b"] : [""];
	const view = (host: string): HostState =>
		host === "b" && tableReads <= (options.staleReads ?? 0) ? stale : state;
	const journal: { name: string; checksum: string }[] = options.journaled
		? [{ name: L1_RETENTION_MIGRATION, checksum: checksumSQL(MIGRATION_SQL) }]
		: [];
	const executor = {
		execute: async (statement: string) => {
			executed.push(statement.trim());
			const text = statement.trim().replace(/;$/u, "");
			const column =
				/^ALTER TABLE \S+\.(\w+) MODIFY COLUMN (\w+) REMOVE TTL$/u.exec(text);
			const comment =
				/^ALTER TABLE \S+\.(\w+) MODIFY COLUMN (\w+) COMMENT '(.*)'$/u.exec(
					text,
				);
			const table = /^ALTER TABLE \S+\.(\w+) REMOVE TTL$/u.exec(text);
			const target = state.get(column?.[1] ?? comment?.[1] ?? table?.[1] ?? "");
			if (!target) throw new Error(`UNKNOWN_TABLE: ${statement}`);
			// ClickHouse refuses to remove a TTL that is not there.
			if (table) {
				if (!target.tableTtl) throw new Error("Table doesn't have any TTL");
				target.tableTtl = false;
			} else if (column) {
				if (!target.textTtl.delete(column[2] ?? ""))
					throw new Error("Column doesn't have a TTL");
			} else if (comment) {
				target.comments.set(
					comment[2] ?? "",
					(comment[3] ?? "").replaceAll("\\'", "'"),
				);
			}
		},
		query: async (sql: string) => {
			if (sql.includes("system.clusters"))
				return [{ replicas: options.replicas }];
			if (sql.includes("system.tables")) {
				tableReads++;
				// Without clusterAllReplicas, the endpoint the executor reaches.
				const served = sql.includes("clusterAllReplicas")
					? hosts
					: [hosts[0] ?? ""];
				return served.flatMap((host) =>
					[...view(host)].map(([name, table]) => ({
						host,
						name,
						engine_full: engineFull(table),
						create_table_query: createQuery(table),
					})),
				);
			}
			return hosts.flatMap((host) =>
				[...(view(host).get("run_index")?.comments ?? [])].map(
					([name, comment]) => ({ host, name, comment }),
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
	const run = (sql = MIGRATION_SQL) =>
		runL1RetentionMigration({
			executor,
			journalStore,
			migrationSql: sql,
			targetDatabase: "rudel",
			readBack: { attempts: 3, delayMs: 0 },
		});
	return { run, state, journal, executed };
}

const REMOVALS = (statements: readonly string[]) =>
	statements.filter((statement) => /REMOVE TTL;?$/u.test(statement));

describe("L1 retention migration", () => {
	test("removes every retention TTL once and journals after the read-back", async () => {
		const fake = cluster({ replicas: 1 });
		await fake.run();
		expect(REMOVALS(fake.executed)).toHaveLength(
			L1_RETENTION_TABLES.length + RUN_INDEX_TEXT_COLUMNS.length,
		);
		expect(fake.executed).toHaveLength(
			extractExecutableStatements(MIGRATION_SQL).length,
		);
		for (const table of fake.state.values()) {
			expect(table.tableTtl).toBe(false);
			expect(table.textTtl.size).toBe(0);
		}
		expect(fake.journal).toEqual([
			expect.objectContaining({
				name: L1_RETENTION_MIGRATION,
				checksum: checksumSQL(MIGRATION_SQL),
			}),
		]);
	});

	test("finishes an interrupted run: only the TTLs still installed are removed", async () => {
		const state = initialState();
		for (const name of ["claude_sessions", "codex_sessions"])
			tableOf(state, name).tableTtl = false;
		tableOf(state, "run_index").textTtl.delete("title");
		const fake = cluster({ replicas: 1, state });
		await fake.run();
		expect(REMOVALS(fake.executed).sort()).toEqual(
			[
				"ALTER TABLE rudel.transcript_records REMOVE TTL;",
				"ALTER TABLE rudel.run_index REMOVE TTL;",
				"ALTER TABLE rudel.session_lineage REMOVE TTL;",
				...RUN_INDEX_TEXT_COLUMNS.filter((name) => name !== "title").map(
					(name) =>
						`ALTER TABLE rudel.run_index MODIFY COLUMN ${name} REMOVE TTL;`,
				),
			].sort(),
		);
		expect(fake.journal).toHaveLength(1);
	});

	test("a table created without TTLs needs no REMOVE TTL", async () => {
		const fake = cluster({
			replicas: 1,
			state: initialState({ tableTtl: false, textTtl: false }),
		});
		await fake.run();
		expect(REMOVALS(fake.executed)).toEqual([]);
		expect(fake.journal).toHaveLength(1);
	});

	test("rewrites the retention comments, so the run index runner and this one agree", async () => {
		const fake = cluster({ replicas: 1 });
		await fake.run();
		const comments = fake.state.get("run_index")?.comments;
		for (const column of RUN_INDEX.columns)
			expect(comments?.get(column.name)).toBe(column.comment);
		for (const comment of comments?.values() ?? [])
			expect(comment).not.toContain("retention");
	});

	test("once journaled it only verifies, and fails if a TTL comes back", async () => {
		const clean = cluster({
			replicas: 1,
			journaled: true,
			state: initialState({ tableTtl: false, textTtl: false }),
		});
		for (const table of clean.state.values())
			for (const column of RUN_INDEX.columns)
				table.comments.set(column.name, column.comment);
		await clean.run();
		expect(clean.executed).toEqual([]);
		expect(clean.journal).toHaveLength(1);

		const drifted = cluster({
			replicas: 1,
			journaled: true,
			state: initialState({ tableTtl: false, textTtl: false }),
		});
		for (const column of RUN_INDEX.columns)
			drifted.state.get("run_index")?.comments.set(column.name, column.comment);
		tableOf(drifted.state, "transcript_records").tableTtl = true;
		await expect(drifted.run()).rejects.toThrow(
			"Tables still have a TTL: transcript_records",
		);
		const text = cluster({
			replicas: 1,
			journaled: true,
			state: initialState({ tableTtl: false, textTtl: false }),
		});
		for (const column of RUN_INDEX.columns)
			text.state.get("run_index")?.comments.set(column.name, column.comment);
		tableOf(text.state, "run_index").textTtl.add("goal");
		await expect(text.run()).rejects.toThrow(
			"Run index text columns still have a TTL: goal",
		);
		expect(text.executed).toEqual([]);
	});

	test("waits until every replica serves the tables without TTLs before journaling", async () => {
		const fake = cluster({ replicas: 2, staleReads: 2 });
		await fake.run();
		expect(fake.journal).toHaveLength(1);
	});

	test("fails without journaling while one replica keeps a TTL", async () => {
		const fake = cluster({
			replicas: 2,
			staleReads: Number.POSITIVE_INFINITY,
		});
		await expect(fake.run()).rejects.toThrow(
			"Tables still have a TTL: claude_sessions, codex_sessions, transcript_records, run_index, session_lineage on replica b",
		);
		expect(fake.journal).toHaveLength(0);
	});

	test("a missing table fails loudly, never journals", async () => {
		const fake = cluster({ replicas: 1, missing: "run_index" });
		await expect(fake.run()).rejects.toThrow(
			"Table rudel.run_index is missing",
		);
		expect(fake.journal).toHaveLength(0);
	});

	test("refuses a journaled migration whose file changed", async () => {
		const fake = cluster({ replicas: 1, journaled: true });
		await expect(fake.run(`${MIGRATION_SQL}\nSELECT 1;\n`)).rejects.toThrow(
			"checksum mismatch",
		);
		expect(fake.executed).toEqual([]);
	});
});
