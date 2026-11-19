import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { parseL1EdgeBackfillArgs } from "../../scripts/l1-script-args.js";
import {
	backfillL1Edges,
	decodeL1EdgeBackfillCursor,
} from "./l1-edge-backfill.service.js";
import { sessionScopeId } from "./l1-edge-ids.js";

const session = (sessionId: string, source = "claude_code") => ({
	organization_id: "org",
	user_id: "u",
	source,
	session_id: sessionId,
});

function fakes(input: {
	observed: ReturnType<typeof session>[];
	captured: ReturnType<typeof session>[];
	repositories?: { organization_id: string; repository_id: string }[];
}) {
	const statements: ClickHouseStatement[] = [];
	let clickhouseWrites = 0;
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {
			clickhouseWrites++;
		},
		insert: async () => {
			clickhouseWrites++;
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statements.push(statement);
			return input.observed.slice(
				0,
				Number(statement.query_params?.limit),
			) as T[];
		},
	};
	const calls: { query: string; params: unknown[] }[] = [];
	const sql = {
		unsafe: async (query: string, params: unknown[] = []) => {
			calls.push({ query, params });
			if (query.includes("github_repository_binding"))
				return input.repositories ?? [];
			if (query.includes("repository_evidence_capture"))
				return input.captured.slice(0, Number(params[1]));
			if (query.includes("unnest($3::text[]")) return params[2] as string[];
			return [];
		},
	} as unknown as postgres.Sql;
	const writes = () =>
		calls.filter((call) => call.query.includes("INSERT INTO l1_edge_scope"));
	return {
		executor,
		sql,
		calls,
		statements,
		writes,
		clickhouseWrites: () => clickhouseWrites,
	};
}

describe("the L1 edge backfill", () => {
	test("a preview counts and writes nothing", async () => {
		const fake = fakes({
			observed: [session("a"), session("b")],
			captured: [session("b"), session("c", "codex")],
			repositories: [{ organization_id: "org", repository_id: "101" }],
		});
		const result = await backfillL1Edges(
			fake.executor,
			fake.sql,
			{ organizationId: "org", maxSessions: 10 },
			false,
		);
		expect(result).toMatchObject({
			status: "preview",
			repositories: 1,
			sessions: 3,
			hasMore: false,
			next: null,
		});
		expect(fake.writes()).toEqual([]);
		expect(fake.clickhouseWrites()).toBe(0);
	});

	test("queues repositories first, then sessions in bulk, at backfill priority", async () => {
		const fake = fakes({
			observed: [session("a"), session("b")],
			captured: [session("b"), session("c", "cursor")],
			repositories: [{ organization_id: "org", repository_id: "101" }],
		});
		await backfillL1Edges(
			fake.executor,
			fake.sql,
			{ organizationId: "org", maxSessions: 10 },
			true,
		);
		const [repository, sessions] = fake.writes();
		expect(repository?.params.slice(0, 3)).toEqual([
			"org",
			["repository"],
			"101",
		]);
		expect(repository?.params[7]).toBe(1);
		expect(sessions?.params.slice(0, 3)).toEqual([
			"org",
			"session",
			[
				sessionScopeId({ userId: "u", source: "claude_code", sessionId: "a" }),
				sessionScopeId({ userId: "u", source: "claude_code", sessionId: "b" }),
			],
		]);
		expect(sessions?.params[6]).toBe(1);
	});

	test("pages by key: bounded statements, a cursor, and repositories only on the first page", async () => {
		const fake = fakes({
			observed: [session("a"), session("c"), session("e")],
			captured: [session("b"), session("d")],
			repositories: [{ organization_id: "org", repository_id: "101" }],
		});
		const first = await backfillL1Edges(
			fake.executor,
			fake.sql,
			{ organizationId: "org", maxSessions: 2 },
			true,
		);
		expect(first).toMatchObject({ sessions: 2, hasMore: true });
		expect(fake.statements[0]?.clickhouse_settings).toMatchObject({
			max_result_rows: "2",
			result_overflow_mode: "throw",
		});
		expect(fake.writes()[1]?.params[2]).toEqual([
			sessionScopeId({ userId: "u", source: "claude_code", sessionId: "a" }),
			sessionScopeId({ userId: "u", source: "claude_code", sessionId: "b" }),
		]);
		const after = decodeL1EdgeBackfillCursor(first.next ?? "");
		expect(after).toEqual({
			organizationId: "org",
			userId: "u",
			source: "claude_code",
			sessionId: "b",
		});
		const again = fakes({ observed: [], captured: [] });
		const second = await backfillL1Edges(
			again.executor,
			again.sql,
			{ organizationId: "org", maxSessions: 2, after },
			true,
		);
		expect(second.repositories).toBe(0);
		expect(again.calls.some((call) => call.query.includes("binding"))).toBe(
			false,
		);
		expect(again.statements[0]?.query_params).toMatchObject({
			afterSessionId: "b",
			afterSource: "claude_code",
		});
		const capture = again.calls.find((call) =>
			call.query.includes("repository_evidence_capture"),
		);
		expect(capture?.query).toContain('COLLATE "C"');
		expect(capture?.params.slice(2)).toEqual(["org", "u", "claude_code", "b"]);
	});

	test("rejects invalid options and arguments", async () => {
		const fake = fakes({ observed: [], captured: [] });
		for (const options of [
			{ maxSessions: 0 },
			{ maxSessions: Number.NaN },
			{ maxSessions: 1, organizationId: "" },
			{
				maxSessions: 1,
				organizationId: "org",
				after: {
					organizationId: "other",
					userId: "u",
					source: "codex",
					sessionId: "s",
				},
			},
		])
			await expect(
				backfillL1Edges(fake.executor, fake.sql, options, false),
			).rejects.toThrow();
		expect(fake.statements).toEqual([]);
		expect(() => parseL1EdgeBackfillArgs([])).toThrow("Name the scope");
		expect(
			parseL1EdgeBackfillArgs(["--organization-id", "org", "--execute"]),
		).toMatchObject({ execute: true, maxSessions: 10_000 });
		expect(() => decodeL1EdgeBackfillCursor("x")).toThrow("--after");
	});
});
