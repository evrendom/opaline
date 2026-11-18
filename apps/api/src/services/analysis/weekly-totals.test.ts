import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	AnalysisFindOutputSchema,
	WEEKLY_MEASURES,
	WEEKLY_NULLABLE_MEASURES,
} from "@rudel/api-routes";
import { WEEKLY_TOTALS_MEASURES } from "@rudel/ch-schema/weekly-totals";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { findScope } from "./scope.js";
import {
	buildWeeklyRowsStatement,
	buildWeeklySnapshotStatement,
	findWeeklyTotals,
	measureKey,
	weeklyRange,
} from "./weekly-totals.js";

const ORG = { organizationId: "org", userId: null };
const SNAPSHOT = {
	refresh_id: "clickhouse-0 2026-10-11 03:00:01.000000",
	refreshed_text: "2026-10-11 03:00:01.000000",
};

/** A stored row: every measure zero or unknown unless given. */
function stored(
	week: string,
	member: string,
	agent: "claude_code" | "codex",
	values: Record<string, number | string | null> = {},
) {
	return {
		user_id: member,
		agent,
		week,
		sessions: "1",
		...Object.fromEntries(
			WEEKLY_TOTALS_MEASURES.filter(
				(measure) => measure.name !== "sessions",
			).map((measure) => [
				measure.name,
				measure.type.startsWith("Nullable(") ? null : "0",
			]),
		),
		...values,
	};
}

const ROWS = [
	stored("2026-10-05", "u1", "claude_code", {
		runs: "4",
		sessions_started: "1",
		denied_calls_known_runs: "4",
		denied_calls: "3",
		usage_known_runs: "4",
		cost_usd: 1.25,
		minutes: 10.5,
	}),
	stored("2026-10-05", "u2", "codex", {
		runs: "2",
		sessions_started: "1",
		denied_calls_known_runs: "0",
		usage_known_runs: "1",
		cost_usd: 0.5,
	}),
	stored("2026-09-28", "u1", "claude_code", {
		runs: "1",
		sessions_started: "0",
		denied_calls_known_runs: "1",
		denied_calls: "0",
		usage_known_runs: "1",
	}),
];

/** An executor serving the snapshot (unless `snapshot` is null) and the rows. */
function executor(
	snapshot: typeof SNAPSHOT | null = SNAPSHOT,
	rows: readonly Record<string, unknown>[] = ROWS,
) {
	const statements: ClickHouseStatement[] = [];
	const fake = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async (statement: ClickHouseStatement) => {
			statements.push(statement);
			if (statement.query.includes("GROUP BY refresh_id"))
				return snapshot ? [snapshot] : [];
			return rows;
		},
	} as unknown as ClickHouseExecutor;
	return { fake, statements };
}

const input = (args: Record<string, unknown>) =>
	AnalysisFindInputSchema.parse({ source: "weekly", ...args });

