import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import {
	USAGE_SESSION_ROLLUP_COSTS_MIGRATION,
	USAGE_SESSION_ROLLUPS_MIGRATION,
	USAGE_SESSION_ROLLUPS_MIGRATIONS,
} from "../../scripts/migrate-usage-session-rollups.js";
import {
	USAGE_SESSION_ROLLUP_COLUMNS,
	USAGE_SESSION_ROLLUPS_COMMENT,
	USAGE_SESSION_ROLLUPS_KEY,
	USAGE_SESSION_ROLLUPS_VERSION,
} from "../usage-session-rollups.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${USAGE_SESSION_ROLLUPS_MIGRATION}`);
const costsSql = read(
	`../../chx/migrations/${USAGE_SESSION_ROLLUP_COSTS_MIGRATION}`,
);
const ADDED_COLUMNS = ["estimated_costs", "pricing_models"];
const sqlString = (value: string) =>
	`'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

describe("usage session rollups migration", () => {
	test("creates the table with the columns the rollup builder first wrote, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.usage_session_rollups",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+?) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			USAGE_SESSION_ROLLUP_COLUMNS.filter(
				(column) => !ADDED_COLUMNS.includes(column.name),
			).map((column) => [column.name, column.type]),
		);
		const key = USAGE_SESSION_ROLLUPS_KEY.map((name) => `\`${name}\``).join(
			", ",
		);
		expect(statement).toContain(
			`ENGINE = ReplacingMergeTree(${USAGE_SESSION_ROLLUPS_VERSION})`,
		);
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).not.toContain("PARTITION BY");
	});

	test("adds the priced group columns after the token columns with defaults one per group, and only comments the rest", () => {
		const statements = extractExecutableStatements(costsSql);
		expect(statements).toHaveLength(2);
		expect(costsSql).not.toMatch(
			/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY COLUMN\b/u,
		);
		const names = USAGE_SESSION_ROLLUP_COLUMNS.map((column) => column.name);
		for (const name of ADDED_COLUMNS) {
			const column = USAGE_SESSION_ROLLUP_COLUMNS.find(
				(candidate) => candidate.name === name,
			);
			expect(column?.default).toContain("record_kinds");
			const after = names[names.indexOf(name) - 1];
			expect(statements[0]).toContain(
				`ADD COLUMN IF NOT EXISTS ${name} ${column?.type} DEFAULT ${column?.default} COMMENT ${sqlString(column?.comment ?? "")} AFTER ${after}`,
			);
		}
		expect(names.indexOf("estimated_costs")).toBe(
			names.indexOf("output_tokens") + 1,
		);
		const buildVersion = USAGE_SESSION_ROLLUP_COLUMNS.find(
			(column) => column.name === "build_version",
		);
		expect(statements[0]).toContain(
			`COMMENT COLUMN build_version ${sqlString(buildVersion?.comment ?? "")}`,
		);
		expect(statements[1]).toStartWith(
			`ALTER TABLE rudel.usage_session_rollups\n    MODIFY COMMENT ${sqlString(USAGE_SESSION_ROLLUPS_COMMENT)}`,
		);
	});

	test("the snapshot holds the table as defined", () => {
		const snapshot = z
			.object({
				definitions: z.array(
					z.object({
						name: z.string(),
						comment: z.string().optional(),
						columns: z
							.array(
								z.object({
									name: z.string(),
									type: z.string(),
									comment: z.string().optional(),
								}),
							)
							.optional(),
					}),
				),
			})
			.parse(JSON.parse(read("../../chx/meta/snapshot.json")));
		const table = snapshot.definitions.find(
			(definition) => definition.name === "usage_session_rollups",
		);
		expect(table?.columns).toEqual(
			USAGE_SESSION_ROLLUP_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(table?.comment).toBe(USAGE_SESSION_ROLLUPS_COMMENT);
	});

	test("bootstrap runs its runner for both migrations", () => {
		expect(USAGE_SESSION_ROLLUPS_MIGRATIONS).toEqual([
			USAGE_SESSION_ROLLUPS_MIGRATION,
			USAGE_SESSION_ROLLUP_COSTS_MIGRATION,
		]);
		for (const migration of USAGE_SESSION_ROLLUPS_MIGRATIONS)
			expect(read("../../scripts/bootstrap.ts")).toContain(
				`"${migration}",\n\t\t"migrate-usage-session-rollups.ts",`,
			);
	});
});
