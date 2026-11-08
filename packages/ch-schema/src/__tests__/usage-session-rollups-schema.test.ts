import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { USAGE_SESSION_ROLLUPS_MIGRATION } from "../../scripts/migrate-usage-session-rollups.js";
import {
	USAGE_SESSION_ROLLUP_COLUMNS,
	USAGE_SESSION_ROLLUPS_KEY,
	USAGE_SESSION_ROLLUPS_VERSION,
} from "../usage-session-rollups.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${USAGE_SESSION_ROLLUPS_MIGRATION}`);

describe("usage session rollups migration", () => {
	test("creates the table with the columns the rollup builder writes, and nothing else", () => {
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
			USAGE_SESSION_ROLLUP_COLUMNS.map((column) => [column.name, column.type]),
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

	test("the snapshot holds the table as defined", () => {
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
		expect(
			snapshot.definitions.find(
				(definition) => definition.name === "usage_session_rollups",
			)?.columns,
		).toEqual(
			USAGE_SESSION_ROLLUP_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
	});

	test("bootstrap and the production gate run its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'"20261108150000_usage_session_rollups.sql",\n\t\t"migrate-usage-session-rollups.ts",',
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:usage-session-rollups[ "]/u,
		);
	});
});
