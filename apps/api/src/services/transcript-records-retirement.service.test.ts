import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildTranscriptRecordsCensusWindowsStatement,
	buildTranscriptRecordsRetirementCensusStatement,
	CENSUS_WINDOW_INDEX_ROWS,
	CENSUS_WINDOW_SETTINGS,
	runTranscriptRecordsRetirementPass,
	type TranscriptRecordsSessionKey,
	transcriptRecordsCensusWindows,
} from "./transcript-records-retirement.service.js";

const key = (
	organizationId: string,
	userId: string,
	sessionId: string,
): TranscriptRecordsSessionKey => ({ organizationId, userId, sessionId });

const flat = (sql: string) => sql.replace(/\s+/gu, " ");

describe("transcript records retirement census", () => {
	test("a window restricts the census to a range of the sort key prefix", () => {
		const statement = buildTranscriptRecordsRetirementCensusStatement({
			limit: 10,
			organizationId: "org-a",
			retireBefore: 1_000,
			window: { from: key("org-a", "u1", "s1"), to: key("org-b", "u2", "s2") },
		});
		const sql = flat(statement.query);
		expect(sql).toContain("AND organization_id = {organizationId:String}");
		expect(sql).toContain(
			"AND (organization_id > {fromOrganizationId:String} OR (organization_id = {fromOrganizationId:String} AND (user_id > {fromUserId:String} OR (user_id = {fromUserId:String} AND session_id >= {fromSessionId:String}))))",
		);
		expect(sql).toContain(
			"AND (organization_id < {toOrganizationId:String} OR (organization_id = {toOrganizationId:String} AND (user_id < {toUserId:String} OR (user_id = {toUserId:String} AND session_id < {toSessionId:String}))))",
		);
		expect(sql).toContain(
			"WHERE agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0 AND kind = 'receipt'",
		);
		expect(statement.query_params).toMatchObject({
			fromOrganizationId: "org-a",
			fromSessionId: "s1",
			fromUserId: "u1",
			maxSessions: 10,
			organizationId: "org-a",
			toOrganizationId: "org-b",
			toSessionId: "s2",
			toUserId: "u2",
		});
	});

	test("the census has an explicit per-window read budget", () => {
		const statement = buildTranscriptRecordsRetirementCensusStatement({
			limit: 10,
			retireBefore: 1_000,
			window: { to: key("org-a", "u1", "s1") },
		});
		expect(statement.clickhouse_settings).toEqual(CENSUS_WINDOW_SETTINGS);
		expect(CENSUS_WINDOW_SETTINGS).toEqual({
			max_bytes_to_read: String(1024 ** 3),
			max_execution_time: 10,
			max_rows_to_read: String(2 * CENSUS_WINDOW_INDEX_ROWS),
			result_overflow_mode: "throw",
		});
		expect(flat(statement.query)).not.toContain("{from");
		expect(statement.query_params).not.toHaveProperty("fromOrganizationId");
	});

	test("window starts come from the primary index marks, not the table", () => {
		const statement = buildTranscriptRecordsCensusWindowsStatement({
			organizationId: "org-a",
			windowRows: CENSUS_WINDOW_INDEX_ROWS,
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
				buildTranscriptRecordsCensusWindowsStatement({ windowRows: 5 }).query,
			),
		).not.toContain("WHERE");
	});

	test("windows cover every key once: open at both ends and consecutive", () => {
		expect(transcriptRecordsCensusWindows([])).toEqual([{}]);
		expect(transcriptRecordsCensusWindows([key("a", "u", "s")])).toEqual([{}]);
		const starts = [key("a", "u", "s"), key("b", "u", "s"), key("b", "v", "t")];
		expect(transcriptRecordsCensusWindows(starts)).toEqual([
			{ to: starts[1] },
			{ from: starts[1], to: starts[2] },
			{ from: starts[2], to: undefined },
		]);
	});
});

function fakeExecutor(input: {
	starts: { organization_id: string; user_id: string; session_id: string }[];
	censusByWindow: Map<
		string,
		{ organization_id: string; user_id: string; session_id: string }[]
	>;
}) {
	const queries: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			queries.push(statement);
			if (statement.query.includes("mergeTreeIndex"))
				return input.starts as T[];
			if (statement.query.includes("HAVING uniqExact")) {
				const from = String(statement.query_params?.fromSessionId ?? "");
				const rows = (input.censusByWindow.get(from) ?? []).map((row) => ({
					...row,
					parser_version: 12,
					receipt_head: "",
					revision_text: "2",
				}));
				return rows.slice(
					0,
					Number(statement.query_params?.maxSessions),
				) as T[];
			}
			return [];
		},
	};
	return { executor, queries };
}

describe("runTranscriptRecordsRetirementPass", () => {
	const starts = [
		{ organization_id: "org-a", user_id: "u1", session_id: "s0" },
		{ organization_id: "org-a", user_id: "u1", session_id: "s5" },
		{ organization_id: "org-b", user_id: "u2", session_id: "s1" },
	];
	const session = (organization_id: string, session_id: string) => ({
		organization_id,
		session_id,
		user_id: "u1",
	});
	const deadline = { deadlineAt: 1_000_000, now: () => 1_000 };

	test("scans windows in key order and stops once the pass is full", async () => {
		const fake = fakeExecutor({
			starts,
			censusByWindow: new Map([
				["", [session("org-a", "s1")]],
				["s5", [session("org-a", "s6"), session("org-a", "s7")]],
				["s1", [session("org-b", "s2")]],
			]),
		});
		const result = await runTranscriptRecordsRetirementPass({
			deadline,
			executor: fake.executor,
			maxSessions: 3,
		});
		expect(result).toMatchObject({
			hasMore: true,
			sessionsProcessed: 3,
			windows: 3,
			windowsScanned: 2,
		});
		const census = fake.queries.filter((query) =>
			query.query.includes("HAVING uniqExact"),
		);
		expect(census.map((query) => query.query_params?.maxSessions)).toEqual([
			3, 2,
		]);
		expect(census[0]?.query_params).toMatchObject({ toSessionId: "s5" });
		expect(census[0]?.query_params).not.toHaveProperty("fromSessionId");
		expect(census[1]?.query_params).toMatchObject({
			fromSessionId: "s5",
			toSessionId: "s1",
		});
		for (const query of census)
			expect(query.clickhouse_settings).toEqual(CENSUS_WINDOW_SETTINGS);
	});

	test("an organization pass keeps the organization in every statement", async () => {
		const fake = fakeExecutor({ starts: [], censusByWindow: new Map() });
		const result = await runTranscriptRecordsRetirementPass({
			deadline,
			executor: fake.executor,
			organizationId: "org-a",
		});
		expect(result).toMatchObject({
			hasMore: false,
			sessionsProcessed: 0,
			windows: 1,
			windowsScanned: 1,
		});
		expect(fake.queries).toHaveLength(2);
		for (const query of fake.queries) {
			expect(query.query).toContain(
				"organization_id = {organizationId:String}",
			);
			expect(query.query_params?.organizationId).toBe("org-a");
		}
	});
});
