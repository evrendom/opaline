import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { SESSION_CONTEXT_SNAPSHOTS_MIGRATION } from "../../scripts/migrate-session-context-snapshots.js";
import {
	SESSION_CONTEXT_SNAPSHOT_COLUMNS,
	SESSION_CONTEXT_SNAPSHOTS_KEY,
	SESSION_CONTEXT_SNAPSHOTS_VERSION,
} from "../session-context-snapshots.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${SESSION_CONTEXT_SNAPSHOTS_MIGRATION}`);

describe("session context snapshots migration", () => {
	test("creates the table with the columns the worker writes, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.session_context_snapshots",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+?) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			SESSION_CONTEXT_SNAPSHOT_COLUMNS.map((column) => [
				column.name,
				column.type,
			]),
		);
		const key = SESSION_CONTEXT_SNAPSHOTS_KEY.map((name) => `\`${name}\``).join(
			", ",
		);
		expect(statement).toContain(
			`ENGINE = ReplacingMergeTree(${SESSION_CONTEXT_SNAPSHOTS_VERSION})`,
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
				(definition) => definition.name === "session_context_snapshots",
			)?.columns,
		).toEqual(
			SESSION_CONTEXT_SNAPSHOT_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
	});

	test("bootstrap runs its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'"20261107120000_session_context_snapshots.sql",\n\t\t"migrate-session-context-snapshots.ts",',
		);
	});
});
