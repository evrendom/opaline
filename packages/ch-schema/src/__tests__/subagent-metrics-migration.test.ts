import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migrationPath = resolve(
	import.meta.dir,
	"../../chx/migrations/20260821163004_auto.sql",
);

describe("subagent metrics migration", () => {
	test("adds the target column before recreating either materialized view", async () => {
		const migration = await readFile(migrationPath, "utf8");
		const addColumn = migration.indexOf(
			"ALTER TABLE rudel.session_analytics ADD COLUMN IF NOT EXISTS `subagent_count` UInt32 DEFAULT 0",
		);
		const codexView = migration.indexOf(
			"CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.codex_session_analytics_mv",
		);
		const claudeView = migration.indexOf(
			"CREATE MATERIALIZED VIEW IF NOT EXISTS rudel.session_analytics_mv",
		);

		expect(addColumn).toBeGreaterThan(-1);
		expect(codexView).toBeGreaterThan(addColumn);
		expect(claudeView).toBeGreaterThan(addColumn);
		expect(migration.match(/ as subagent_count/gu)).toHaveLength(2);
	});
});
