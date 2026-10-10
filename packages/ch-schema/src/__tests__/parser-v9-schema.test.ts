import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parserV9ColumnsVisible } from "../../scripts/migrate-parser-v9.js";
import { runIndexTable } from "../db/schema/run-index.js";
import usageEventsSchema from "../db/schema/usage-events.js";

const columns = [
	["usage_events", "recorded_cache_write_5m_input_tokens", "Nullable(UInt64)"],
	["usage_events", "recorded_cache_write_1h_input_tokens", "Nullable(UInt64)"],
	["usage_events", "cache_write_input_tokens", "Nullable(UInt64)"],
	["run_index", "failed_edits", "Nullable(UInt32)"],
	["run_index", "refused_edits", "Nullable(UInt32)"],
] as const;
const rows = ["a", "b"].flatMap((host) =>
	columns.map(([table, name, type]) => ({
		host,
		table,
		name,
		type,
	})),
);

test("parser 9 adds nullable columns without destructive or data rewriting SQL", () => {
	const sql = readFileSync(
		new URL(
			"../../chx/migrations/20261010130000_parser_v9.sql",
			import.meta.url,
		),
		"utf8",
	);
	expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|MODIFY|TRUNCATE)\b/u);
	for (const [table, name, type] of columns) {
		expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${name} ${type}`);
		const schema = table === "usage_events" ? usageEventsSchema : runIndexTable;
		expect(JSON.stringify(schema)).toContain(
			JSON.stringify({ name, type }).slice(0, -1),
		);
	}
});

test("migration publication proof rejects lagging or incorrectly typed replicas", () => {
	expect(parserV9ColumnsVisible(rows, 2)).toBe(true);
	expect(
		parserV9ColumnsVisible(
			rows.filter((row) => row.host === "a"),
			2,
		),
	).toBe(false);
	expect(
		parserV9ColumnsVisible(
			rows.map((row) =>
				row.host === "b" && row.name === "failed_edits"
					? { ...row, type: "UInt32" }
					: row,
			),
			2,
		),
	).toBe(false);
	expect(parserV9ColumnsVisible(rows, Number.NaN)).toBe(false);
	expect(parserV9ColumnsVisible([], 1)).toBe(false);
});

test("bootstrap delegates parser 9 and its snapshot already includes the added columns", () => {
	const bootstrap = readFileSync(
		new URL("../../scripts/bootstrap.ts", import.meta.url),
		"utf8",
	);
	expect(bootstrap).toContain(
		'["20261010130000_parser_v9.sql", "migrate-parser-v9.ts"]',
	);
	const snapshot = JSON.parse(
		readFileSync(
			new URL("../../chx/meta/snapshot.json", import.meta.url),
			"utf8",
		),
	) as {
		definitions: { name: string; columns: { name: string; type: string }[] }[];
	};
	for (const [table, name, type] of columns) {
		const definition = snapshot.definitions.find(
			(entry) => entry.name === table,
		);
		expect(
			definition?.columns.find((column) => column.name === name)?.type,
		).toBe(type);
	}
});
