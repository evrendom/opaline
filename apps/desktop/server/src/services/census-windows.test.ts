import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildCensusWindowsStatement,
	CENSUS_WINDOW_INDEX_ROWS,
	type CensusSessionKey,
	type CensusWindow,
	censusWindowFilter,
	censusWindows,
	scanCensusWindows,
} from "./census-windows.js";

const key = (
	organizationId: string,
	userId: string,
	sessionId: string,
): CensusSessionKey => ({ organizationId, userId, sessionId });

const flat = (sql: string) => sql.replace(/\s+/gu, " ");

describe("census windows", () => {
	test("a window restricts a read to a range of the sort key prefix", () => {
		const filter = censusWindowFilter({
			from: key("org-a", "u1", "s1"),
			to: key("org-b", "u2", "s2"),
		});
		expect(flat(filter.sql)).toBe(
			"AND (organization_id > {fromOrganizationId:String} OR (organization_id = {fromOrganizationId:String} AND (user_id > {fromUserId:String} OR (user_id = {fromUserId:String} AND session_id >= {fromSessionId:String})))) AND (organization_id < {toOrganizationId:String} OR (organization_id = {toOrganizationId:String} AND (user_id < {toUserId:String} OR (user_id = {toUserId:String} AND session_id < {toSessionId:String}))))",
		);
		expect(filter.params).toEqual({
			fromOrganizationId: "org-a",
			fromSessionId: "s1",
			fromUserId: "u1",
			toOrganizationId: "org-b",
			toSessionId: "s2",
			toUserId: "u2",
		});
		expect(censusWindowFilter({}).params).toEqual({});
	});

	test("window starts come from the primary index marks, not the table", () => {
		const statement = buildCensusWindowsStatement({
			organizationId: "org-a",
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
			table: "rudel.transcript_records",
		});
		const sql = flat(statement.query);
		expect(sql).toContain(
			"FROM mergeTreeIndex({database:String}, {table:String})",
		);
		expect(sql).toContain("WHERE organization_id = {organizationId:String}");
		expect(sql).not.toContain("rudel.transcript_records");
		expect(statement.query_params).toMatchObject({
			database: "rudel",
			table: "transcript_records",
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
		});
		expect(statement.clickhouse_settings?.max_rows_to_read).toBe("1000000");
		expect(
			flat(
				buildCensusWindowsStatement({
					windowRows: 5,
					table: "rudel.transcript_records",
				}).query,
			),
		).not.toContain("WHERE");
	});

	test("windows cover every key once: open at both ends and consecutive", () => {
		expect(censusWindows([])).toEqual([{}]);
		expect(censusWindows([key("a", "u", "s")])).toEqual([{}]);
		const starts = [key("a", "u", "s"), key("b", "u", "s"), key("b", "v", "t")];
		expect(censusWindows(starts)).toEqual([
			{ to: starts[1] },
			{ from: starts[1], to: starts[2] },
			{ from: starts[2], to: undefined },
		]);
	});
});

describe("scanCensusWindows", () => {
	const starts = [
		{ organization_id: "org-a", user_id: "u1", session_id: "s0" },
		{ organization_id: "org-a", user_id: "u1", session_id: "s5" },
		{ organization_id: "org-b", user_id: "u2", session_id: "s1" },
	];
	const byWindow = new Map([
		["", ["s1"]],
		["s5", ["s6", "s7"]],
		["s1", ["s2"]],
	]);
	const executor = (queries: ClickHouseStatement[] = []) =>
		({
			async query<T>(statement: ClickHouseStatement) {
				queries.push(statement);
				return statement.query_params?.organizationId === "org-a"
					? []
					: (starts as T[]);
			},
		}) as unknown as ClickHouseExecutor;
	const scan = (
		options: { maxWindows?: number; rotation?: number; limit: number },
		reads: { window: CensusWindow; limit: number }[] = [],
	) =>
		scanCensusWindows<string>(executor(), {
			table: "rudel.transcript_records",
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
			wait: (operation) => operation(),
			read: async (window, limit) => {
				reads.push({ window, limit });
				return (byWindow.get(window.from?.sessionId ?? "") ?? []).slice(
					0,
					limit,
				);
			},
			...options,
		});

	test("reads windows in key order and stops once the pass is full", async () => {
		const reads: { window: CensusWindow; limit: number }[] = [];
		const result = await scan({ limit: 3 }, reads);
		expect(result).toMatchObject({
			rows: ["s1", "s6", "s7"],
			hasMore: true,
			windows: 3,
			windowsScanned: 2,
		});
		expect(reads.map((read) => read.limit)).toEqual([3, 2]);
		expect(reads.map((read) => read.window.from?.sessionId)).toEqual([
			undefined,
			"s5",
		]);
	});

	test("a pass reads at most its windows, starting where the rotation points", async () => {
		const result = await scan({ limit: 1_000, maxWindows: 2, rotation: 1 });
		expect(result).toMatchObject({
			rows: ["s2", "s1"],
			hasMore: true,
			windows: 3,
			windowsScanned: 2,
		});
	});

	test("an organization pass keeps the organization in the window statement", async () => {
		const queries: ClickHouseStatement[] = [];
		const result = await scanCensusWindows<string>(executor(queries), {
			table: "rudel.transcript_records",
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
			limit: 10,
			organizationId: "org-a",
			wait: (operation) => operation(),
			read: async () => [],
		});
		expect(result).toMatchObject({
			hasMore: false,
			windows: 1,
			windowsScanned: 1,
		});
		expect(queries[0]?.query).toContain(
			"organization_id = {organizationId:String}",
		);
	});
});
