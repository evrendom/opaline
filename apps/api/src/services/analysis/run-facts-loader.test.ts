import { expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { run } from "./find-world.fixtures.js";
import {
	buildIndexedRunFactsStatement,
	ComputedRunFacts,
	computedRunFactsOf,
	computedRunKey,
	loadRunFacts,
} from "./run-facts-loader.js";
import {
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
} from "./run-index-sql.js";
import { RunRowSchema } from "./run-queries.js";

const scope = { organizationId: "org", userId: "u1" };
const generation = (sessionId: string) => ({
	sessionId,
	revision: "7",
	parserVersion: 12,
});

function world(indexRows: Record<string, unknown>[]) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			if (statement.query.includes("row_kind")) return indexRows as T[];
			const ids = (statement.query_params?.sessionIds ?? []) as string[];
			return ids.map((id) => run(id, 1, 9)) as T[];
		},
	};
	return { statements, executor };
}

test("runs of sessions the current index build holds come from the index, the rest from their records", async () => {
	const receipt = {
		...run("indexed", 0, 0),
		row_kind: "receipt",
		session_unattributed: 0.5,
		session_unattributed_models: [["model", 0.5]],
	};
	const { statements, executor } = world([
		receipt,
		{ ...run("indexed", 2, 2), row_kind: "run" },
		{ ...run("indexed", 1, 1), row_kind: "run" },
		{ ...run("stale", 1, 3), row_kind: "run" },
	]);
	const loaded = await loadRunFacts(executor, [
		{
			scope,
			generations: [generation("indexed"), generation("stale")],
		},
	]);
	expect(loaded.indexedSessions).toBe(1);
	expect(loaded.computedSessions).toBe(1);
	expect(
		loaded.rows[0]?.map((row) => [
			row.session_id,
			row.turn_idx,
			row.cost,
			row.session_unattributed,
		]),
	).toEqual([
		["indexed", 1, 1, 0.5],
		["indexed", 2, 2, 0.5],
		["stale", 1, 9, 0],
	]);
	expect(statements).toHaveLength(2);
	expect(statements[1]?.query_params?.sessionIds).toEqual(["stale"]);
});

test("the index read is pinned to the transcript generation, the index version and the pricing", () => {
	const statement = buildIndexedRunFactsStatement(scope, [generation("a")]);
	expect(statement.query).toContain("FINAL");
	expect(statement.query).toContain(
		"index_version = {indexVersion:UInt16} AND pricing_version = {pricingVersion:String}",
	);
	expect(statement.query).toContain(
		"(session_id, revision, parser_version) IN arrayZip(",
	);
	expect(statement.query_params).toMatchObject({
		sessionIds: ["a"],
		revisions: ["7"],
		parserVersions: [12],
		indexVersion: RUN_INDEX_VERSION,
		pricingVersion: RUN_INDEX_PRICING_VERSION,
	});
});

function liveWorld(runsOf: (sessionId: string) => Record<string, unknown>[]) {
	const live: string[][] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			if (statement.query.includes("row_kind")) return [] as T[];
			const ids = (statement.query_params?.sessionIds ?? []) as string[];
			live.push(ids);
			return ids.flatMap(runsOf) as T[];
		},
	};
	return { live, executor };
}

test("runs computed from records are computed once per transcript generation", async () => {
	const { live, executor } = liveWorld((id) =>
		id === "empty" ? [] : [run(id, 2, 2), run(id, 1, 1)],
	);
	const computed = new ComputedRunFacts();
	const batches = [
		{
			scope,
			generations: [generation("a"), generation("empty"), generation("b")],
		},
	];
	const first = await loadRunFacts(executor, batches, computed);
	const again = await loadRunFacts(executor, batches, computed);
	expect(live).toEqual([["a", "empty", "b"]]);
	expect(again).toEqual(first);
	expect(again.rows[0]?.map((row) => [row.session_id, row.turn_idx])).toEqual([
		["a", 1],
		["a", 2],
		["b", 1],
		["b", 2],
	]);
	expect(again.computedSessions).toBe(3);

	await loadRunFacts(
		executor,
		[
			{
				scope,
				generations: [{ ...generation("a"), revision: "8" }, generation("b")],
			},
		],
		computed,
	);
	expect(live).toEqual([["a", "empty", "b"], ["a"]]);
});

test("without a memo every load computes its runs again", async () => {
	const { live, executor } = liveWorld((id) => [run(id, 1, 1)]);
	const batches = [{ scope, generations: [generation("a")] }];
	await loadRunFacts(executor, batches);
	await loadRunFacts(executor, batches);
	expect(live).toEqual([["a"], ["a"]]);
});

test("remembered runs expire and the oldest sessions leave first past the cap", () => {
	let now = 0;
	const computed = new ComputedRunFacts(1_000, 3, () => now);
	const key = (id: string) => computedRunKey(scope, generation(id));
	const rows = (id: string, count: number) =>
		Array.from({ length: count }, (_, at) =>
			RunRowSchema.parse(run(id, at + 1, 1)),
		);
	computed.set(key("a"), rows("a", 2));
	computed.set(key("b"), rows("b", 1));
	expect(computed.get(key("a"))).toHaveLength(2);
	computed.set(key("c"), rows("c", 1));
	expect(computed.get(key("a"))).toBeUndefined();
	expect(computed.get(key("b"))).toHaveLength(1);
	expect(computed.get(key("c"))).toHaveLength(1);
	computed.set(key("big"), rows("big", 4));
	expect(computed.get(key("big"))).toBeUndefined();
	now = 1_000;
	expect(computed.get(key("b"))).toBeUndefined();
	expect(computed.size).toBe(1);
});

test("the memo belongs to one executor", () => {
	const { executor } = liveWorld(() => []);
	const { executor: other } = liveWorld(() => []);
	expect(computedRunFactsOf(executor)).toBe(computedRunFactsOf(executor));
	expect(computedRunFactsOf(other)).not.toBe(computedRunFactsOf(executor));
});

test("a memo key names the workspace, member, session and generation", () => {
	expect(computedRunKey(scope, generation("a"))).not.toBe(
		computedRunKey({ ...scope, userId: "u2" }, generation("a")),
	);
	expect(computedRunKey(scope, generation("a"))).not.toBe(
		computedRunKey(scope, { ...generation("a"), parserVersion: 13 }),
	);
});
