import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { RECEIVED_SETUP_MIGRATION } from "../../scripts/migrate-received-setup.js";
import { RUN_SETUP_COLUMNS, SETUP_TEXT_COLUMNS } from "../received-setup.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${RECEIVED_SETUP_MIGRATION}`);
const TABLES = [
	["setup_texts", SETUP_TEXT_COLUMNS],
	["run_setup", RUN_SETUP_COLUMNS],
] as const;

describe("received setup migration", () => {
	test("creates both tables with the columns the API writes, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(2);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		for (const [index, [name, columns]] of TABLES.entries()) {
			const statement = statements[index] ?? "";
			expect(statement).toStartWith(`CREATE TABLE IF NOT EXISTS rudel.${name}`);
			const declared = [
				...statement.matchAll(/^ {2}`([a-z_]+)` (.+) COMMENT/gmu),
			];
			expect(declared.map((match) => [match[1], match[2]])).toEqual(
				columns.map((column) => [column.name, column.type]),
			);
		}
	});

	test("the snapshot holds both tables as defined", () => {
		const snapshot = z
			.object({
				definitions: z.array(
					z.object({
						name: z.string(),
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
		for (const [name, columns] of TABLES)
			expect(
				snapshot.definitions.find((definition) => definition.name === name)
					?.columns,
			).toEqual(
				columns.map(({ name, type, comment }) => ({ name, type, comment })),
			);
	});

	test("bootstrap runs its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'["20261013120000_received_setup.sql", "migrate-received-setup.ts"]',
		);
	});
});
