import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { parseRunIndexBackfillArgs } from "../../scripts/l1-script-args.js";
import { RUN_INDEX_VERSION } from "../analysis/run-index-sql.js";
import { sessionScopeId } from "./l1-edge-ids.js";
import {
	backfillRunIndex,
	buildRunIndexBackfillStatement,
	decodeRunIndexBackfillCursor,
	encodeRunIndexBackfillCursor,
	previewRunIndexBackfill,
	type RunIndexBackfillRow,
} from "./run-index-backfill.service.js";

const row = (
	sessionId: string,
	overrides: Partial<RunIndexBackfillRow> = {},
): RunIndexBackfillRow => ({
	organization_id: "org",
	user_id: "u1",
	session_id: sessionId,
	source: "claude_code",
	revision_text: "10",
	parser_version: 8,
	reason: "missing",
	...overrides,
});
const scopeOf = (sessionId: string, userId = "u1") =>
	sessionScopeId({ userId, source: "claude_code", sessionId });

function fakeClickHouse(rows: RunIndexBackfillRow[]) {
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
			return rows.slice(0, Number(statement.query_params?.limit)) as T[];
		},
	};
	return { executor, statements, writes: () => writes };
}

/** Postgres stand-in: answers scope reads from `scopes`, counts queued rows. */
function fakeSql(
	scopes: {
		scope_id: string;
		pending: boolean;
		frozen_reason: string | null;
		input: unknown;
	}[] = [],
) {
	const calls: { query: string; params: unknown[] }[] = [];
	const sql = {
		unsafe: async (query: string, params: unknown[] = []) => {
			calls.push({ query, params });
			if (query.trimStart().startsWith("SELECT")) {
				const ids = params[1] as string[];
				return scopes.filter((scope) => ids.includes(scope.scope_id));
			}
			return (params[2] as string[]).map(() => ({ "?column?": 1 }));
		},
	} as unknown as postgres.Sql;
	return { sql, calls };
}

describe("the run index backfill", () => {
	test("a preview reads ClickHouse and the queue but never writes", async () => {
		const clickhouse = fakeClickHouse([row("a"), row("b")]);
		const pg = fakeSql();
		const result = await previewRunIndexBackfill(clickhouse.executor, pg.sql, {
			organizationId: "org",
			maxSessions: 10,
		});
		expect(result).toMatchObject({
			status: "preview",
			candidates: 2,
			queued: 2,
			hasMore: false,
			next: null,
		});
		expect(clickhouse.writes()).toBe(0);
		expect(
			pg.calls.every((call) => call.query.trimStart().startsWith("SELECT")),
		).toBe(true);
	});

	test("queues run_index scopes at backfill priority, skipping waiting and frozen ones", async () => {
		const clickhouse = fakeClickHouse([
			row("missing"),
			row("pending", { reason: "generation" }),
			row("frozen"),
			row("refrozen", { reason: "index_version" }),
			row("bad-source", { source: "cursor" }),
		]);
		const pg = fakeSql([
			{
				scope_id: scopeOf("pending"),
				pending: true,
				frozen_reason: null,
				input: {},
			},
			{
				scope_id: scopeOf("frozen"),
				pending: false,
				frozen_reason: "session has 300000 records",
				input: {
					generation: {
						revision: "10",
						parserVersion: 8,
						indexVersion: RUN_INDEX_VERSION,
					},
				},
			},
			// Frozen at an older generation: the new one may fit.
			{
				scope_id: scopeOf("refrozen"),
				pending: false,
				frozen_reason: "session has 300000 records",
				input: {
					generation: { revision: "9", parserVersion: 8, indexVersion: 1 },
				},
			},
		]);
		const result = await backfillRunIndex(clickhouse.executor, pg.sql, {
			organizationId: "org",
			maxSessions: 10,
		});
		expect(result).toMatchObject({
			status: "queued",
			candidates: 5,
			alreadyQueued: 1,
			frozen: 1,
			queued: 2,
			byReason: { missing: 3, generation: 1, index_version: 1 },
		});
		const insert = pg.calls.find((call) => call.query.includes("INSERT"));
		expect(insert?.params.slice(0, 3)).toEqual([
			"org",
			"run_index",
			[scopeOf("missing"), scopeOf("refrozen")],
		]);
		// Priority 1: live scopes are claimed first.
		expect(insert?.params[6]).toBe(1);
		expect(clickhouse.writes()).toBe(0);
	});

	test("is bounded by maxSessions and continues after the last session", async () => {
		const clickhouse = fakeClickHouse([row("a"), row("b"), row("c")]);
		const result = await previewRunIndexBackfill(
			clickhouse.executor,
			fakeSql().sql,
			{ organizationId: "org", maxSessions: 2 },
		);
		expect(clickhouse.statements[0]?.query_params?.limit).toBe(2);
		expect(clickhouse.statements[0]?.clickhouse_settings).toMatchObject({
			max_result_rows: "2",
			result_overflow_mode: "throw",
		});
		expect(result.hasMore).toBe(true);
		expect(decodeRunIndexBackfillCursor(result.next ?? "")).toEqual({
			organizationId: "org",
			userId: "u1",
			sessionId: "b",
		});
	});

	test("rejects invalid options before reading", async () => {
		const clickhouse = fakeClickHouse([]);
		for (const options of [
			{ maxSessions: 0 },
			{ maxSessions: 10, organizationId: "" },
			{
				maxSessions: 10,
				organizationId: "org",
				after: { organizationId: "other", userId: "u", sessionId: "s" },
			},
		])
			await expect(
				previewRunIndexBackfill(clickhouse.executor, fakeSql().sql, options),
			).rejects.toThrow();
		expect(clickhouse.statements).toEqual([]);
	});
});

