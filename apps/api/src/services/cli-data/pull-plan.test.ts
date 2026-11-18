import { describe, expect, test } from "bun:test";
import {
	collect,
	contextOf,
	failure,
	fakeClickHouse,
	isSummary,
	summaryRow,
} from "./cli-data.fixtures.js";
import { pullPlan } from "./pull-plan.js";
import { exportSql } from "./sql-export.js";

const WORKSPACE = { id: "ws-1", slug: "acme" };
const isSizes = (query: { statement: { query: string } }) =>
	query.statement.query.includes("text_bytes");

describe("pullPlan", () => {
	test("selects by repository (full key or its last parts) and session day, with each session's record size", async () => {
		const { env, sent } = fakeClickHouse((query) =>
			isSummary(query)
				? [
						summaryRow("s-2", "user-1", "2026-11-02 09:00:00.000"),
						summaryRow("s-1", "user-2", "2026-11-01 09:00:00.000"),
					]
				: isSizes(query)
					? ['{"session_id":"s-1","records":10,"text_bytes":1000}']
					: [],
		);
		const plan = await pullPlan(contextOf(env), WORKSPACE, {
			repository: "acme/app",
			from: "2026-11-01",
			to: "2026-11-03",
		});
		const selection = sent.find(isSummary)?.statement.query ?? "";
		expect(selection).toContain("repository = 'acme/app'");
		expect(selection).toContain("endsWith(repository, '/acme/app')");
		expect(selection).toContain(
			"session_date >= toDateTime64('2026-11-01 00:00:00'",
		);
		expect(selection).toContain(
			"session_date < toDateTime64('2026-11-03 00:00:00', 3, 'UTC') + INTERVAL 1 DAY",
		);
		expect(sent.find(isSizes)?.statement.query_params).toMatchObject({
			ids: ["s-2", "s-1"],
			owners: ["user-1", "user-2"],
		});
		expect(plan).toEqual({
			workspace: WORKSPACE,
			scope: { repository: "acme/app", from: "2026-11-01", to: "2026-11-03" },
			sessions: [
				{
					sessionId: "s-1",
					source: "claude_code",
					startedAt: "2026-11-01T09:00:00.000Z",
					records: 10,
					bytes: 1000 + 10 * 256,
				},
				{
					sessionId: "s-2",
					source: "claude_code",
					startedAt: "2026-11-02T09:00:00.000Z",
					records: 0,
					bytes: 0,
				},
			],
			pattern: null,
			notices: [expect.stringContaining("1 sessions have no stored records")],
		});
	});

	test("intersects listed sessions with the other selectors and names the ones left out", async () => {
		const { env, sent } = fakeClickHouse((query) =>
			isSummary(query) ? [summaryRow("s-1")] : [],
		);
		const plan = await pullPlan(contextOf(env), WORKSPACE, {
			from: "2026-11-01",
			sessions: ["s-1", "s-2"],
		});
		const selection = sent.find(isSummary)?.statement.query ?? "";
		expect(selection).toContain("session_id IN ('s-1', 's-2')");
		expect(selection).toContain("session_date >=");
		expect(plan.sessions.map((session) => session.sessionId)).toEqual(["s-1"]);
		expect(plan.notices[0]).toContain("1 of 2 listed sessions");
	});

	test("refuses more than 2,000 sessions with PULL_TOO_LARGE naming the count", async () => {
		const { env } = fakeClickHouse((query) => {
			if (query.statement.query.includes("uniqExact"))
				return ['{"sessions":3456}'];
			if (isSummary(query))
				return Array.from({ length: 2001 }, (_, index) =>
					summaryRow(`s-${index}`),
				);
			return [];
		});
		const refused = await failure(() =>
			pullPlan(contextOf(env), WORKSPACE, { from: "2026-01-01" }),
		);
		expect(refused.code).toBe("PULL_TOO_LARGE");
		expect(refused.data).toEqual({ sessions: 3456, maxSessions: 2000 });
		expect(refused.message).toContain("3,456 sessions");
	});

	test("takes one unit of the quota per call", async () => {
		const { env } = fakeClickHouse(
			(query) => (isSummary(query) ? [summaryRow("s-1")] : []),
			{ queries: 1 },
		);
		await pullPlan(contextOf(env), WORKSPACE, { from: "2026-11-01" });
		const refused = await failure(() =>
			pullPlan(contextOf(env), WORKSPACE, { from: "2026-11-01" }),
		);
		expect(refused.code).toBe("QUOTA_EXCEEDED");
		expect(refused.status).toBe(429);
	});
});

describe("exportSql", () => {
	const rows = [
		'["session_id", "turns"]',
		'["s-1", 18446744073709551615]',
		'["s-2", 3]',
	];

	test("streams every row as JSONL, past the sql tool's 200-row cap", async () => {
		const many = [
			'["n"]',
			...Array.from({ length: 500 }, (_, index) => `[${index}]`),
		];
		const { env, sent } = fakeClickHouse(() => many);
		const chunks = await collect(
			exportSql(contextOf(env), "SELECT turn_idx AS n FROM runs", "jsonl"),
		);
		expect(sent[0]?.format).toBe("JSONCompactEachRowWithNames");
		expect(sent[0]?.statement.clickhouse_settings).not.toHaveProperty("limit");
		expect(chunks.at(-1)).toMatchObject({
			type: "done",
			rows: 500,
			columns: ["n"],
		});
	});

	test("writes CSV with a header that is not counted as a row", async () => {
		const { env } = fakeClickHouse(() => rows);
		const chunks = await collect(
			exportSql(contextOf(env), "SELECT session_id FROM runs", "csv"),
		);
		expect(chunks[0]).toEqual({
			type: "lines",
			text: "session_id,turns\ns-1,18446744073709551615\ns-2,3\n",
		});
		expect(chunks.at(-1)).toMatchObject({
			rows: 2,
			columns: ["session_id", "turns"],
		});
	});

	test("refuses what the sql tool refuses, before reading anything", async () => {
		const { env, sent } = fakeClickHouse(() => rows);
		const refused = await failure(() =>
			collect(exportSql(contextOf(env), "DROP TABLE runs", "jsonl")),
		);
		expect(["BAD_REQUEST", "FORBIDDEN"]).toContain(refused.code);
		expect(sent).toEqual([]);
	});

	test("takes one unit of the quota per call and then says QUOTA_EXCEEDED", async () => {
		const { env } = fakeClickHouse(() => rows, { queries: 1 });
		await collect(
			exportSql(contextOf(env), "SELECT session_id FROM runs", "jsonl"),
		);
		const refused = await failure(() =>
			collect(
				exportSql(contextOf(env), "SELECT session_id FROM runs", "jsonl"),
			),
		);
		expect(refused.code).toBe("QUOTA_EXCEEDED");
		expect(refused.data).toMatchObject({ resetsAt: expect.any(String) });
	});
});
