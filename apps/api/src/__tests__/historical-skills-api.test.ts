import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("historical skills API guardrails", () => {
	test("keeps persistent reads workspace-scoped and off raw transcript tables", async () => {
		const [serviceSource, persistenceSource, backfillSource, purgeSource] =
			await Promise.all([
				readFile(
					resolve(
						import.meta.dir,
						"..",
						"services",
						"historical-skills.service.ts",
					),
					"utf8",
				),
				readFile(
					resolve(
						import.meta.dir,
						"..",
						"services",
						"skill-extraction-ingest.service.ts",
					),
					"utf8",
				),
				readFile(
					resolve(
						import.meta.dir,
						"..",
						"services",
						"skill-extraction-backfill.service.ts",
					),
					"utf8",
				),
				readFile(
					resolve(import.meta.dir, "..", "services", "org-session.service.ts"),
					"utf8",
				),
			]);

		expect(serviceSource).toContain("organizationId");
		expect(serviceSource).toContain("rudel.skill_version_contents");
		expect(serviceSource).not.toContain("rudel.claude_sessions");
		expect(serviceSource).not.toContain("rudel.codex_sessions");
		expect(serviceSource).not.toContain("argMax(content, ingested_at)");
		expect(serviceSource).toContain("uniqExact(tuple(");
		expect(serviceSource).toContain("{skillName:String}");
		expect(serviceSource).toContain("ORDER BY session_count DESC, name ASC");
		expect(serviceSource).toContain(
			"HISTORICAL_SKILL_PREVIEW_CHARACTER_LIMIT = 1_600",
		);
		expect(serviceSource).toContain("LEFT ANY JOIN");
		expect(serviceSource).toContain("FROM rudel.session_analytics FINAL");
		expect(serviceSource).toContain("FROM active_skill_uses AS su");
		expect(serviceSource).toContain("LEFT JOIN (");
		expect(serviceSource).toContain("su.agent = 'claude'");
		expect(serviceSource).toContain("sa.source = 'claude_code'");
		expect(serviceSource).toContain("su.agent = 'codex'");
		expect(serviceSource).toContain("sa.source = 'codex'");
		expect(serviceSource).toContain("coalesce(sa.project_path, '')");
		expect(serviceSource).toContain('repoIdentity.repoName ?? "No repository"');
		expect(serviceSource).toContain("HISTORICAL_SKILL_ATTRIBUTION_LIMIT = 6");
		expect(serviceSource).toContain("{attributionLimit:UInt64}");
		expect(serviceSource).toContain("resolver.resolve(input)");
		expect(serviceSource).toContain("substringUTF8(");
		expect(serviceSource).toContain(
			"PREWHERE organization_id = {organizationId:String}",
		);
		expect(serviceSource).toContain("max_execution_time: 30");
		expect(serviceSource).toContain(
			"max_bytes_to_read: String(2 * 1024 * 1024 * 1024)",
		);
		expect(serviceSource).toContain('max_rows_to_read: "10000000"');
		expect(serviceSource).toContain('max_rows_in_set: "1000000"');
		expect(serviceSource).toContain(
			"max_bytes_in_set: String(64 * 1024 * 1024)",
		);
		expect(serviceSource).toContain(
			"timeout_before_checking_execution_speed: 0",
		);
		expect(serviceSource).toContain('result_overflow_mode: "throw"');
		expect(serviceSource).toContain("HISTORICAL_SKILL_VERSION_LIMIT");
		expect(serviceSource).toContain("HISTORICAL_SKILL_CONTENT_MAX_BYTES");
		expect(serviceSource).toContain("LIMIT {versionLimit:UInt32}");
		expect(serviceSource).toContain(
			"contents.content_sha256 IN {contentHashes:Array(String)}",
		);
		expect(serviceSource).toContain("any(contents.content) AS content");
		expect(serviceSource).toContain(
			"length(contents.content) <= {contentByteLimit:UInt32}",
		);
		expect(persistenceSource).toContain("rudel.skill_receipts");
		expect(persistenceSource).toContain("rudel.skill_uses");
		expect(persistenceSource).not.toContain("JOIN latest_skill_receipts");
		expect(persistenceSource).toContain("FROM latest_skill_receipts");
		expect(persistenceSource).toContain("skill_filtered_use_identities");

		expect(serviceSource).toContain("max(used_at) AS last_used_at_raw");
		expect(serviceSource).toContain("ORDER BY last_used_at_raw DESC");
		expect(
			serviceSource.indexOf("ORDER BY last_used_at_raw DESC"),
		).toBeLessThan(serviceSource.indexOf("LIMIT {versionLimit:UInt32}"));
		expect(persistenceSource).not.toContain("record_kind");
		expect(persistenceSource).toContain(
			"(skill_name, content_sha256, user_id) IN {versionIdentities:Array(Tuple(String, FixedString(64), String))}",
		);
		expect(persistenceSource).toContain("new TupleParam([");
		expect(persistenceSource).toContain(
			"clickhouse_settings: SKILL_VERSION_LOOKUP_SETTINGS",
		);
		expect(persistenceSource).toContain(
			"timeout_before_checking_execution_speed: 0",
		);
		for (const lookupSource of [persistenceSource, backfillSource]) {
			expect(lookupSource).toContain(
				"max_bytes_to_read: String(2 * 1024 * 1024 * 1024)",
			);
			expect(lookupSource).toContain("max_execution_time: 60");
			expect(lookupSource).toContain('max_rows_to_read: "10000000"');
			expect(lookupSource).toContain(
				"timeout_before_checking_execution_speed: 0",
			);
		}
		expect(serviceSource).toContain("filterSkillName: true");
		expect(serviceSource).not.toMatch(/'\$\{/);
		expect(backfillSource).toContain(
			"const WRITE_BUFFER_MAX_BYTES = 32 * 1024 * 1024",
		);
		expect(backfillSource).toContain(
			"buffer.byteCount + additionalBytes > WRITE_BUFFER_MAX_BYTES",
		);
		expect(backfillSource).toContain("contentBytes >= WRITE_BUFFER_MAX_BYTES");
		expect(backfillSource).toContain(
			"createByteBoundedRowChunks(rows.contentRows)",
		);
		expect(backfillSource).toContain("if (rowBytes >= WRITE_BUFFER_MAX_BYTES)");
		expect(backfillSource).toContain("user_id IN {userIds:Array(String)}");
		expect(backfillSource).toContain(
			"session_date IN {sessionDates:Array(DateTime64(3, 'UTC'))}",
		);
		expect(backfillSource).toContain(
			"clickhouse_settings: SKILL_SCAN_SETTINGS",
		);
		expect(backfillSource).toContain(
			"clickhouse_settings: SOURCE_SCAN_SETTINGS",
		);
		expect(backfillSource).toContain(
			"(skill_name, content_sha256, user_id) IN {versionIdentities:Array(Tuple(String, FixedString(64), String))}",
		);
		expect(backfillSource).toContain("new TupleParam([");
		expect(backfillSource).toContain(
			"clickhouse_settings: SKILL_VERSION_LOOKUP_SETTINGS",
		);
		expect(backfillSource).toContain(
			"timeout_before_checking_execution_speed: 0",
		);
		expect(purgeSource).toContain("SKILL_VERSION_CONTENTS_TABLE");
		expect(purgeSource).toContain("PRIVACY_DELETE_SCAN_SETTINGS");
	});

	test("isolates the temporary raw fallback behind explicit cutover routing", async () => {
		const [legacySource, handlerSource] = await Promise.all([
			readFile(
				resolve(
					import.meta.dir,
					"..",
					"services",
					"legacy-historical-skills.service.ts",
				),
				"utf8",
			),
			readFile(
				resolve(import.meta.dir, "..", "handlers", "analytics", "skills.ts"),
				"utf8",
			),
		]);
		expect(legacySource).toContain("rudel.codex_sessions");
		expect(handlerSource).toContain("shouldUsePersistentSkillAnalytics");
		expect(handlerSource).toContain("listHistoricalSkills");
		expect(handlerSource).toContain("listLegacyHistoricalCodexSkills");
	});

	test("applies organization middleware to both procedures", async () => {
		const handlerSource = await readFile(
			resolve(import.meta.dir, "..", "handlers", "analytics", "skills.ts"),
			"utf8",
		);

		expect(handlerSource.match(/\.use\(orgMiddleware\)/g)).toHaveLength(2);
		expect(
			handlerSource.match(/context\.organizationId/g)?.length,
		).toBeGreaterThanOrEqual(2);
	});
});
