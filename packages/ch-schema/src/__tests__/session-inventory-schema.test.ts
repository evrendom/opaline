import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { RudelSessionInventoryRowSchema } from "../generated/chkit-types.js";
import {
	SESSION_INVENTORY_COLUMNS,
	SESSION_INVENTORY_KEY,
	SESSION_INVENTORY_MIGRATION,
	SESSION_INVENTORY_TTL,
} from "../session-inventory.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${SESSION_INVENTORY_MIGRATION}`);

describe("session inventory migration", () => {
	test("only creates the new table, with the columns the API writes", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.session_inventory",
		);
		expect(
			[...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+) COMMENT/gmu)].map(
				(match) => [match[1], match[2]],
			),
		).toEqual(
			SESSION_INVENTORY_COLUMNS.map((column) => [column.name, column.type]),
		);
		const key = SESSION_INVENTORY_KEY.map((name) => `\`${name}\``).join(", ");
		expect(statement).toContain("ENGINE = ReplacingMergeTree(reported_at)");
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).toContain(`TTL ${SESSION_INVENTORY_TTL}`);
	});

	test("the snapshot, the generated row schema and the runners hold the table as defined", () => {
		const snapshot = z
			.object({
				definitions: z.array(
					z.object({
						name: z.string(),
						ttl: z.string().optional(),
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
		const definition = snapshot.definitions.find(
			(candidate) => candidate.name === "session_inventory",
		);
		expect(definition?.columns).toEqual(
			SESSION_INVENTORY_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(definition?.ttl).toBe(SESSION_INVENTORY_TTL);
		expect(Object.keys(RudelSessionInventoryRowSchema.shape)).toEqual(
			SESSION_INVENTORY_COLUMNS.map((column) => column.name),
		);
		expect(read("../../scripts/bootstrap.ts")).toContain(
			`["${SESSION_INVENTORY_MIGRATION}", "migrate-session-inventory.ts"],`,
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:session-inventory[ "]/u,
		);
	});
});
