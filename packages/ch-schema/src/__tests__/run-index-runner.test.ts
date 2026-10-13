import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	columnDeclaration,
	runRunIndexMigration,
} from "../../scripts/migrate-run-index.js";
import {
	RUN_INDEX_TEXT_COLUMNS,
	runIndexTable,
} from "../db/schema/run-index.js";

/** The TTLs `20261010120000_run_index.sql` installs and the retention migration removes. */
const TABLE_TTL = "toDate(session_date) + toIntervalDay(1095)";
const TEXT_TTL = "toDate(session_date) + toIntervalDay(365)";

const TABLE = runIndexTable as unknown as {
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	comment: string;
};
const TEXT = new Set<string>(RUN_INDEX_TEXT_COLUMNS);
const COLUMNS = TABLE.columns.map((column) => ({
	name: column.name,
	type: column.type,
	comment: column.comment,
	default_kind: "",
}));
const KEY = TABLE.orderBy.join(", ");

/** The CREATE TABLE query ClickHouse reports, with or without the text column TTLs. */
function createQuery(textTtl: boolean): string {
	const columns = TABLE.columns
		.map(
			(column) =>
				`\`${column.name}\` ${column.type} COMMENT '${column.comment.replaceAll("'", "\\'")}'${textTtl && TEXT.has(column.name) ? ` TTL ${TEXT_TTL}` : ""}`,
		)
		.join(", ");
	return `CREATE TABLE rudel.run_index (${columns}) ENGINE = ReplacingMergeTree(build_revision) PRIMARY KEY (${KEY}) ORDER BY (${KEY}) TTL ${TABLE_TTL} SETTINGS index_granularity = 1024`;
}

function tableRow(host: string, textTtl = true) {
	return {
		host,
		engine_full: `ReplacingMergeTree(build_revision) PRIMARY KEY (${KEY}) ORDER BY (${KEY}) TTL ${TABLE_TTL} SETTINGS index_granularity = 1024, index_granularity_bytes = 1048576, non_replicated_deduplication_window = 1000, storage_policy = 's3'`,
		sorting_key: KEY,
		primary_key: KEY,
		partition_key: "",
		storage_policy: "s3",
		comment: TABLE.comment,
		create_table_query: createQuery(textTtl),
	};
}

/**
 * A cluster of `replicas` where replica b lags for its first `staleReads`
 * reads: it serves no run index yet, or one without the text TTLs. `denied`
 * is production: two replicas, a user that may not read `system.clusters`,
 * and a load-balanced endpoint whose reads each reach the next replica.
 * `unlisted` may not use `clusterAllReplicas` either.
 */
function cluster(
	replicas: number | "denied" | "unlisted",
	staleReads: number,
	lag: "missing" | "untimed" = "missing",
) {
	let reads = 0;
	let next = 0;
	const queries: string[] = [];
	const journal: { name: string; checksum: string }[] = [];
	const listed = typeof replicas === "number";
	const hosts = !listed || replicas > 1 ? ["a", "b"] : [""];
	const stale = (host: string) => host === "b" && reads <= staleReads;
	const denied = (grant: string) =>
		new Error(
			`default: Not enough privileges. To execute this query, it's necessary to have the grant ${grant}.`,
		);
	const executor = {
		execute: async () => {},
		query: async (sql: string) => {
			queries.push(sql);
			if (sql.includes("system.clusters")) {
				if (!listed) throw denied("SELECT(cluster) ON system.clusters");
				return [{ replicas }];
			}
			if (sql.includes("system.one")) {
				if (replicas === "unlisted") throw denied("REMOTE ON *.*");
				return [{ replicas: hosts.length }];
			}
			const served = sql.includes("clusterAllReplicas")
				? hosts
				: [hosts[next++ % hosts.length] ?? ""];
			if (sql.includes("system.columns")) {
				reads++;
				return served.flatMap((host) =>
					stale(host) && lag === "missing"
						? []
						: COLUMNS.map((column) => ({ ...column, host })),
				);
			}
			return served.flatMap((host) =>
				stale(host) && lag === "missing"
					? []
					: [tableRow(host, !(stale(host) && lag === "untimed"))],
			);
		},
	} as unknown as ClickHouseExecutor;
	const journalStore = {
		readJournal: async () => ({ applied: journal }),
		appendEntry: async (entry: { name: string; checksum: string }) => {
			journal.push(entry);
		},
	} as never;
	const run = () =>
		runRunIndexMigration({
			executor,
			journalStore,
			migrationSql: "SELECT 1;",
			targetDatabase: "rudel",
			expectedEngine: "ReplacingMergeTree",
			expectedStoragePolicy: "s3",
			readBack: { attempts: 3, delayMs: 0 },
		});
	return { run, journal, queries, reads: () => reads };
}

