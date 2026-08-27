import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import claudeSessions from "../db/schema/claude-sessions.js";
import codexSessions from "../db/schema/codex-sessions.js";
import sessionAnalytics from "../db/schema/session-analytics.js";
import sessionLanguageSignals from "../db/schema/session-language-signals.js";
import { CLAUDE_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/claude-session-analytics.js";
import { CODEX_SESSION_ANALYTICS_MV_SQL } from "../mv-sql/codex-session-analytics.js";

const preservationMigration = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations/20260826090550_f16_preservation.sql",
	),
	"utf8",
);
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
const cleanupMigration = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations/20260826090610_f16_cleanup.sql",
	),
	"utf8",
);
const migrationExecutor = readFileSync(
	resolve(import.meta.dir, "../../scripts/migrate-f16.ts"),
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

	test("preserves rows before a fail-closed cutover with polled visibility barriers", () => {
		const lastTable = ddlMigration.lastIndexOf(
			"CREATE TABLE rudel.session_analytics",
		);
		const firstView = ddlMigration.indexOf("CREATE MATERIALIZED VIEW");
		const verificationReceipt = preservationMigration.indexOf(
			"INSERT INTO rudel.f16_revision_cutover_verification_20260826",
		);

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
			const create = `CREATE TABLE IF NOT EXISTS rudel.${snapshot.table}_f16_backfill_source_20260826\n(`;
			const insert = `INSERT INTO rudel.${snapshot.table}_f16_backfill_source_20260826\n(`;
			const source = `FROM rudel.${snapshot.table};`;
			const createIndex = preservationMigration.indexOf(create);
			const insertIndex = preservationMigration.indexOf(insert, createIndex);
			const sourceEnd =
				preservationMigration.indexOf(source, insertIndex) + source.length;
			const snapshotSql = preservationMigration.slice(createIndex, sourceEnd);
			const createColumnsEnd = preservationMigration.indexOf(
				"\n) ENGINE = MergeTree",
				createIndex,
			);
			const insertColumnsEnd = preservationMigration.indexOf(
				"\n)\nSETTINGS async_insert=0",
				insertIndex,
			);
			const selectColumnsStart =
				preservationMigration.indexOf("\nSELECT\n", insertColumnsEnd) +
				"\nSELECT\n".length;
			const selectColumnsEnd = preservationMigration.indexOf(
				`\n${source}`,
				selectColumnsStart,
			);
			const extractColumns = (sql: string) =>
				[...sql.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
			const createColumns = extractColumns(
				preservationMigration.slice(
					createIndex + create.length,
					createColumnsEnd,
				),
			);
			const insertColumns = extractColumns(
				preservationMigration.slice(
					insertIndex + insert.length,
					insertColumnsEnd,
				),
			);
			const selectColumns = extractColumns(
				preservationMigration.slice(selectColumnsStart, selectColumnsEnd),
			);

			expect(createIndex).toBeGreaterThan(-1);
			expect(insertIndex).toBeGreaterThan(createIndex);
			expect(sourceEnd).toBeGreaterThan(insertIndex);
			expect(sourceEnd).toBeLessThan(verificationReceipt);
			expect(snapshotSql).toContain(") ENGINE = MergeTree\n");
			expect(snapshotSql).toContain(snapshot.keyClauses);
			expect(snapshotSql).toContain("SETTINGS async_insert=0\nSELECT\n");
			expect(snapshotSql).not.toContain("SELECT *");
			expect(insertColumns).toEqual(createColumns);
			expect(selectColumns).toEqual(insertColumns);
		}
		expect(preservationMigration).not.toContain("CLONE AS");
		expect(
			preservationMigration.match(/SETTINGS async_insert=0/gu),
		).toHaveLength(4);
		expect(preservationMigration).toContain("source_equal_key_version_groups");
		expect(preservationMigration).toContain(
			"source_physical_rows > snapshot_physical_rows",
		);
		expect(ddlMigration).toContain("AS f16_poll_rename_visible");
		expect(ddlMigration).toContain("AS f16_poll_canonical_tables_visible");
		expect(ddlMigration).toContain("AS f16_poll_materialized_views_visible");
		expect(ddlMigration).toContain("RECOVERY: F16-CUTOVER-AFTER-RENAME");
		expect(ddlMigration).toContain(
			"maxIf(approved_at, checkpoint = 'preservation_verified')",
		);
		expect(ddlMigration).not.toContain("SELECT sleep(");
		expect(ddlMigration).not.toContain("SELECT sleepEachRow(");
		expect(ddlMigration).not.toMatch(
			/CREATE TABLE IF NOT EXISTS rudel\.(?:claude_sessions|codex_sessions|session_analytics|session_language_signals)\b/u,
		);
		expect(ddlMigration).not.toMatch(
			/CREATE MATERIALIZED VIEW IF NOT EXISTS rudel\./u,
		);
		expect(migrationExecutor).toContain("timeoutMs = input.requestTimeoutMs");
		expect(migrationExecutor).toContain("AbortSignal.timeout(timeoutMs)");
		expect(migrationExecutor).toContain(
			'endpoint.searchParams.set("distributed_ddl_output_mode", "throw")',
		);
		expect(migrationExecutor).toContain('"distributed_ddl_task_timeout"');
		expect(migrationExecutor).toContain(
			'"SELECT sleepEachRow(1) FROM numbers(1) SETTINGS max_block_size = 1"',
		);
		expect(migrationExecutor).toContain("rudel-f16-");
		expect(migrationExecutor).toContain("crypto.randomUUID()");
		expect(migrationExecutor).toContain("f16_poll_no_orphaned_queries");
		expect(migrationExecutor).toContain("deadline - Date.now()");
		expect(migrationExecutor).toContain("F16 journal is out of order");
		expect(ddlMigration).toContain(
			"rudel.claude_sessions TO rudel.claude_sessions_f16_backup_20260826",
		);
		expect(ddlMigration).toContain(
			"rudel.session_language_signals TO rudel.session_language_signals_f16_backup_20260826",
		);
		expect(
			ddlMigration.match(/\) ENGINE = ReplacingMergeTree\(revision\)/gu),
		).toHaveLength(3);
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
		expect(
			backfillMigration.match(
				/TRUNCATE TABLE rudel\.(?:claude_sessions|codex_sessions|session_analytics|session_language_signals);/gu,
			),
		).toHaveLength(4);
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
		expect(backfillMigration).not.toMatch(
			/FROM rudel\.[a-z_]+_f16_backup_20260826/u,
		);
		expect(backfillMigration).toContain(
			"ORDER BY tuple(\n\t\t\t\t`user_id`,\n\t\t\t\t`raw_ingested_at`,\n\t\t\t\t`member_swears`,\n\t\t\t\t`member_apologies`,\n\t\t\t\t`member_positive`,\n\t\t\t\t`model_swears`,\n\t\t\t\t`model_apologies`,\n\t\t\t\t`model_positive`\n\t\t\t) DESC",
		);
		expect(backfillMigration).toContain("WHERE signals.`dedupe_rank` = 1");
		expect(backfillMigration).not.toMatch(
			/DROP TABLE (?:IF EXISTS )?rudel\.[a-z_]+_f16_backfill_source_20260826 SYNC;/u,
		);
		expect(backfillMigration).toContain(
			"f16_revision_cutover_postbackfill_verification_20260826",
		);
		expect(backfillMigration).toContain("`expected_logical_rows` UInt64");
		expect(backfillMigration).toContain("`canonical_logical_rows` UInt64");
		expect(backfillMigration).toContain("`canonical_physical_rows` UInt64");
		expect(backfillMigration).toContain(
			"expected_logical_rows != canonical_logical_rows",
		);
		expect(cleanupMigration).toContain(
			"expected_logical_rows != canonical_logical_rows",
		);
		expect(cleanupMigration).toContain("post_backfill_verified");
		expect(cleanupMigration).toContain(
			"maxIf(approved_at, checkpoint = 'post_backfill_verified')",
		);
		expect(
			cleanupMigration.match(
				/DROP TABLE IF EXISTS rudel\.[a-z_]+_f16_backfill_source_20260826 SYNC;/gu,
			),
		).toHaveLength(4);
		expect(backfillMigration).toContain("`revision`,\n\t`ingested_at`");
		expect(backfillMigration).toContain(
			"bitShiftLeft(toUInt64(toUnixTimestamp64Milli(`ingested_at`)), 16)",
		);
	});
});
