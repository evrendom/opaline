import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { SESSION_IMAGES_MIGRATION } from "../../scripts/migrate-session-images.js";
import { RudelSessionImagesRowSchema } from "../generated/chkit-types.js";
import {
	SESSION_IMAGE_COLUMNS,
	SESSION_IMAGES_KEY,
} from "../session-images.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${SESSION_IMAGES_MIGRATION}`);

describe("session images migration", () => {
	test("creates the table with the columns the API writes, and nothing else", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.session_images",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			SESSION_IMAGE_COLUMNS.map((column) => [column.name, column.type]),
		);
		const key = SESSION_IMAGES_KEY.map((name) => `\`${name}\``).join(", ");
		expect(statement).toContain(`ENGINE = ReplacingMergeTree(version)`);
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).not.toContain("PARTITION BY");
	});

	test("replaces per session, image and record, not per capture", () => {
		expect(SESSION_IMAGES_KEY).toEqual([
			"organization_id",
			"user_id",
			"session_id",
			"session_source",
			"sha256",
			"agent_id",
			"record_idx",
		]);
		expect(SESSION_IMAGES_KEY).not.toContain("capture_id");
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
				(definition) => definition.name === "session_images",
			)?.columns,
		).toEqual(
			SESSION_IMAGE_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(Object.keys(RudelSessionImagesRowSchema.shape)).toEqual(
			SESSION_IMAGE_COLUMNS.map((column) => column.name),
		);
	});

	test("bootstrap and the production gate run its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			'["20261016190000_session_images.sql", "migrate-session-images.ts"],',
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:session-images[ "]/u,
		);
	});
});
