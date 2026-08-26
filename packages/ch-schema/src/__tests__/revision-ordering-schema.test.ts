import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import claudeSessions from "../db/schema/claude-sessions.js";
import codexSessions from "../db/schema/codex-sessions.js";
import sessionAnalytics from "../db/schema/session-analytics.js";
import sessionLanguageSignals from "../db/schema/session-language-signals.js";
import { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/claude-session-analytics.js";
import { CODEX_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/codex-session-analytics.js";

const ddlMigration = readFileSync(
	resolve(import.meta.dir, "../../chx/migrations/20260826090551_auto.sql"),
	"utf8",
);
const backfillMigration = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations/20260826090600_f16_backfill.sql",
	),
	"utf8",
);

describe("F16 revision ordering schema", () => {
	test("uses the same revision for raw, analytics, and MV winner ordering", () => {
		for (const definition of [
			claudeSessions,
			codexSessions,
			sessionAnalytics,
		]) {
			expect(JSON.stringify(definition)).toContain(
				"SharedReplacingMergeTree(revision)",
			);
		}
		expect(JSON.stringify(sessionLanguageSignals)).toContain(
			"SharedReplacingMergeTree(signal_version)",
		);
		for (const query of [
			CLAUDE_SESSION_ANALYTICS_MV_SQL,
			CODEX_SESSION_ANALYTICS_MV_SQL,
		]) {
			expect(query).toContain("ORDER BY cs.revision DESC");
			expect(query).not.toContain("ORDER BY cs.ingested_at DESC");
		}
	});

	test("keeps tables before MVs with exact propagation waits", () => {
		const lastTable = ddlMigration.lastIndexOf(
			"CREATE TABLE IF NOT EXISTS rudel.session_analytics",
		);
		const firstView = ddlMigration.indexOf("CREATE MATERIALIZED VIEW");

		expect(lastTable).toBeGreaterThan(-1);
		expect(firstView).toBeGreaterThan(lastTable);
		expect(ddlMigration.match(/SELECT sleep\(8\);/gu)).toHaveLength(3);
		expect(ddlMigration).not.toContain("SELECT sleep(3)");
		expect(ddlMigration).toContain(
			"rudel.claude_sessions TO rudel.claude_sessions_f16_backup_20260826",
		);
		expect(ddlMigration).toContain(
			"rudel.session_language_signals TO rudel.session_language_signals_f16_backup_20260826",
		);
		expect(ddlMigration.match(/ReplacingMergeTree\(revision\)/gu)).toHaveLength(
			3,
		);
		expect(ddlMigration).toContain("ReplacingMergeTree(signal_version)");
		expect(
			ddlMigration.match(/MODIFY COLUMN `extraction_seq` UInt128/gu),
		).toHaveLength(3);
		expect(ddlMigration).toContain(
			"`raw_revision` UInt64 DEFAULT bitShiftLeft(toUInt64(toUnixTimestamp64Milli(raw_ingested_at)), 16)",
		);
		expect(ddlMigration).toContain("`signal_version` UInt128 DEFAULT");
	});

	test("backfills with explicit columns and synchronous INSERT SELECT", () => {
		expect(backfillMigration.match(/SETTINGS async_insert=0/gu)).toHaveLength(
			4,
		);
		expect(backfillMigration).not.toMatch(/SELECT\s+\*/u);
		expect(backfillMigration).toContain("INSERT INTO rudel.claude_sessions\n(");
		expect(backfillMigration).toContain("INSERT INTO rudel.codex_sessions\n(");
		expect(backfillMigration).toContain(
			"INSERT INTO rudel.session_analytics\n(",
		);
		expect(backfillMigration).toContain(
			"INSERT INTO rudel.session_language_signals\n(",
		);
		expect(backfillMigration).toContain(
			"FROM rudel.session_analytics\nGROUP BY `source`, `organization_id`, `user_id`, `session_id`",
		);
		expect(backfillMigration).toContain(
			"LEFT ANTI JOIN\nrudel.session_analytics_f16_rebuilt_identities_20260826",
		);
		expect(backfillMigration).not.toContain(
			"FROM rudel.claude_sessions_f16_backup_20260826\n\tGROUP BY `source`",
		);
		expect(backfillMigration.match(/toJSONString\(tuple\(/gu)).toHaveLength(2);
		expect(backfillMigration).toContain("`revision`,\n\t`ingested_at`");
		expect(backfillMigration).toContain(
			"bitShiftLeft(toUInt64(toUnixTimestamp64Milli(`ingested_at`)), 16)",
		);
	});
});
