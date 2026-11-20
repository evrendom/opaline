import { describe, expect, test } from "bun:test";
import { drawnContextMap } from "./session-context-snapshot.js";
import type { ContextMap } from "./session-reader-context-map.js";
import {
	costMap,
	runsByPart,
	storedCost,
	storedCostMap,
	storedPartRuns,
} from "./session-reader-context-part-figures.js";

const MODEL = "claude-opus-5-5";
const DAY = Date.parse("2026-10-16T10:00:00.000Z");
const iso = (ms: number) => new Date(DAY + ms).toISOString();

const call = (at: number, fresh: number, output: number) => ({
	at: iso(at),
	cacheCreationInputTokens: 0,
	cacheReadInputTokens: 0,
	contextWindow: null,
	freshInputTokens: fresh,
	model: MODEL,
	outputTokens: output,
});

const map: ContextMap = {
	compacted: false,
	estimate: { scale: 1, text: 0 },
	model: MODEL,
	parts: [
		{
			count: 1,
			key: "system",
			kind: "context",
			label: "System",
			tokens: 1_000,
		},
		{
			count: 2,
			items: [
				{ count: 1, label: "a.ts", tokens: 600 },
				{ count: 1, label: "b.ts", tokens: 400 },
			],
			key: "files:read",
			kind: "read",
			label: "Read files",
			tokens: 1_000,
		},
	],
	trail: [
		{
			end: DAY + 10,
			items: ["a.ts"],
			key: "files:read",
			start: DAY + 5,
			tokens: 600,
			waited: DAY + 10,
			written: DAY + 5,
		},
		{
			end: DAY + 30,
			items: ["b.ts"],
			key: "files:read",
			start: DAY + 25,
			tokens: 400,
			waited: DAY + 30,
			written: DAY + 25,
		},
	],
	until: null,
	used: 2_000,
	window: 200_000,
};

describe("figures a context snapshot stores", () => {
	test("give each part and item the cost the live map gives it", () => {
		const live = costMap(map, [call(0, 1_000, 100), call(20, 2_000, 50)]);
		if (!live) throw new Error("the test's calls should be priced");
		const stored = storedCostMap(
			drawnContextMap(map),
			JSON.parse(JSON.stringify(storedCost(live))),
		);
		const costs = (costed: ContextMap) =>
			costed.parts
				.filter((part) => part.key !== "cost:outside")
				.flatMap((part) => [
					[part.key, part.tokens],
					...(part.items ?? []).map((item) => [
						`${part.key}/${item.label}`,
						item.tokens,
					]),
				]);
		expect(costs(stored)).toEqual(costs(live));
		expect(costs(stored).length).toBeGreaterThan(2);
	});

	test("give each part and item the runs that touched it", () => {
		const runs = [
			{ startedAt: iso(0), turnId: "t1" },
			{ startedAt: iso(20), turnId: "t2" },
		];
		const live = runsByPart(map, runs);
		const stored = storedPartRuns(
			JSON.parse(
				JSON.stringify(
					Object.fromEntries([...live].map(([key, at]) => [key, [...at]])),
				),
			),
		);
		expect(stored).toEqual(live);
		expect(stored.get("files:read")).toEqual(new Set([0, 1]));
	});
});
