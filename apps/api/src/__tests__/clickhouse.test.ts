import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RudelSessionAnalyticsRowSchema } from "@rudel/ch-schema/generated";
import { SESSION_ANALYTICS_INSERT_COLUMNS } from "@rudel/ch-schema/session-analytics-mv";
import {
	addOptionalStringEqFilter,
	addOptionalStringInFilter,
	buildAbsoluteDateFilter,
	buildDateFilter,
	buildIngestRecoveryCountStatement,
	buildLatestRawSessionContentSql,
	buildSessionAnalyticsRepairStatement,
	createClickHouseExecutor,
	createClickHouseInsertDeduplicationSettings,
	getSafeClickHouseTable,
} from "../clickhouse.js";

describe("clickhouse helpers", () => {
	test("keeps malicious scalar values out of SQL text", () => {
		const where: string[] = [];
		const query_params: Record<string, unknown> = {};
		const payload = "abc'\\\\\n--\u2028";

		addOptionalStringEqFilter(
			where,
			query_params,
			"session_id",
			"sessionId",
			payload,
		);

		expect(where).toEqual(["session_id = {sessionId:String}"]);
		expect(query_params).toEqual({ sessionId: payload });
		expect(where.join(" ")).not.toContain(payload);
	});

	test("parameterizes every value in IN filters", () => {
		const where: string[] = [];
		const query_params: Record<string, unknown> = {};
		const values = ["one' OR 1=1", "two\\\\\n", "three\u2028"];

		addOptionalStringInFilter(
			where,
			query_params,
			"project_path",
			"projectPath",
			values,
		);

		expect(where).toEqual([
			"project_path IN ({projectPath_0:String}, {projectPath_1:String}, {projectPath_2:String})",
		]);
		expect(query_params).toEqual({
			projectPath_0: values[0],
			projectPath_1: values[1],
			projectPath_2: values[2],
		});
		expect(where[0]).not.toContain(values[0] ?? "");
	});

	test("date filters emit placeholders instead of interpolated values", () => {
		expect(buildDateFilter("days", "sa.session_date")).toBe(
			"sa.session_date >= now64(3) - toIntervalDay({days:UInt32}) AND sa.session_date <= now64(3)",
		);
		expect(
			buildAbsoluteDateFilter("startDate", "endDate", "session_date"),
		).toBe(
			"toDate(session_date) >= toDate({startDate:String}) AND toDate(session_date) <= toDate({endDate:String})",
		);
	});

	test("rejects unknown insert tables", () => {
		expect(() => getSafeClickHouseTable("rudel.unknown_table")).toThrow(
			"Unsupported ClickHouse table",
		);
	});

	test("distinguishes independent inserts while preserving durable tokens", () => {
		const first = createClickHouseInsertDeduplicationSettings();
		const second = createClickHouseInsertDeduplicationSettings();
		const durable = createClickHouseInsertDeduplicationSettings(
			"ledger-1:rudel.claude_sessions",
		);

		expect(first.insert_deduplication_token).toBeString();
		expect(second.insert_deduplication_token).not.toBe(
			first.insert_deduplication_token,
		);
		expect(durable).toEqual({
			async_insert_deduplicate: 1,
			deduplicate_blocks_in_dependent_materialized_views: 1,
			insert_deduplication_token: "ledger-1:rudel.claude_sessions",
		});
	});

	test("preserves proxy status without replacing ClickHouse server errors", async () => {
		let responseKind: "clickhouse" | "proxy" = "proxy";
		const server = Bun.serve({
			fetch: () =>
				responseKind === "proxy"
					? new Response("upstream unavailable", { status: 503 })
					: new Response(
							"Code: 159. DB::Exception: Timeout exceeded. (TIMEOUT_EXCEEDED)",
							{ status: 500 },
						),
			hostname: "127.0.0.1",
			port: 0,
		});
		const executor = createClickHouseExecutor({ url: server.url.toString() });

		await expect(executor.execute({ query: "SELECT 1" })).rejects.toMatchObject(
			{
				status: 503,
			},
		);
		responseKind = "clickhouse";
		await expect(executor.execute({ query: "SELECT 1" })).rejects.toMatchObject(
			{
				code: "159",
				type: "TIMEOUT_EXCEEDED",
			},
		);

		await executor.close();
		await server.stop(true);
	});

	test("builds exact-revision session analytics repairs from both canonical MVs", () => {
		const rawValues = [
			{
				ingested_at: "2030-01-01 00:00:00.000",
				organization_id: "org-repair",
				revision: "115807295561596928",
				session_date: "2026-08-25 10:00:00.000",
				session_id: "session-repair",
				user_id: "user-repair",
			},
		];
		const statement = buildSessionAnalyticsRepairStatement(
			"rudel.claude_sessions",
			rawValues,
			"ledger-1:rudel.claude_sessions:session-analytics-repair",
		);
		const codexStatement = buildSessionAnalyticsRepairStatement(
			"rudel.codex_sessions",
			rawValues,
			"ledger-1:rudel.codex_sessions:session-analytics-repair",
		);

		expect(Object.keys(RudelSessionAnalyticsRowSchema.shape)).toEqual([
			...SESSION_ANALYTICS_INSERT_COLUMNS,
		]);
		expect(statement.query).toContain("INSERT INTO rudel.session_analytics");
		expect(statement.query).toContain("SETTINGS async_insert=0");
		expect(statement.query).toContain("FROM rudel.claude_sessions AS cs");
		expect(codexStatement.query).toContain("FROM rudel.codex_sessions AS cs");
		expect(statement.query).toContain(
			"cs.organization_id = {organizationId:String}",
		);
		expect(statement.query).toContain(
			"cs.session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')",
		);
		expect(statement.query).toContain("cs.session_id = {sessionId:String}");
		expect(statement.query).toContain("cs.user_id = {userId:String}");
		expect(statement.query).toContain("cs.revision = {revision:UInt64}");
		expect(statement.query_params).toEqual({
			ingestedAt: "2030-01-01 00:00:00.000",
			organizationId: "org-repair",
			revision: "115807295561596928",
			sessionDate: "2026-08-25 10:00:00.000",
			sessionId: "session-repair",
			userId: "user-repair",
		});
		expect(statement.clickhouse_settings?.insert_deduplication_token).toBe(
			"ledger-1:rudel.claude_sessions:session-analytics-repair",
		);
		for (const column of SESSION_ANALYTICS_INSERT_COLUMNS) {
			const quotedColumn = ["`", column, "`"].join("");
			expect(statement.query.split(quotedColumn)).toHaveLength(3);
		}
	});

	test("keeps large usage-event recovery probes constant-size", () => {
		const values = Array.from({ length: 3_600 }, (_, index) => ({
			event_id: index.toString().padStart(64, "0"),
			event_version: "1787900000000",
			organization_id: "org-recovery",
			session_id: "session-recovery",
			source: "codex",
			user_id: "user-recovery",
		}));
		const statement = buildIngestRecoveryCountStatement(
			"rudel.usage_events",
			values,
			"rudel.usage_events",
		);

		expect(statement.query).toContain(
			"organization_id = {organizationId:String}",
		);
		expect(statement.query).toContain("user_id = {userId:String}");
		expect(statement.query).toContain("source = {source:String}");
		expect(statement.query).toContain("session_id = {sessionId:String}");
		expect(statement.query).toContain("event_version = {eventVersion:UInt64}");
		expect(statement.query).not.toContain("event_id IN");
		expect(statement.query_params).toEqual({
			eventVersion: "1787900000000",
			organizationId: "org-recovery",
			sessionId: "session-recovery",
			source: "codex",
			userId: "user-recovery",
		});
	});

	test("requires pushed-down filters for raw transcript scans", () => {
		expect(() => buildLatestRawSessionContentSql({})).toThrow(
			"Raw transcript queries must be narrowed",
		);

		const sql = buildLatestRawSessionContentSql({
			sessionDate: true,
			sessionId: true,
			userId: true,
		});

		expect(sql.match(/session_id = \{sessionId:String\}/g)).toHaveLength(2);
		expect(sql.match(/user_id = \{userId:String\}/g)).toHaveLength(2);
		expect(
			sql.match(
				/session_date = parseDateTime64BestEffort\(\{sessionDate:String\}, 3, 'UTC'\)/g,
			),
		).toHaveLength(2);
		expect(sql).toContain("argMax(content, raw.revision)");
		expect(sql).toContain("toString(max(raw.revision)) AS revision");
		expect(sql).toContain(
			"GROUP BY source, organization_id, user_id, session_id",
		);
		expect(sql).not.toContain("ORDER BY ingested_at");

		const sourceScopedSql = buildLatestRawSessionContentSql({
			sessionDate: true,
			sessionId: true,
			source: true,
			userId: true,
		});
		expect(sourceScopedSql).toContain("{source:String} = 'claude_code'");
		expect(sourceScopedSql).toContain("{source:String} = 'codex'");
	});
});

