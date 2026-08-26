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
		const firstWait = ddlMigration.indexOf("SELECT sleepEachRow(1)");

		expect(lastTable).toBeGreaterThan(-1);
		expect(firstView).toBeGreaterThan(lastTable);
		for (const snapshot of [
			{
				keyClauses:
					"PARTITION BY toYYYYMM(toDate(session_date))\nPRIMARY KEY (`organization_id`, `session_date`, `session_id`)\nORDER BY (`organization_id`, `session_date`, `session_id`)",
				table: "claude_sessions",
			},
			{
				keyClauses:
					"PARTITION BY toYYYYMM(toDate(session_date))\nPRIMARY KEY (`organization_id`, `session_date`, `session_id`)\nORDER BY (`organization_id`, `session_date`, `session_id`)",
				table: "codex_sessions",
			},
			{
				keyClauses:
					"PRIMARY KEY (`source`, `organization_id`, `user_id`, `session_id`)\nORDER BY (`source`, `organization_id`, `user_id`, `session_id`)",
				table: "session_analytics",
			},
			{
				keyClauses:
					"PARTITION BY toYYYYMM(toDate(session_date))\nPRIMARY KEY ()\nORDER BY (`organization_id`, `session_date`, `session_id`, `source`)",
				table: "session_language_signals",
			},
		]) {
			const create = `CREATE TABLE rudel.${snapshot.table}_f16_backfill_source_20260826\n(`;
			const insert = `INSERT INTO rudel.${snapshot.table}_f16_backfill_source_20260826\n(`;
			const source = `FROM rudel.${snapshot.table};`;
			const createIndex = ddlMigration.indexOf(create);
			const insertIndex = ddlMigration.indexOf(insert, createIndex);
			const sourceEnd =
				ddlMigration.indexOf(source, insertIndex) + source.length;
			const snapshotSql = ddlMigration.slice(createIndex, sourceEnd);
			const createColumnsEnd = ddlMigration.indexOf(
				"\n) ENGINE = MergeTree",
				createIndex,
			);
			const insertColumnsEnd = ddlMigration.indexOf(
				"\n)\nSETTINGS async_insert=0",
				insertIndex,
			);
			const selectColumnsStart =
				ddlMigration.indexOf("\nSELECT\n", insertColumnsEnd) +
				"\nSELECT\n".length;
			const selectColumnsEnd = ddlMigration.indexOf(
				`\n${source}`,
				selectColumnsStart,
			);
			const extractColumns = (sql: string) =>
				[...sql.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
			const createColumns = extractColumns(
				ddlMigration.slice(createIndex + create.length, createColumnsEnd),
			);
			const insertColumns = extractColumns(
				ddlMigration.slice(insertIndex + insert.length, insertColumnsEnd),
			);
			const selectColumns = extractColumns(
				ddlMigration.slice(selectColumnsStart, selectColumnsEnd),
			);

			expect(createIndex).toBeGreaterThan(-1);
			expect(insertIndex).toBeGreaterThan(createIndex);
			expect(sourceEnd).toBeGreaterThan(insertIndex);
			expect(sourceEnd).toBeLessThan(firstWait);
			expect(snapshotSql).toContain(") ENGINE = MergeTree\n");
			expect(snapshotSql).toContain(snapshot.keyClauses);
			expect(snapshotSql).toContain("SETTINGS async_insert=0\nSELECT\n");
			expect(snapshotSql).not.toContain("SELECT *");
			expect(insertColumns).toEqual(createColumns);
			expect(selectColumns).toEqual(insertColumns);
		}
		expect(ddlMigration).not.toContain("CLONE AS");
		expect(ddlMigration.match(/SETTINGS async_insert=0/gu)).toHaveLength(4);
		// ClickHouse caps a single sleep() call at three seconds (TOO_SLOW), so
		// each propagation boundary sleeps one second per row across eight rows.
		// The three-second sleep cap applies per block, so each boundary sleeps
		// one second per single-row block across eight blocks.
		expect(
			ddlMigration.match(
				/SELECT sleepEachRow\(1\) FROM numbers\(8\) SETTINGS max_block_size = 1;/gu,
			),
		).toHaveLength(3);
		expect(ddlMigration).not.toContain("SELECT sleep(");
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
		// Historical ties rank filter output first, then every remaining stored
		// value. Hashing the tuple first proved nondeterministic in CI.
		expect(backfillMigration).not.toContain("SHA256");
		expect(
			backfillMigration.match(
				/ORDER BY\n\t+`filter_version` ASC,\n\t+tuple\(/gu,
			),
		).toHaveLength(3);
		expect(backfillMigration).toContain(
			"`content`,\n\t\t\t\t\t`ingested_at`,\n\t\t\t\t\t`user_id`,\n\t\t\t\t\t`git_branch`,\n\t\t\t\t\t`git_sha`,\n\t\t\t\t\t`tag`",
		);
		expect(backfillMigration).toContain(
			"FROM rudel.claude_sessions_f16_backfill_source_20260826",
		);
		expect(backfillMigration).toContain(
			"FROM rudel.codex_sessions_f16_backfill_source_20260826",
		);
		expect(backfillMigration).toContain(
			"FROM rudel.session_analytics_f16_backfill_source_20260826",
		);
		expect(backfillMigration).toContain(
			"FROM rudel.session_language_signals_f16_backfill_source_20260826",
		);
		expect(backfillMigration).not.toContain("_f16_backup_20260826");
		expect(backfillMigration).toContain(
			"ORDER BY tuple(\n\t\t\t\t`user_id`,\n\t\t\t\t`raw_ingested_at`,\n\t\t\t\t`member_swears`,\n\t\t\t\t`member_apologies`,\n\t\t\t\t`member_positive`,\n\t\t\t\t`model_swears`,\n\t\t\t\t`model_apologies`,\n\t\t\t\t`model_positive`\n\t\t\t) DESC",
		);
		expect(backfillMigration).toContain("WHERE signals.`dedupe_rank` = 1");
		expect(
			backfillMigration.match(
				/DROP TABLE rudel\.[a-z_]+_f16_backfill_source_20260826 SYNC;/gu,
			),
		).toHaveLength(4);
		expect(backfillMigration).toContain("`revision`,\n\t`ingested_at`");
		expect(backfillMigration).toContain(
			"bitShiftLeft(toUInt64(toUnixTimestamp64Milli(`ingested_at`)), 16)",
		);
	});
});
