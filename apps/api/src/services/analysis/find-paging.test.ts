import { describe, expect, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	type AnalysisFindOutput,
} from "@rudel/api-routes";
import { MAX_CLICKHOUSE_URL_BYTES } from "../../clickhouse.js";
import {
	buildCallExamplesStatement,
	buildCallGroupsStatement,
	buildCallRowsStatement,
} from "./call-queries.js";
import { exampleChunks } from "./find.service.js";
import { compileFindFilters, sessionTree } from "./find-filter-queries.js";
import {
	padUInt64,
	randomRank,
	randomSeedOf,
	skipLeading,
	unpadUInt64,
} from "./find-paging.js";
import { paramValueBytes } from "./sql.js";

const scope = { organizationId: "org", userId: "member" };
const generations = Array.from({ length: 50 }, (_, index) => ({
	sessionId: `0000000${index}-6a18-43ee-8644-0d1d7be5dcf5`.slice(-36),
	revision: "1793795345626000000",
	parserVersion: 12,
}));

function header(): AnalysisFindOutput["header"] {
	return {
		from: "2026-10-27",
		to: "2026-11-03",
		sessionsInScope: 0,
		indexedSessions: 0,
		runsInScope: 0,
		minutes: 0,
		activeMinutes: 0,
		pricedCostUsd: 0,
		unattributedCostUsd: 0,
		unpricedRuns: 0,
		rawChars: 0,
		truncated: false,
		notes: [],
		classifierVersion: 1,
	};
}

describe("offset", () => {
	test("drops the first items of the list the source pages, and their keys", () => {
		const output: AnalysisFindOutput = {
			source: "user",
			header: header(),
			events: [1, 2, 3].map((record) => ({
				type: "negative",
				terms: [],
				eventRef: { sessionId: "s", agentId: "", turn: 1, record },
				quote: "",
				partial: false,
				originRef: null,
				originMinutes: null,
				originCostUsd: null,
				parentSessionId: null,
			})),
			groups: [{ type: "negative", count: 3, sessions: 1 }],
		};
		const found = skipLeading({ output, keys: [["a"], ["b"], ["c"]] }, 2);
		expect(found.keys).toEqual([["c"]]);
		expect(
			found.output.source === "user" &&
				found.output.events.map((event) => event.eventRef.record),
		).toEqual([3]);
		expect(found.output.source === "user" && found.output.groups).toHaveLength(
			1,
		);
	});
});

describe("random order", () => {
	test("ranks are fixed by the seed, and a cursor keeps its seed", () => {
		expect(randomRank("seed", "run")).toBe(randomRank("seed", "run"));
		expect(randomRank("seed", "run")).not.toBe(randomRank("other", "run"));
		expect(randomSeedOf(["kept", "0", "run"])).toBe("kept");
		expect(randomSeedOf(undefined)).toMatch(/^[\w-]{8}$/u);
	});

	test("padded UInt64 keys sort as their numbers", () => {
		const keys = ["18446744073709551615", "9", "5517826819981700007"];
		expect(keys.map(padUInt64).sort().map(unpadUInt64)).toEqual([
			"9",
			"5517826819981700007",
			"18446744073709551615",
		]);
	});

	test("calls are ordered by a seeded hash, keyset after the last one", () => {
		const input = AnalysisFindInputSchema.parse({
			source: "calls",
			sort: "random",
		});
		const statement = buildCallRowsStatement(
			{ scope, generations, input },
			{
				order: "random",
				seed: "abc",
				after: ["123", "s", "", 4, 0],
			},
			51,
		);
		expect(statement.query).toContain(
			"cityHash64({randomSeed:String}, session_id, agent_id, record_idx, block_idx) AS random_hash",
		);
		expect(statement.query).toContain(
			"WHERE (random_hash, session_id, agent_id, record_idx, block_idx) > ({afterRandom:UInt64}",
		);
		expect(statement.query).toContain(
			"ORDER BY random_hash, session_id, agent_id, record_idx, block_idx",
		);
		expect(statement.query_params).toMatchObject({
			randomSeed: "abc",
			afterRandom: "123",
			afterSession: "s",
			afterRecord: 4,
			limit: 51,
		});
	});
});

