import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { TRANSCRIPT_RECORD_COMMANDS_MIGRATION } from "../../scripts/migrate-transcript-record-commands.js";
import {
	TRANSCRIPT_RECORD_COMMAND_COLUMNS,
	TRANSCRIPT_RECORD_COMMANDS_KEY,
	TRANSCRIPT_RECORD_COMMANDS_VERSION,
} from "../transcript-record-commands.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(
	`../../chx/migrations/${TRANSCRIPT_RECORD_COMMANDS_MIGRATION}`,
);

describe("transcript record commands migration", () => {
	test("creates the table with the columns find source=calls reads, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.transcript_record_commands",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+?) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			TRANSCRIPT_RECORD_COMMAND_COLUMNS.map((column) => [
				column.name,
				column.type,
			]),
		);
		const key = TRANSCRIPT_RECORD_COMMANDS_KEY.map(
			(name) => `\`${name}\``,
		).join(", ");
		expect(statement).toContain(
			`ENGINE = ReplacingMergeTree(${TRANSCRIPT_RECORD_COMMANDS_VERSION})`,
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
				(definition) => definition.name === "transcript_record_commands",
			)?.columns,
		).toEqual(
			TRANSCRIPT_RECORD_COMMAND_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
	});

	test("bootstrap and the production gate run its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'"20261109200000_transcript_record_commands.sql",\n\t\t"migrate-transcript-record-commands.ts",',
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:transcript-record-commands[ "]/u,
		);
	});
});
