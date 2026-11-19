import { describe, expect, test } from "bun:test";
import { AnalysisFindInputSchema } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { findAnalysis } from "./find.service.js";
import { clickhouse, DAY, run, session } from "./find-world.fixtures.js";

const scope = { organizationId: "org", userId: null };

function find(executor: ClickHouseExecutor, input: Record<string, unknown>) {
	return findAnalysis(
		scope,
		AnalysisFindInputSchema.parse({ source: "runs", ...input }),
		{ executor, edges: null },
	);
}

const runs = [1, 2, 3, 4, 5].map((turn) => run("s1", turn, turn));

describe("find filters", () => {
	test("runs keep only those the runs view matches, and the header counts only them", async () => {
		const { statements, executor } = clickhouse({
			sessions: [session("s1")],
			runs,
			matching: () => [
				{ session_id: "s1", agent_id: "", turn_idx: 2 },
				{ session_id: "s1", agent_id: "", turn_idx: 4 },
			],
		});
		const output = await find(executor, {
			filters: [
				{ key: "cost_usd", operator: "gt", value: 1 },
				{ key: "prompt_head", operator: "regex", value: "^prompt [24]" },
			],
		});
		expect(
			output.source === "runs" && "rows" in output
				? output.rows.map((row) => row.ref.turn)
				: [],
		).toEqual([4, 2]);
		expect(output.header.runsInScope).toBe(2);
		expect(output.header.notes).toContain(
			'filters (runs view, AND): cost_usd gt 1 AND prompt_head regex "^prompt [24]"; 2 of 5 runs match, and only they are counted here; a run the run index does not hold yet is left out',
		);
		const filter = statements.find(
			(statement) => "filterSessions" in (statement.query_params ?? {}),
		);
		expect(filter?.query).toContain(
			"WHERE session_id IN {filterSessions:Array(String)} AND (ifNull(cost_usd > {filter0:Float64}, 0)) AND (ifNull(match(prompt_head, {filter1:String}), 0))",
		);
		expect(filter?.query_params).toMatchObject({
			opaline_workspace: "org",
			opaline_member: "u1",
			filterSessions: ["s1"],
			filter0: 1,
			filter1: "^prompt [24]",
		});
	});

	test("an unknown key is refused before anything is read", async () => {
		const { statements, executor } = clickhouse({ sessions: [], runs: [] });
		await expect(
			find(executor, {
				filters: [{ key: "costusd", operator: "gt", value: 1 }],
			}),
		).rejects.toThrow('filters[0]: "costusd" is not a column of the runs view');
		expect(statements).toEqual([]);
	});
});

describe("find paging", () => {
	const world = () => clickhouse({ sessions: [session("s1")], runs });
	test("a cursor page reuses the runs the first page computed and returns the same header", async () => {
		const { statements, executor } = world();
		const live = () =>
			statements.filter((statement) =>
				statement.query.includes("session_unattributed AS ("),
			).length;
		const first = await find(executor, { limit: 2 });
		expect(live()).toBe(1);
		const next = await find(executor, {
			limit: 2,
			cursor: first.header.cursor,
		});
		expect(live()).toBe(1);
		expect(turns(next)).toEqual([3, 2]);
		expect({ ...next.header, cursor: undefined }).toEqual({
			...first.header,
			cursor: undefined,
		});
	});

	const turns = (output: Awaited<ReturnType<typeof find>>) =>
		output.source === "runs" && "rows" in output
			? output.rows.map((row) => row.ref.turn)
			: [];

	test("offset skips that many items, and the cursor says whether more follow", async () => {
		const middle = await find(world().executor, { limit: 2, offset: 2 });
		expect(turns(middle)).toEqual([3, 2]);
		expect(middle.header.cursor).toBeDefined();
		const next = await find(world().executor, {
			limit: 2,
			offset: 2,
			cursor: middle.header.cursor,
		});
		expect(turns(next)).toEqual([1]);
		expect(next.header.cursor).toBeUndefined();
		const last = await find(world().executor, { limit: 2, offset: 4 });
		expect(turns(last)).toEqual([1]);
		expect(last.header.cursor).toBeUndefined();
	});

	test("a random order is a sample whose cursor pages through the same order", async () => {
		const first = await find(world().executor, { sort: "random", limit: 2 });
		expect(turns(first)).toHaveLength(2);
		const second = await find(world().executor, {
			sort: "random",
			limit: 2,
			cursor: first.header.cursor,
		});
		const third = await find(world().executor, {
			sort: "random",
			limit: 2,
			cursor: second.header.cursor,
		});
		expect(third.header.cursor).toBeUndefined();
		expect([...turns(first), ...turns(second), ...turns(third)].sort()).toEqual(
			[1, 2, 3, 4, 5],
		);
		const again = await find(world().executor, {
			sort: "random",
			limit: 2,
			cursor: first.header.cursor,
		});
		expect(turns(again)).toEqual(turns(second));
	});
});

describe("find parentSessionId", () => {
	test("reads the session and every session linked below it, each under its parent", async () => {
		const link = (from: string, to: string) => ({
			user_id: "u1",
			from_session_id: from,
			to_session_id: to,
			kind: "delegation",
			at_ms: DAY,
		});
		const { statements, executor } = clickhouse({
			sessions: [session("root"), session("child"), session("grandchild")],
			runs: [run("root", 1, 1), run("child", 1, 2), run("grandchild", 1, 3)],
			links: [link("root", "child"), link("child", "grandchild")],
		});
		const output = await find(executor, { parentSessionId: "root" });
		const rows =
			output.source === "runs" && "rows" in output ? output.rows : [];
		expect(
			rows
				.map((row) => [row.ref.sessionId, row.parentSessionId, row.depth])
				.sort(),
		).toEqual([
			["child", "root", 1],
			["grandchild", "child", 2],
			["root", null, 0],
		]);
		const pick = statements.find((statement) =>
			statement.query.includes("{pickSessions:Array(String)}"),
		);
		expect(pick?.query_params).toMatchObject({
			pickSessions: ["root", "child", "grandchild"],
		});
		expect(pick?.query).not.toContain("BETWEEN {from:Date}");
	});
});

describe("find source=calls groups", () => {
	test("each group has its calls' own minutes and its runs' active minutes, each run once", async () => {
		const group = (key: string | null, calls: number, minutes: number) => ({
			key,
			calls,
			sessions: 1,
			failed_calls: 0,
			first_ms: DAY,
			last_ms: DAY,
			call_minutes: minutes,
			runs: [
				[1, "", 2],
				[1, "", 4],
			],
			examples: [],
		});
		const { executor } = clickhouse({
			sessions: [session("s1")],
			runs,
			groups: [group("bun", 3, 2.5), group(null, 1, 0.5)],
		});
		const output = await find(executor, {
			source: "calls",
			groupBy: "commandArgv0",
		});
		expect(output.header).toMatchObject({ matchedCalls: 4, groupCallTime: 3 });
		expect(
			output.source === "calls" && "groups" in output
				? output.groups.map(({ key, groupCallTime, groupRunTime }) => ({
						key,
						groupCallTime,
						groupRunTime,
					}))
				: [],
		).toEqual([{ key: "bun", groupCallTime: 2.5, groupRunTime: 6 }]);
	});
});