describe("the run index backfill selection", () => {
	test("reads committed transcripts, not edges, and compares the committed snapshot", () => {
		const { query, query_params } = buildRunIndexBackfillStatement({
			organizationId: "org",
			limit: 5,
			after: { organizationId: "org", userId: "u", sessionId: "s" },
		});
		expect(query).toContain("FROM rudel.transcript_records");
		expect(query).toContain("FROM rudel.run_index");
		expect(query).not.toContain("l1_edges");
		expect(query).not.toContain("session_git_observations");
		expect(query).toContain(
			"tuple(revision, parser_version, index_version, build_revision)",
		);
		expect(query).toContain("indexed.committed.4 != {pricingVersion:String}");
		expect(query).toContain("> ({afterOrganizationId:String}");
		expect(query_params).toMatchObject({
			organizationId: "org",
			afterUserId: "u",
			indexVersion: RUN_INDEX_VERSION,
			limit: 5,
		});
	});

	test("cursors round-trip and reject anything else", () => {
		const cursor = { organizationId: "o/1", userId: "u 1", sessionId: "s" };
		expect(
			decodeRunIndexBackfillCursor(encodeRunIndexBackfillCursor(cursor)),
		).toEqual(cursor);
		expect(() => decodeRunIndexBackfillCursor("nope")).toThrow("--after");
	});

	test("its arguments preview by default and need a scope", () => {
		expect(parseRunIndexBackfillArgs(["--organization-id", "org"])).toEqual({
			organizationId: "org",
			execute: false,
			maxSessions: 10_000,
			after: undefined,
		});
		expect(() => parseRunIndexBackfillArgs(["--execute"])).toThrow(
			"Name the scope",
		);
		expect(() =>
			parseRunIndexBackfillArgs(["--all-organizations", "--max-sessions", "0"]),
		).toThrow("--max-sessions");
		expect(() =>
			parseRunIndexBackfillArgs([
				"--all-organizations",
				"--max-sessions",
				"100001",
			]),
		).toThrow("at most");
	});
});
