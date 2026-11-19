import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { parseAuditL1Args } from "../scripts/l1-script-args.js";
import { ANALYSIS_QUERY_SETTINGS } from "./analysis/sql.js";
import {
	auditL1,
	compareL1Audits,
	formatL1Audit,
	formatL1AuditChanges,
	readOnlyClickHouse,
} from "./l1-audit.service.js";

/** Canned ClickHouse answers by statement; records every statement. */
function fakeClickHouse(options: { failOn?: string } = {}) {
	const statements: ClickHouseStatement[] = [];
	let writes = 0;
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {
			writes++;
		},
		insert: async () => {
			writes++;
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statements.push(statement);
			const query = statement.query;
			if (options.failOn && query.includes(options.failOn))
				throw new Error(
					"Limit for rows (controlled by 'max_rows_to_read') exceeded",
				);
			if (query.includes("FROM system.parts"))
				return [
					{
						table: "transcript_records",
						rows: 1_000,
						compressed: 100_000,
						uncompressed: 400_000,
					},
				] as T[];
			if (query.includes("session_superseded_rows"))
				return [
					{
						source: "claude_code",
						parser_version: 7,
						sessions: 4,
						with_superseded: 0,
						superseded_generations: 0,
						superseded_rows: 0,
					},
					{
						source: "claude_code",
						parser_version: 8,
						sessions: 6,
						with_superseded: 6,
						superseded_generations: 6,
						superseded_rows: 120,
					},
				] as T[];
			if (query.includes("with_agent_version"))
				return [
					{
						source: "claude_code",
						parser_version: 8,
						rows: 200,
						generations: 6,
						with_agent_version: 150,
						with_entrypoint: 150,
						with_facts: 50,
					},
				] as T[];
			if (query.includes("AS receipts"))
				return [
					{ source: "claude_code", parser_version: 8, receipts: 6 },
				] as T[];
			if (query.includes("staleExtractor"))
				return [
					{ source: "claude_code", state: "current", sessions: 6 },
					{ source: "claude_code", state: "none", sessions: 4 },
				] as T[];
			if (query.includes("FROM rudel.l1_edges FINAL"))
				return [{ relation: "pr_named", active: 3, retracted: 1 }] as T[];
			if (query.includes("FROM rudel.l1_edge_resolutions FINAL"))
				return [{ target: "pull_request", status: "linked", active: 3 }] as T[];
			if (query.includes("transcript_sessions"))
				return [
					{
						transcript_sessions: 10,
						indexed_sessions: 7,
						current: 5,
						usage_incomplete: 1,
						usage_unreceipted: 0,
					},
				] as T[];
			if (query.includes("countIf(snapshots > 1)"))
				return [{ indexed: 9, superseded: 2 }] as T[];
			return [];
		},
	};
	return { executor, statements, writes: () => writes };
}

function fakeSql() {
	const begins: string[] = [];
	const queries: string[] = [];
	const transaction = {
		unsafe: async (query: string) => {
			queries.push(query);
			if (query.includes("AS state"))
				return [
					{
						scope_kind: "session",
						resolver_version: 2,
						state: "built",
						scopes: 5,
					},
					{
						scope_kind: "run_index",
						resolver_version: null,
						state: "pending",
						scopes: 3,
					},
				];
			if (query.includes("oldest_seconds"))
				return [
					{
						scope_kind: "run_index",
						priority: 1,
						scopes: 3,
						oldest_seconds: 42.4,
					},
				];
			if (query.includes("truncated")) return [{ scopes: 1 }];
			return [];
		},
	};
	const sql = {
		begin: async (options: string, run: (tx: unknown) => Promise<unknown>) => {
			begins.push(options);
			return run(transaction);
		},
		unsafe: async (query: string) => {
			queries.push(`OUTSIDE ${query}`);
			return [];
		},
	} as unknown as postgres.Sql;
	return { sql, begins, queries };
}