describe("calls statements", () => {
	const input = AnalysisFindInputSchema.parse({
		source: "calls",
		filters: [
			{ key: "failed", operator: "exact", value: true },
			{ key: "command", operator: "regex", value: "^bun test" },
		],
	});
	const filters = compileFindFilters(input);

	test("rows carry their call minutes and the matching calls' count and minutes", () => {
		const statement = buildCallRowsStatement(
			{ scope, generations, input, filters },
			{ order: "time" },
			51,
		);
		expect(statement.query).toContain(
			"if(finished_at IS NULL, NULL, greatest(0, dateDiff('millisecond', c.ts, finished_at)) / 60000) AS call_minutes",
		);
		expect(statement.query).toContain(
			"count() OVER () AS matched_calls, sum(call_minutes) OVER () AS matched_minutes",
		);
		expect(statement.query).toContain(
			"WHERE (ifNull(toUInt8(failed) IN {filter0:Array(UInt8)}, 0)) AND (ifNull(match(command, {filter1:String}), 0))",
		);
		expect(statement.query).toContain("subtype = 'task_notification'");
		expect(statement.query_params).toMatchObject({
			filter0: [1],
			filter1: "^bun test",
		});
	});

	test("groups sum their calls' minutes and list the runs that hold them", () => {
		const statement = buildCallGroupsStatement(
			{ scope, generations, input, filters },
			"commandFingerprint",
		);
		expect(statement.query).toContain("sum(t) AS call_minutes");
		expect(statement.query).toContain("ifNull(sum(call_minutes), 0) AS t");
		expect(statement.query).toContain(
			"groupUniqArray((toUInt32(indexOf({sessionIds:Array(String)}, session_id)), agent_id, turn_idx)) AS text_runs",
		);
		expect(statement.query).toContain("FROM matched");
	});

	test("examples are split so no statement's URL needs a multipart body", () => {
		const examples = Array.from({ length: 150 }, (_, index) => {
			const generation = generations[index % generations.length];
			return [
				generation?.sessionId ?? "",
				index % 3 ? "" : `agent-${"a".repeat(16)}${index}`,
				7_000 + index,
				0,
			] as const;
		});
		const chunks = exampleChunks({ scope, generations }, examples);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.flat()).toEqual(examples);
		for (const chunk of chunks) {
			const params = buildCallExamplesStatement(scope, generations, chunk)
				.query_params as Record<string, unknown>;
			const bytes = Object.values(params)
				.flatMap((value) => (Array.isArray(value) ? value : [value]))
				.reduce<number>(
					(sum, value) => sum + paramValueBytes(value as string | number),
					0,
				);
			expect(bytes).toBeLessThan(MAX_CLICKHOUSE_URL_BYTES - 1024);
		}
	});
});

describe("session tree", () => {
	const link = (
		from: string,
		to: string,
		at: number,
		kind = "parent_thread",
	) => ({
		user_id: "member",
		from_session_id: from,
		to_session_id: to,
		kind,
		at_ms: at,
	});

	test("a session and every session linked below it, each placed under its parent", () => {
		const tree = sessionTree(
			[
				link("root", "b", 2),
				link("root", "a", 1, "delegation"),
				link("a", "a1", 3, "fork"),
				link("other", "x", 1),
				link("a1", "root", 4),
			],
			"root",
		);
		expect(
			tree.map(({ sessionId, parentSessionId, depth }) => [
				sessionId,
				parentSessionId,
				depth,
			]),
		).toEqual([
			["root", null, 0],
			["a", "root", 1],
			["b", "root", 1],
			["a1", "a", 2],
		]);
	});

	test("a session without links has no tree, so find scopes it by sessionId", () => {
		expect(sessionTree([link("other", "x", 1)], "root")).toEqual([]);
	});
});
