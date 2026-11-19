import { describe, expect, test } from "bun:test";
import { SQL_QUERY_MAX_CHARS } from "@rudel/api-routes";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	type MeasureParams,
	unhappyWordsPattern,
} from "./retro-measure-sql.js";
import {
	cohortSelect,
	describeMeasure,
	driftNotice,
	findRetroMeasure,
	listMeasures,
	measureHash,
	measureParams,
	RETRO_MEASURES,
} from "./retro-measures.js";
import { runSql } from "./sql-gateway.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import { SQL_MEASURES } from "./sql-measures.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
	openSqlResult,
} from "./sql-results.js";
import { SQL_VIEWS } from "./sql-views.js";

const today = new Date("2026-11-04T10:00:00Z");
const params: MeasureParams = {
	from: "2026-10-06",
	to: "2026-11-03",
	repository: "athena",
	latest: 50,
	limit: 30,
};

function guarded(sql: string) {
	const windows = new Map<string, SqlWindow[]>();
	const prepared = prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) => {
						const { words: _words, ...range } = window;
						windows.set(view.name, [...(windows.get(view.name) ?? []), range]);
						return view.sql(false, window);
					},
				},
			]),
		),
		new Set(),
	);
	return { prepared, windows };
}

describe("retro measures", () => {
	test("every query measure passes the sql guard, fits a stored sql step and names example runs", () => {
		for (const measure of RETRO_MEASURES) {
			const sql = measure.build(params);
			const { prepared } = guarded(sql);
			expect({ name: measure.name, ok: prepared.ok }).toEqual({
				name: measure.name,
				ok: true,
			});
			expect(sql.length).toBeLessThan(SQL_QUERY_MAX_CHARS);
			expect(sql).toContain("picked AS (");
			expect(sql).toContain("LIMIT 30");
			expect(sql).toMatch(/AS session_id\b|SELECT p\.session_id AS session_id/);
			expect(sql).toMatch(/AS turn_idx\b/);
		}
	});

	test("measures that read calls or prompts keep the window start in that view's WHERE, so the gateway reads only those sessions", () => {
		for (const name of [
			"time_lost_by_cause",
			"repeated_commands",
			"files_hunted_before_edit",
			"local_pass_then_ci_fail",
		]) {
			const { windows } = guarded(findRetroMeasure(name)?.build(params) ?? "");
			expect({ name, calls: windows.get("calls") }).toEqual({
				name,
				calls: [{ from: "toDateTime64 ( '2026-10-06 00:00:00' , 3 , 'UTC' )" }],
			});
		}
		const corrections = guarded(
			findRetroMeasure("repeated_corrections")?.build(params) ?? "",
		);
		expect(corrections.windows.get("prompts")).toEqual([
			{ from: "toDateTime64 ( '2026-10-06 00:00:00' , 3 , 'UTC' )" },
		]);
	});

	test("files_hunted_before_edit reads calls once and joins nothing across sessions", () => {
		const sql =
			findRetroMeasure("files_hunted_before_edit")?.build(params) ?? "";
		expect(sql.match(/FROM calls/g)?.length).toBe(1);
		expect(sql).not.toMatch(/CROSS JOIN/i);
		expect(guarded(sql).windows.get("calls")?.length).toBe(1);
	});

	test("the cohort is the latest main-stream sessions of the repository that started in the window", () => {
		const sql = cohortSelect(params);
		expect(sql).toContain(
			"WHERE agent_id = '' AND ifNull(thread_source, '') != 'subagent'",
		);
		expect(sql).toContain(
			"AND (repository = 'athena' OR endsWith(repository, '/athena'))",
		);
		expect(sql).toContain(
			"HAVING session_start >= toDateTime64('2026-10-06 00:00:00', 3, 'UTC') AND session_start < toDateTime64('2026-11-04 00:00:00', 3, 'UTC')",
		);
		expect(sql).toContain("ORDER BY session_start DESC, session_id");
		expect(sql).toContain("LIMIT 50");
		const listed = cohortSelect({
			...params,
			latest: undefined,
			repository: undefined,
			sessions: ["s-1", "it's"],
		});
		expect(listed).toContain("AND session_id IN ('s-1', 'it\\'s')");
		expect(listed).not.toContain("repository =");
		expect(listed).not.toMatch(/LIMIT \d/);
	});

	test("parameters default to the last 30 days and refuse a reversed or too long window", () => {
		expect(measureParams({}, today)).toEqual({
			from: "2026-10-06",
			to: "2026-11-04",
			limit: 50,
		});
		expect(
			measureParams({ from: "2026-11-05", to: "2026-11-01" }, today),
		).toEqual({ error: "from 2026-11-05 is after to 2026-11-01" });
		expect(
			"error" in measureParams({ from: "2026-01-01", to: "2026-11-01" }, today),
		).toBe(true);
	});

	test("the unhappy word pattern holds every negative and swear surface and no positive one", () => {
		const pattern = unhappyWordsPattern();
		expect(pattern).toContain("does\\s+not\\s+work");
		expect(pattern).toContain("didn['’]t\\s+work");
		expect(pattern).not.toContain("|thanks|");
		expect(pattern).toContain("(?:fuck|fcuk|fukc)");
		expect(pattern).not.toContain("(?=");
		expect(pattern).not.toContain("(?<");
		expect(() => new RegExp(pattern.replace("(?i)", ""), "u")).not.toThrow();
	});

	test("list shows the approved aggregates and query measures; describe gives SQL, columns and traps", () => {
		const listed = listMeasures();
		expect(listed.map((measure) => measure.name)).toEqual([
			...SQL_MEASURES.map((measure) => measure.name),
			...RETRO_MEASURES.map((measure) => measure.name),
		]);
		expect(listed.every((measure) => measure.status === "approved")).toBe(true);
		expect(listed.find((measure) => measure.name === "cost")).toMatchObject({
			kind: "aggregate",
			unit: "usd",
			parameters: [],
		});
		const described = describeMeasure("time_lost_by_cause", today);
		expect(described?.sql).toContain("FROM calls");
		expect(described?.definition).toContain("group_run_time (approved)");
		expect(described?.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(describeMeasure("nope", today)).toBeNull();
	});

	test("a result stored with an older definition opens with the NONCANONICAL notice", async () => {
		const hash = measureHash("repeated_commands") ?? "";
		expect(
			driftNotice({ name: "repeated_commands", status: "approved", hash }),
		).toBeNull();
		const drifted = driftNotice({
			name: "repeated_commands",
			status: "approved",
			hash: "0".repeat(64),
		});
		expect(drifted).toStartWith(
			"NONCANONICAL: status=approved is_drifted=true.",
		);
		expect(
			driftNotice({ name: "removed_measure", status: "approved", hash }),
		).toContain("is_drifted=true");

		const results = createMemorySqlResultStore();
		const id = await results.save({
			workspaceId: "w",
			authorId: "u",
			title: "t",
			query: "SELECT 1",
			output: {
				title: "t",
				query: "SELECT 1",
				columns: [],
				rows: 0,
				truncated: false,
				table: "",
				notices: ["not evidence"],
				sessions: [],
				runs: [],
				measure: {
					name: "repeated_commands",
					status: "approved",
					hash: "0".repeat(64),
					from: "2026-10-06",
					to: "2026-11-03",
				},
			},
			owners: [],
			counts: true,
			queryCarriesText: false,
		});
		const opened = await openSqlResult(
			results,
			{ workspaceId: "w", userId: "u" },
			id,
			today,
		);
		expect(opened.output?.notices[0]).toStartWith("NONCANONICAL:");
		expect(opened.output?.notices[1]).toBe("not evidence");
	});
});

describe("a measure run through the gateway", () => {
	test("reads only the cohort's sessions: the cohort is computed once and every session view is held to it", async () => {
		const statements: ClickHouseStatement[] = [];
		const env = {
			executor: {
				close: async () => {},
				execute: async () => {},
				insert: async () => {},
				query: async <T>(statement: ClickHouseStatement) => {
					statements.push(statement);
					return [] as T[];
				},
			},
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 10, windowMs: 3_600_000 }),
			limiter: {
				withAgentQuerySlot: async <T>(_: string, work: () => Promise<T>) =>
					work(),
			},
			githubRepositories: async () => ["101"],
		};
		const measure = findRetroMeasure("time_lost_by_cause");
		const outcome = await runSql(
			{
				workspaceId: "ws-1",
				reader: { userId: "u-1", role: "member", ownSessionsOnly: false },
			},
			{
				query: measure?.build(params) ?? "",
				title: "Time lost",
				cohort: cohortSelect(params),
				measure: {
					name: "time_lost_by_cause",
					status: "approved",
					hash: measureHash("time_lost_by_cause") ?? "",
					from: params.from,
					to: params.to,
				},
			},
			env,
		);
		expect(outcome.ok).toBe(true);
		const agent = statements.find(
			(statement) =>
				statement.clickhouse_settings?.readonly === "1" &&
				!statement.query.startsWith("EXPLAIN"),
		);
		expect(agent?.query).toStartWith(
			"WITH (SELECT groupUniqArray((user_id, session_id)) FROM (",
		);
		expect(agent?.query).toContain(") AS opaline_cohort\nSELECT * FROM (\n");
		expect(agent?.query).toContain(
			"(user_id, session_id) IN (SELECT arrayJoin(opaline_cohort))",
		);
		expect(agent?.clickhouse_settings?.max_memory_usage).toBe(
			String(512 * 1024 * 1024),
		);
		if (outcome.ok)
			expect(outcome.result.measure?.name).toBe("time_lost_by_cause");
		expect(statements.filter((statement) => statement === agent).length).toBe(
			1,
		);
	});
});
