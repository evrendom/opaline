import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sessionLineageSchema from "../db/schema/session-lineage.js";

describe("session lineage physical schema", () => {
	test("uses an immutable child identity and an explicit replacement version", () => {
		const definition = JSON.stringify(sessionLineageSchema);

		expect(definition).toContain(
			"SharedReplacingMergeTree(replacement_version)",
		);
		expect(definition).toContain("replacement_version");
		expect(definition).toContain("input_sequence");
		expect(definition).toContain("derivation_version");
		expect(definition).toContain("child_first_ingested_at");
		expect(definition).not.toContain("partitionBy");

		const orderBy = readArrayProperty(definition, "orderBy");
		expect(orderBy).toEqual([
			"organization_id",
			"user_id",
			"child_source",
			"child_session_id",
		]);
		expect(orderBy).not.toContain("child_session_date");
		expect(orderBy).not.toContain("parent_session_id");
		expect(orderBy).not.toContain("confidence");
		expect(orderBy).not.toContain("replacement_version");
	});

	test("has a checked-in create-table migration with the same key", async () => {
		const migration = await readFile(
			fileURLToPath(
				new URL(
					"../../chx/migrations/20260822140000_session_lineage.sql",
					import.meta.url,
				),
			),
			"utf8",
		);

		expect(migration).toContain(
			"ENGINE = ReplacingMergeTree(replacement_version)",
		);
		expect(migration).toContain("`replacement_version` UInt64");
		expect(migration).toContain(
			"`child_originator` LowCardinality(String) DEFAULT ''",
		);
		expect(migration).toContain(
			"PRIMARY KEY (`organization_id`, `user_id`, `child_source`, `child_session_id`)",
		);
		expect(migration).toContain(
			"ORDER BY (`organization_id`, `user_id`, `child_source`, `child_session_id`)",
		);
		expect(migration).not.toContain("PARTITION BY");
	});
});

function readArrayProperty(serialized: string, property: string): string[] {
	const parsed: unknown = JSON.parse(serialized);
	return findArrayProperty(parsed, property) ?? [];
}

function findArrayProperty(
	value: unknown,
	property: string,
): string[] | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const result = findArrayProperty(item, property);
			if (result) return result;
		}
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	for (const [key, nested] of Object.entries(value)) {
		if (
			key === property &&
			Array.isArray(nested) &&
			nested.every((item) => typeof item === "string")
		) {
			return nested;
		}
		const result = findArrayProperty(nested, property);
		if (result) return result;
	}
	return undefined;
}