describe("the L1 audit", () => {
	test("reads every layer within the analysis bounds and writes nothing", async () => {
		const clickhouse = fakeClickHouse();
		const pg = fakeSql();
		const report = await auditL1(clickhouse.executor, pg.sql, {
			organizationId: "org",
			now: () => new Date("2026-10-09T00:00:00.000Z"),
		});
		expect(clickhouse.writes()).toBe(0);
		expect(clickhouse.statements.length).toBeGreaterThan(0);
		for (const statement of clickhouse.statements) {
			expect(statement.clickhouse_settings).toMatchObject({
				...ANALYSIS_QUERY_SETTINGS,
				readonly: "2",
			});
			if (!statement.query.includes("system.parts"))
				expect(statement.query).toContain(
					"organization_id = {organizationId:String}",
				);
		}
		// Postgres reads run in one read-only transaction with a timeout.
		expect(pg.begins).toEqual(["read only"]);
		expect(pg.queries[0]).toContain("SET LOCAL statement_timeout");
		expect(pg.queries.some((query) => query.startsWith("OUTSIDE"))).toBe(false);

		expect(report).toMatchObject({
			organizationId: "org",
			transcripts: {
				committedByParser: {
					claude_code: {
						v7: { sessions: 4 },
						v8: { sessionsWithSuperseded: 6 },
					},
				},
				totals: {
					sessions: 10,
					supersededRows: 120,
					estimatedSupersededBytes: 12_000,
				},
			},
			transcriptFacts: {
				rowsByParser: {
					claude_code: {
						v8: {
							agentVersionShare: 0.75,
							factsShare: 0.25,
							committedReceipts: 6,
						},
					},
				},
			},
			gitObservations: {
				bySource: {
					claude_code: { current: 6, none: 4, staleExtractor: 0 },
				},
			},
			edgeScopes: {
				byState: {
					session: { built: { v2: 5 } },
					run_index: { pending: { none: 3 } },
				},
				due: { run_index: { priority1: { scopes: 3, oldestSeconds: 42 } } },
				truncatedSessionBuilds: 1,
			},
			edges: {
				byRelation: { pr_named: { active: 3, retracted: 1 } },
				resolutions: { pull_request: { linked: 3 } },
			},
			runIndex: {
				transcriptSessions: 10,
				indexed: 7,
				current: 5,
				stale: 2,
				missing: 3,
				usageIncomplete: 1,
				indexedWithoutTranscript: 2,
				sessionsWithSupersededSnapshots: 2,
			},
		});
	});

	test("a section over its bounds reports its error; the others still run", async () => {
		const clickhouse = fakeClickHouse({ failOn: "with_agent_version" });
		const report = await auditL1(clickhouse.executor, fakeSql().sql, {});
		expect(report.transcriptFacts).toEqual({
			error: "Limit for rows (controlled by 'max_rows_to_read') exceeded",
		});
		expect(report.runIndex).toMatchObject({ current: 5 });
		expect(report.organizationId).toBeNull();
		for (const statement of clickhouse.statements)
			expect(statement.query).not.toContain("{organizationId:String}");
	});

	test("its ClickHouse executor refuses writes", async () => {
		const clickhouse = fakeClickHouse();
		const readOnly = readOnlyClickHouse(clickhouse.executor);
		await expect(readOnly.execute({ query: "DELETE FROM x" })).rejects.toThrow(
			"read-only",
		);
		await expect(
			readOnly.insert({ table: "rudel.run_index", values: [{}] }),
		).rejects.toThrow("read-only");
		await readOnly.query({ query: "SELECT 1" });
		expect(clickhouse.statements[0]?.clickhouse_settings).toEqual({
			readonly: "2",
		});
		expect(clickhouse.writes()).toBe(0);
	});

	test("two reports compare by path", async () => {
		const before = await auditL1(fakeClickHouse().executor, fakeSql().sql, {
			organizationId: "org",
		});
		const after = structuredClone(before);
		if (!("error" in after.runIndex)) {
			after.runIndex.current = 9;
			after.runIndex.missing = 0;
		}
		const changes = compareL1Audits(JSON.parse(JSON.stringify(before)), after);
		expect(changes).toEqual([
			{ path: "runIndex.current", before: 5, after: 9, delta: 4 },
			{ path: "runIndex.missing", before: 3, after: 0, delta: -3 },
		]);
		expect(formatL1AuditChanges(changes)).toBe(
			"runIndex.current 5 -> 9 (+4)\nrunIndex.missing 3 -> 0 (-3)",
		);
		expect(formatL1AuditChanges([])).toBe("No changes.");
		const text = formatL1Audit(before);
		expect(text).toContain("[runIndex]");
		expect(text).toContain("  current 5");
		expect(text).toContain("agentVersionShare 75.0%");
	});

	test("its arguments need a scope", () => {
		expect(parseAuditL1Args(["--all-organizations", "--json"])).toEqual({
			organizationId: undefined,
			json: true,
			compare: undefined,
		});
		expect(() => parseAuditL1Args([])).toThrow("Name the scope");
		expect(() =>
			parseAuditL1Args(["--organization-id", "org", "--execute"]),
		).toThrow();
	});
});