describe("weekly totals", () => {
	test("the contract names every stored measure, with the same nullability", () => {
		const stored = WEEKLY_TOTALS_MEASURES.filter(
			(measure) => measure.name !== "sessions",
		);
		expect(
			stored
				.filter((measure) => !measure.type.startsWith("Nullable("))
				.map((measure) => measureKey(measure.name))
				.sort(),
		).toEqual([...WEEKLY_MEASURES].sort());
		expect(
			stored
				.filter((measure) => measure.type.startsWith("Nullable("))
				.map((measure) => measureKey(measure.name))
				.sort(),
		).toEqual([...WEEKLY_NULLABLE_MEASURES].sort());
		expect(measureKey("cache_write_5m_input_tokens")).toBe(
			"cacheWrite5mInputTokens",
		);
	});

	test("covers whole ISO weeks: by default the week of to and the 11 before it", () => {
		expect(weeklyRange({}, "2026-10-11")).toEqual({
			fromWeek: "2026-07-20",
			to: "2026-10-11",
		});
		expect(weeklyRange({ from: "2026-09-02", to: "2026-09-30" })).toEqual({
			fromWeek: "2026-08-31",
			to: "2026-09-30",
		});
	});

	test("reads one snapshot of the workspace, one member's rows only when the scope names one", () => {
		const member = buildWeeklyRowsStatement({
			organizationId: "org",
			userId: "u1",
			refreshId: "r",
			fromWeek: "2026-08-31",
			to: "2026-09-30",
			agent: "codex",
		});
		expect(member.query).toContain("organization_id = {organizationId:String}");
		expect(member.query).toContain("refresh_id = {refreshId:String}");
		expect(member.query).toContain("user_id = {userId:String}");
		expect(member.query).toContain("agent = {agent:String}");
		expect(member.query_params).toMatchObject({ userId: "u1", agent: "codex" });
		const admin = buildWeeklyRowsStatement({
			organizationId: "org",
			userId: null,
			refreshId: "r",
			fromWeek: "2026-08-31",
			to: "2026-09-30",
		});
		expect(admin.query).not.toContain("user_id = {userId:String}");
		expect(admin.query).not.toContain("agent = {agent:String}");
		expect(buildWeeklySnapshotStatement().query).toContain(
			"HAVING count() = any(snapshot_rows)",
		);
		expect(buildWeeklySnapshotStatement("r").query_params).toEqual({
			refreshId: "r",
		});
	});

	test("returns the stored rows newest week first, with unknown sums as null", async () => {
		const { fake } = executor();
		const { output, owners } = await findWeeklyTotals(
			fake,
			ORG,
			input({ from: "2026-09-28", to: "2026-10-11" }),
			"2026-10-11",
		);
		expect(AnalysisFindOutputSchema.parse(output)).toEqual(output);
		if (output.source !== "weekly") throw new Error("not weekly");
		expect(owners).toEqual(["u1", "u2"]);
		expect(output.snapshot).toEqual({
			id: SNAPSHOT.refresh_id,
			refreshedAt: "2026-10-11T03:00:01.000Z",
		});
		expect(
			output.totals.map((total) => [
				total.week,
				total.member,
				total.agent,
				total.runs,
				total.deniedCalls,
			]),
		).toEqual([
			["2026-10-05", "u1", "claude_code", 4, 3],
			["2026-10-05", "u2", "codex", 2, null],
			["2026-09-28", "u1", "claude_code", 1, 0],
		]);
		expect(output.header).toMatchObject({
			from: "2026-09-28",
			to: "2026-10-11",
			runsInScope: 7,
			sessionsInScope: 2,
			pricedCostUsd: 1.75,
			unpricedRuns: 1,
			minutes: 10.5,
		});
		expect(output.header.notes.join("\n")).toContain(
			"the week of 2026-10-05 is partial",
		);
		expect(output.header.notes.join("\n")).toContain("deniedCalls 5 of 7");
	});

	test("a gated sum of a row whose known runs are 0 is unknown, as in a snapshot taken before its known-runs column", async () => {
		const { fake } = executor(SNAPSHOT, [
			// Written by the view before not_found_known_runs existed (default 0).
			stored("2026-10-05", "u1", "claude_code", {
				runs: "3",
				not_found: "5",
			}),
			stored("2026-10-05", "u2", "claude_code", {
				runs: "2",
				not_found_known_runs: "2",
				not_found: "1",
			}),
		]);
		const { output } = await findWeeklyTotals(
			fake,
			ORG,
			input({ from: "2026-10-05", to: "2026-10-11" }),
			"2026-10-11",
		);
		if (output.source !== "weekly") throw new Error("not weekly");
		expect(
			output.totals.map((total) => [
				total.member,
				total.notFoundKnownRuns,
				total.notFound,
			]),
		).toEqual([
			["u1", 0, null],
			["u2", 2, 1],
		]);
	});

	test("groups by member across weeks: sums stay known where any row knows them, sessions do not add up", async () => {
		const { fake } = executor();
		const { output } = await findWeeklyTotals(
			fake,
			ORG,
			input({ groupBy: "member" }),
			"2026-10-11",
		);
		if (output.source !== "weekly") throw new Error("not weekly");
		expect(
			output.totals.map((total) => ({
				member: total.member,
				week: total.week,
				weeks: total.weeks,
				sessions: total.sessions,
				sessionsStarted: total.sessionsStarted,
				runs: total.runs,
				deniedCalls: total.deniedCalls,
				deniedCallsKnownRuns: total.deniedCallsKnownRuns,
				costUsd: total.costUsd,
			})),
		).toEqual([
			{
				member: "u1",
				week: null,
				weeks: 2,
				sessions: null,
				sessionsStarted: 1,
				runs: 5,
				deniedCalls: 3,
				deniedCallsKnownRuns: 5,
				costUsd: 1.25,
			},
			{
				member: "u2",
				week: null,
				weeks: 1,
				sessions: 1,
				sessionsStarted: 1,
				runs: 2,
				deniedCalls: null,
				deniedCallsKnownRuns: 0,
				costUsd: 0.5,
			},
		]);
	});

	test("a cursor keeps reading the snapshot of its first page", async () => {
		const first = await findWeeklyTotals(
			executor().fake,
			ORG,
			input({ limit: 2 }),
			"2026-10-11",
		);
		const cursor = first.output.header.cursor;
		expect(cursor).toBeDefined();
		const { fake, statements } = executor();
		const second = await findWeeklyTotals(
			fake,
			ORG,
			input({ limit: 2, cursor }),
			"2026-10-11",
		);
		expect(statements[0]?.query_params).toEqual({
			refreshId: SNAPSHOT.refresh_id,
		});
		if (second.output.source !== "weekly") throw new Error("not weekly");
		expect(second.output.totals.map((total) => total.week)).toEqual([
			"2026-09-28",
		]);
		expect(second.output.header.cursor).toBeUndefined();
		await expect(
			findWeeklyTotals(
				executor(null).fake,
				ORG,
				input({ limit: 2, cursor }),
				"2026-10-11",
			),
		).rejects.toThrow("weekly snapshot");
	});

	test("before the first refresh, says so instead of returning zeros", async () => {
		const { output } = await findWeeklyTotals(
			executor(null).fake,
			ORG,
			input({}),
			"2026-10-11",
		);
		expect(output).toMatchObject({ snapshot: null, totals: [] });
		expect(output.header.notes[0]).toContain("no snapshot yet");
	});

	test("a member's find covers every member's sessions in the workspace", () => {
		const member = { userId: "u1", role: "member", ownSessionsOnly: false };
		for (const source of [
			"runs",
			"tool",
			"user",
			"git",
			"calls",
			"weekly",
		] as const)
			expect(findScope("org", member, { source })).toEqual({
				organizationId: "org",
				userId: null,
			});
		expect(findScope("org", member, { source: "runs", userId: "u2" })).toEqual({
			organizationId: "org",
			userId: "u2",
		});
	});

	test("with the own-sessions option on, a member reads the whole workspace's weekly totals; other finds stay their own", () => {
		const member = { userId: "u1", role: "member", ownSessionsOnly: true };
		expect(findScope("org", member, { source: "weekly" })).toEqual({
			organizationId: "org",
			userId: null,
		});
		for (const source of ["runs", "tool", "user", "git", "calls"] as const)
			expect(findScope("org", member, { source })).toEqual({
				organizationId: "org",
				userId: "u1",
			});
		expect(
			findScope(
				"org",
				{ ...member, role: "admin" },
				{ source: "weekly", userId: "u2" },
			),
		).toEqual({ organizationId: "org", userId: "u2" });
	});

	test("a member sees teammates' rows in their own workspace and nothing outside it", async () => {
		// The table as stored: two members of the caller's workspace, one of another.
		const table = [
			{ ...ROWS[0], organization_id: "org" },
			{ ...ROWS[1], organization_id: "org" },
			{
				...stored("2026-10-05", "u3", "codex", { runs: "9" }),
				organization_id: "other",
			},
		];
		const statements: ClickHouseStatement[] = [];
		const fake = {
			close: async () => {},
			execute: async () => {},
			insert: async () => {},
			query: async (statement: ClickHouseStatement) => {
				statements.push(statement);
				if (statement.query.includes("GROUP BY refresh_id")) return [SNAPSHOT];
				const params = statement.query_params as Record<string, string>;
				return table
					.filter(
						(row) =>
							row.organization_id === params.organizationId &&
							(params.userId === undefined || row.user_id === params.userId),
					)
					.map(({ organization_id: _, ...row }) => row);
			},
		} as unknown as ClickHouseExecutor;
		const { output, owners } = await findWeeklyTotals(
			fake,
			findScope(
				"org",
				{ userId: "u1", role: "member", ownSessionsOnly: true },
				{ source: "weekly" },
			),
			input({ groupBy: "member" }),
			"2026-10-11",
		);
		if (output.source !== "weekly") throw new Error("not weekly");
		expect(output.totals.map((total) => total.member)).toEqual(["u1", "u2"]);
		expect(owners).toEqual(["u1", "u2"]);
		const rows = statements.find(
			(statement) => !statement.query.includes("GROUP BY refresh_id"),
		);
		expect(rows?.query).toContain("organization_id = {organizationId:String}");
		expect(rows?.query).not.toContain("user_id = {userId:String}");
		expect(rows?.query_params).toMatchObject({ organizationId: "org" });
	});
});
