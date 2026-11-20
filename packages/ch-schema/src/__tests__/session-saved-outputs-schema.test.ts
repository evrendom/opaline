import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { SESSION_SAVED_OUTPUTS_MIGRATION } from "../../scripts/migrate-session-saved-outputs.js";
import { RudelSessionSavedOutputsRowSchema } from "../generated/chkit-types.js";
import {
	SESSION_SAVED_OUTPUT_COLUMNS,
	SESSION_SAVED_OUTPUTS_KEY,
} from "../session-saved-outputs.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${SESSION_SAVED_OUTPUTS_MIGRATION}`);

describe("session saved outputs migration", () => {
	test("creates the table with the columns the API writes, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.session_saved_outputs",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z_]+)` (.+) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			SESSION_SAVED_OUTPUT_COLUMNS.map((column) => [column.name, column.type]),
		);
		const key = SESSION_SAVED_OUTPUTS_KEY.map((name) => `\`${name}\``).join(
			", ",
		);
		expect(statement).toContain(`ENGINE = ReplacingMergeTree(version)`);
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).not.toContain("PARTITION BY");
	});

	test("replaces per session and file, not per capture", () => {
		expect(SESSION_SAVED_OUTPUTS_KEY).toEqual([
			"organization_id",
			"user_id",
			"session_id",
			"session_source",
			"root_id",
			"path",
		]);
		expect(SESSION_SAVED_OUTPUTS_KEY).not.toContain("capture_id");
	});

	test("the snapshot and the generated row schema hold the table as defined", () => {
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
				(definition) => definition.name === "session_saved_outputs",
			)?.columns,
		).toEqual(
			SESSION_SAVED_OUTPUT_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(Object.keys(RudelSessionSavedOutputsRowSchema.shape)).toEqual(
			SESSION_SAVED_OUTPUT_COLUMNS.map((column) => column.name),
		);
	});

	test("bootstrap runs its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'"20261016130000_session_saved_outputs.sql",\n\t\t"migrate-session-saved-outputs.ts",',
		);
	});
});
