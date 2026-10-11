import { describe, expect, test } from "bun:test";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import {
	WEEKLY_TOTALS_MIGRATION,
	WEEKLY_TOTALS_REFRESH,
} from "../../scripts/migrate-weekly-totals.js";
import { weeklyTotalsTable } from "../db/schema/weekly-totals.js";
import {
	WEEKLY_TOTALS_KEY_COLUMNS,
	WEEKLY_TOTALS_MEASURES,
} from "../weekly-totals.js";

const TABLE = weeklyTotalsTable as unknown as {
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	partitionBy: string;
	ttl: string;
	comment: string;
};
const sql = await Bun.file(
	new URL(`../../chx/migrations/${WEEKLY_TOTALS_MIGRATION}`, import.meta.url),
).text();
const [createTable = "", createView = ""] = extractExecutableStatements(sql);

describe("weekly totals migration", () => {
	test("has the table, then the view, and nothing else", () => {
		expect(extractExecutableStatements(sql)).toHaveLength(2);
		expect(createTable).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.weekly_totals",
		);
		expect(createView).toStartWith(
			"CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.weekly_totals_mv",
		);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
	});

	test("creates the table exactly as defined", () => {
		const columns = TABLE.columns
			.map(
				(column) =>
					`  \`${column.name}\` ${column.type} COMMENT '${column.comment.replaceAll("'", "\\'")}'`,
			)
			.join(",\n");
		expect(createTable).toContain(`(\n${columns}\n) ENGINE = MergeTree\n`);
		const key = TABLE.orderBy.map((name) => `\`${name}\``).join(", ");
		expect(createTable).toContain(`PARTITION BY ${TABLE.partitionBy}\n`);
		expect(createTable).toContain(`PRIMARY KEY (${key})\nORDER BY (${key})\n`);
		expect(createTable).toContain(`TTL ${TABLE.ttl}\n`);
		expect(createTable).toContain(
			"SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 's3'",
		);
		expect(createTable).toContain(`COMMENT '${TABLE.comment}'`);
	});

	test("the snapshot holds the same table", async () => {
		const snapshot = (await Bun.file(
			new URL("../../chx/meta/snapshot.json", import.meta.url),
		).json()) as { definitions: Record<string, unknown>[] };
		const definition = snapshot.definitions.find(
			(candidate) => candidate.name === "weekly_totals",
		);
		expect(definition).toMatchObject({
			engine: "MergeTree",
			columns: TABLE.columns,
			orderBy: TABLE.orderBy,
			partitionBy: TABLE.partitionBy,
			ttl: TABLE.ttl,
			comment: TABLE.comment,
		});
	});

	test("every measure that sums a gated fact names a known-runs column", () => {
		const names = new Set(TABLE.columns.map((column) => column.name));
		for (const measure of WEEKLY_TOTALS_MEASURES) {
			if (measure.known === undefined) continue;
			expect(names.has(measure.known)).toBe(true);
			expect(measure.type.startsWith("Nullable(")).toBe(true);
			expect(createView).toContain(
				`if(sum(s.${measure.known}) = 0, NULL, sum(s.${measure.name})) AS ${measure.name}`,
			);
		}
		expect(TABLE.columns.map((column) => column.name)).toEqual([
			...WEEKLY_TOTALS_KEY_COLUMNS.map((column) => column.name),
			...WEEKLY_TOTALS_MEASURES.map((measure) => measure.name),
		]);
	});

	test("the view appends a nightly snapshot with every column", () => {
		expect(createView).toContain(
			`${WEEKLY_TOTALS_REFRESH}\nTO rudel.weekly_totals\nAS SELECT`,
		);
		const outer = createView.slice(0, createView.indexOf("FROM ("));
		for (const column of TABLE.columns)
			expect(outer).toMatch(new RegExp(`\\b${column.name}\\b`, "u"));
		// A snapshot is read only once all its rows are stored.
		expect(outer).toContain("count() OVER () AS snapshot_rows");
		expect(createView).toContain(
			"concat(hostName(), ' ', toString(refreshed_at)) AS refresh_id",
		);
		expect(createView).toContain("toMonday(r.started_at) AS week");
	});

	test("the view reads only the committed run index builds, without transcript content", () => {
		const tables = [...createView.matchAll(/\bFROM\s+(rudel\.\w+)/gu)].map(
			(match) => match[1],
		);
		expect(new Set(tables)).toEqual(new Set(["rudel.run_index"]));
		expect(createView).toContain("FROM rudel.run_index AS r FINAL");
		expect(createView).toContain(
			"max((revision, parser_version, index_version, build_revision)) AS committed",
		);
		expect(createView).toContain("WHERE row_kind = 'receipt'");
		expect(createView).toContain(
			"(r.organization_id, r.user_id, r.session_id, r.revision, r.parser_version, r.index_version, r.build_revision) IN (",
		);
	});

	test("the refresh runs under its own memory and thread ceilings", () => {
		expect(createView).toMatch(
			/\nSETTINGS max_threads = 2, max_memory_usage = 2000000000, max_bytes_before_external_group_by = 1000000000, remote_filesystem_read_prefetch = 0, max_execution_time = 1800\n/u,
		);
	});
});