describe("analytics service guardrails", () => {
	test("does not use quoted interpolation or escapeString in runtime services", async () => {
		const serviceFiles = [
			"developer.service.ts",
			"org-session.service.ts",
			"overview.service.ts",
			"session-analytics.service.ts",
		];

		for (const file of serviceFiles) {
			const source = await readFile(
				resolve(import.meta.dir, "..", "services", file),
				"utf8",
			);
			expect(source).not.toContain("escapeString(");
			expect(source).not.toMatch(/'\$\{/);
		}
	});

	test("does not allow raw executor strings or dimension fallbacks", async () => {
		const clickhouseSource = await readFile(
			resolve(import.meta.dir, "..", "clickhouse.ts"),
			"utf8",
		);
		const sessionAnalyticsSource = await readFile(
			resolve(
				import.meta.dir,
				"..",
				"services",
				"session-analytics.service.ts",
			),
			"utf8",
		);

		expect(clickhouseSource).not.toContain("string | ClickHouseStatement");
		expect(clickhouseSource).not.toContain("normalizeStatement(");
		expect(clickhouseSource).not.toContain("{table:Identifier}");
		expect(clickhouseSource).toContain("async_insert=0");
		expect(clickhouseSource).toContain(
			"async_insert=1, wait_for_async_insert=1",
		);
		expect(clickhouseSource).toContain("input_format_parallel_parsing=0");
		expect(clickhouseSource).not.toContain("lightweight_deletes_sync");
		expect(sessionAnalyticsSource).not.toContain("{table:Identifier}");
		expect(sessionAnalyticsSource).not.toContain("|| dimension");
		expect(sessionAnalyticsSource).not.toContain("|| split_by");
	});

	test("keeps ownership reads duplicate-safe and backfill scans bounded", async () => {
		const sessionDetailSource = await readFile(
			resolve(
				import.meta.dir,
				"..",
				"services",
				"session-detail-snapshot.service.ts",
			),
			"utf8",
		);
		const backfillSource = await readFile(
			resolve(
				import.meta.dir,
				"..",
				"services",
				"session-ownership-backfill.service.ts",
			),
			"utf8",
		);
		const cleanupSource = await readFile(
			resolve(
				import.meta.dir,
				"..",
				"services",
				"session-ownership-cleanup.service.ts",
			),
			"utf8",
		);
		expect(sessionDetailSource).not.toContain(" FINAL");
		expect(sessionDetailSource).toContain("argMax(");
		expect(sessionDetailSource).toContain("LEFT ANY JOIN latest_analytics");
		expect(backfillSource).toContain("max_bytes_to_read");
		expect(backfillSource).toContain("max_execution_time");
		expect(
			backfillSource.match(/clickhouse_settings: BACKFILL_QUERY_SETTINGS/g),
		).toHaveLength(2);
		expect(cleanupSource).toContain("max_bytes_to_read");
		expect(cleanupSource).toContain("max_execution_time");
		expect(cleanupSource).toContain('lightweight_deletes_sync: "3"');
		expect(cleanupSource).not.toContain("ALTER TABLE");
	});
});