describe("run index runner", () => {
	test("waits until every replica serves the table before journaling", async () => {
		const state = cluster(2, 1);
		await state.run();
		expect(state.reads()).toBe(2);
		expect(state.journal).toHaveLength(1);
		expect(
			state.queries.some((sql) =>
				sql.includes("clusterAllReplicas('default', system.tables)"),
			),
		).toBe(true);
	});

	test("fails without journaling while one replica stays behind", async () => {
		const state = cluster(2, Number.POSITIVE_INFINITY);
		await expect(state.run()).rejects.toThrow("visible on 1 of 2 replicas");
		expect(state.journal).toHaveLength(0);
	});

	test("does not check TTLs: a table with or without them is the created table", async () => {
		// Retention is removed by migrate-l1-retention.ts, which checks it.
		for (const lag of ["untimed", "missing"] as const) {
			const state = cluster(2, 0, lag);
			await state.run();
			expect(state.journal).toHaveLength(1);
		}
	});

	test("leaves the comments the retention migration rewrites to its runner", async () => {
		const reworded = COLUMNS.map((column) =>
			["session_date", ...RUN_INDEX_TEXT_COLUMNS].includes(column.name)
				? { ...column, comment: `${column.comment} reworded` }
				: column,
		);
		const columns = COLUMNS.splice(0, COLUMNS.length, ...reworded);
		try {
			const state = cluster(0, 0);
			await state.run();
			expect(state.journal).toHaveLength(1);
		} finally {
			COLUMNS.splice(0, COLUMNS.length, ...columns);
		}
	});

	test("without the privilege to read system.clusters, the replicas answer for themselves", async () => {
		// Production: the endpoint's columns and table reads reach different
		// replicas, so only clusterAllReplicas pairs them by host.
		const state = cluster("denied", 1);
		await state.run();
		expect(state.journal).toHaveLength(1);
		expect(
			state.queries.some((sql) =>
				sql.includes("clusterAllReplicas('default', system.tables)"),
			),
		).toBe(true);
	});

	test("refuses without journaling when nothing can list the replicas", async () => {
		const state = cluster("unlisted", 0);
		await expect(state.run()).rejects.toThrow(
			"Cannot list the cluster's replicas",
		);
		expect(state.journal).toHaveLength(0);
	});

	test("a single server reads its own tables", async () => {
		const state = cluster(0, 0);
		await state.run();
		expect(state.journal).toHaveLength(1);
		expect(
			state.queries.some((sql) => sql.includes("clusterAllReplicas")),
		).toBe(false);
	});

	test("a column declaration ends at the next column, comments with commas and quotes included", () => {
		const query = createQuery(true);
		expect(columnDeclaration(query, "goal")).toContain(`TTL ${TEXT_TTL}`);
		expect(columnDeclaration(query, "goal")).not.toContain("`git_operations`");
		expect(columnDeclaration(query, "started_at")).toContain("run\\'s");
		expect(columnDeclaration(query, "session_model")).not.toContain("ENGINE");
		expect(columnDeclaration(query, "missing")).toBe("");
	});
});
