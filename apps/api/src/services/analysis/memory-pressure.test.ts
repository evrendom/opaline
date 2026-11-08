import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { AnalysisFindInputSchema } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { findAnalysis } from "./find.service.js";
import { readAnalysis } from "./read.service.js";
import {
	CLICKHOUSE_MEMORY_PRESSURE,
	isAnalysisWorkLimit,
	isClickHouseMemoryPressure,
} from "./sql.js";

const TOTAL = Object.assign(
	new Error(
		"Code: 241. DB::Exception: (total) memory limit exceeded: would use 1.85 GiB (attempt to allocate chunk of 1.00 GiB), current RSS: 1.82 GiB, maximum: 2.00 GiB. OvercommitTracker decision: Query was selected to stop by OvercommitTracker. (MEMORY_LIMIT_EXCEEDED) (version 26.9.16.10 (official build))",
	),
	{ type: "MEMORY_LIMIT_EXCEEDED" },
);
const OLD_TOTAL = new Error(
	"Memory limit (total) exceeded: would use 3.61 GiB, maximum: 3.60 GiB. (MEMORY_LIMIT_EXCEEDED)",
);
const USER = new Error(
	"Memory limit (for user) exceeded: would use 9.31 GiB, maximum: 9.31 GiB (MEMORY_LIMIT_EXCEEDED)",
);
const QUERY = Object.assign(
	new Error(
		"Code: 241. DB::Exception: Query memory limit exceeded: would use 48.02 MiB (attempt to allocate chunk of 32.00 MiB), maximum: 47.68 MiB: While executing AggregatingTransform. (MEMORY_LIMIT_EXCEEDED)",
	),
	{ type: "MEMORY_LIMIT_EXCEEDED" },
);

function failing(error: Error): ClickHouseExecutor {
	return {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async () => {
			throw error;
		},
	};
}

test("a server or user memory limit is pressure on ClickHouse, not a ceiling of this query", () => {
	for (const error of [TOTAL, OLD_TOTAL, USER]) {
		expect(isClickHouseMemoryPressure(error)).toBe(true);
		expect(isAnalysisWorkLimit(error)).toBe(false);
	}
	expect(isClickHouseMemoryPressure(QUERY)).toBe(false);
	expect(isAnalysisWorkLimit(QUERY)).toBe(true);
	expect(isClickHouseMemoryPressure(new Error("OvercommitTracker"))).toBe(
		false,
	);
	expect(isClickHouseMemoryPressure("(total) memory limit exceeded")).toBe(
		false,
	);
});

test("find under memory pressure fails loudly instead of answering sessions=0", async () => {
	const input = AnalysisFindInputSchema.parse({ source: "runs" });
	const scope = { organizationId: "org", userId: null };
	const error = await findAnalysis(scope, input, {
		executor: failing(TOTAL),
		edges: null,
	}).catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(ORPCError);
	expect((error as ORPCError<string, unknown>).code).toBe(
		"SERVICE_UNAVAILABLE",
	);
	expect((error as Error).message).toBe(CLICKHOUSE_MEMORY_PRESSURE);

	const ceiling = await findAnalysis(scope, input, {
		executor: failing(QUERY),
		edges: null,
	});
	expect(ceiling.header.truncated).toBe(true);
	expect(ceiling.header.notes.join(" ")).toContain("SQL work ceiling reached");
});

test("read under memory pressure fails loudly too", async () => {
	const error = await readAnalysis(
		"org",
		new Map([["u1", "u1"]]),
		{
			refs: [{ sessionId: "s1", agentId: "", turn: 1 }],
			depth: "run",
		} as unknown as Parameters<typeof readAnalysis>[2],
		{ executor: failing(TOTAL) },
	).catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(ORPCError);
	expect((error as Error).message).toBe(CLICKHOUSE_MEMORY_PRESSURE);
});
