import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { getBootstrapMode } from "../../scripts/bootstrap.js";
import { F16_MIGRATIONS } from "../../scripts/migrate-f16.js";

const migrations = [
	{ name: "first.sql", checksum: "original-first" },
	{ name: "second.sql", checksum: "original-second" },
] as const;
const applied = migrations.map((migration) => ({
	...migration,
	appliedAt: "2026-09-30T00:00:00.000",
}));
const firstApplied = applied[0];
assert(firstApplied);

describe("ClickHouse bootstrap prefix guard", () => {
	test("only replays an empty database with an empty journal", () => {
		expect(getBootstrapMode(migrations, { applied: [] }, 0)).toBe("empty");
	});

	test("leaves a completely migrated database untouched", () => {
		expect(getBootstrapMode(migrations, { applied }, 30)).toBe("complete");
	});

	test("rejects an existing database without a journal", () => {
		expect(() => getBootstrapMode(migrations, { applied: [] }, 1)).toThrow(
			"Bootstrap refuses unjournaled rudel tables",
		);
	});

	test("upgrades a checksum-verified prefix even when the database is empty", () => {
		for (const tableCount of [0, 30]) {
			expect(
				getBootstrapMode(
					migrations,
					{ applied: applied.slice(0, 1) },
					tableCount,
				),
			).toBe("upgrade");
		}
	});

	test("rejects changed checksums in a proper prefix", () => {
		expect(() =>
			getBootstrapMode(
				migrations,
				{ applied: [{ ...firstApplied, checksum: "changed" }] },
				30,
			),
		).toThrow("Applied migration checksum mismatch for first.sql");
	});

	test("rejects gaps, reordered entries, unknown migrations, duplicates and extra history", () => {
		for (const entries of [
			applied.slice(1),
			[...applied].reverse(),
			[{ ...firstApplied, name: "unknown.sql" }],
			[firstApplied, firstApplied],
			[...applied, { ...firstApplied, name: "future.sql" }],
		]) {
			expect(() =>
				getBootstrapMode(migrations, { applied: entries }, 30),
			).toThrow("Applied migration history is not a prefix");
		}
	});

	test("rejects prefixes stopping inside F16 but allows upgrades before or after all phases", () => {
		const history = [
			migrations[0],
			...F16_MIGRATIONS.map((name) => ({ name, checksum: name })),
			migrations[1],
		];
		const entries = history.map((migration) => ({
			...migration,
			appliedAt: "2026-09-30T00:00:00.000",
		}));
		for (let phaseCount = 1; phaseCount < F16_MIGRATIONS.length; phaseCount++) {
			expect(() =>
				getBootstrapMode(
					history,
					{ applied: entries.slice(0, 1 + phaseCount) },
					30,
				),
			).toThrow("Partial F16 state");
		}
		for (const prefixLength of [1, 1 + F16_MIGRATIONS.length]) {
			expect(
				getBootstrapMode(
					history,
					{ applied: entries.slice(0, prefixLength) },
					30,
				),
			).toBe("upgrade");
		}
		expect(
			getBootstrapMode(history, { applied: entries }, 30, {
				artifacts: 7,
				unfinished: 0,
			}),
		).toBe("complete");
		expect(() =>
			getBootstrapMode(history, { applied: entries }, 30, {
				artifacts: 8,
				unfinished: 1,
			}),
		).toThrow("Partial F16 state");
	});

	test("refuses unjournaled F16 artifacts before starting a forward upgrade", () => {
		expect(() =>
			getBootstrapMode(migrations, { applied: applied.slice(0, 1) }, 30, {
				artifacts: 1,
				unfinished: 0,
			}),
		).toThrow("Partial F16 state");
	});

	test("rejects changed historical checksums before treating a database as complete", () => {
		expect(() =>
			getBootstrapMode(
				migrations,
				{
					applied: applied.map((entry) => ({ ...entry, checksum: "changed" })),
				},
				30,
			),
		).toThrow("Applied migration checksum mismatch for first.sql");
	});

	test("rejects empty migration directories", () => {
		expect(() => getBootstrapMode([], { applied: [] }, 0)).toThrow(
			"No ClickHouse migrations found",
		);
	});
});
