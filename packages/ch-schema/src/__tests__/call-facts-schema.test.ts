import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { CALL_FACTS_MIGRATION } from "../../scripts/migrate-call-facts.js";
import {
	CALL_FACTS_COLUMNS,
	CALL_FACTS_KEY,
	CALL_FACTS_STARTED_AT_INDEX,
} from "../call-facts.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${CALL_FACTS_MIGRATION}`);

describe("call facts migration", () => {
	test("creates the table with the columns the build writes, its key and started_at index, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.call_facts",
		);
		expect(
			[...statement.matchAll(/^ {2}`([a-z_0-9]+)` (.+) COMMENT/gmu)].map(
				(match) => [match[1], match[2]],
			),
		).toEqual(CALL_FACTS_COLUMNS.map((column) => [column.name, column.type]));
		const key = CALL_FACTS_KEY.map((column) => `\`${column}\``).join(", ");
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).toContain(
			`INDEX ${CALL_FACTS_STARTED_AT_INDEX.name} ${CALL_FACTS_STARTED_AT_INDEX.expression} TYPE minmax GRANULARITY 1`,
		);
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
						orderBy: z.array(z.string()).optional(),
					}),
				),
			})
			.parse(JSON.parse(read("../../chx/meta/snapshot.json")));
		const definition = snapshot.definitions.find(
			(candidate) => candidate.name === "call_facts",
		);
		expect(definition?.columns).toEqual(
			CALL_FACTS_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(definition?.orderBy).toEqual([...CALL_FACTS_KEY]);
	});

	test("bootstrap and the production gate run its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			`["${CALL_FACTS_MIGRATION}", "migrate-call-facts.ts"]`,
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:call-facts[ "]/u,
		);
	});
});
