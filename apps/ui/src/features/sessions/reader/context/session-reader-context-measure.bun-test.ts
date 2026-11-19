import { expect, test } from "bun:test";
import { resolveModelPricing } from "@rudel/api-routes/model-pricing";
import type { ContextMap } from "./session-reader-context-map";
import { costMap, timeMap } from "./session-reader-context-measure";

const MODEL = "claude-opus-5-5";
const DAY = Date.parse("2026-10-16T10:00:00.000Z");
const iso = (ms: number) => new Date(DAY + ms).toISOString();

const map = (overrides: Partial<ContextMap>): ContextMap => ({
	compacted: false,
	estimate: { scale: 1, text: 0 },
	model: MODEL,
	parts: [],
	trail: [],
	until: null,
	used: 0,
	window: 200_000,
	...overrides,
});

test("time: each part's steps, overlaps once; the rest of the span idle", () => {
	const timed = timeMap(
		map({
			parts: [
				{ count: 2, key: "program:git", kind: "git", label: "git", tokens: 1 },
				{
					count: 1,
					key: "files:read",
					kind: "read",
					label: "Read files",
					tokens: 1,
				},
			],
			trail: [
				{
					end: 10,
					items: ["git status"],
					key: "program:git",
					start: 0,
					tokens: 1,
					waited: 10,
					written: 0,
				},
				{
					end: 15,
					items: ["git diff"],
					key: "program:git",
					start: 5,
					tokens: 1,
					waited: 15,
					written: 5,
				},
				{
					end: 30,
					items: ["a.ts"],
					key: "files:read",
					start: 20,
					tokens: 1,
					waited: 30,
					written: 20,
				},
			],
			until: 40,
		}),
	);
	const byKey = new Map(timed?.parts.map((part) => [part.key, part.tokens]));
	expect(byKey.get("program:git")).toBe(15);
	expect(byKey.get("files:read")).toBe(10);
	expect(timed?.used).toBe(25);
	expect(timed?.window).toBe(40);
});

test("cost: input split by what the context held; output to what it wrote", () => {
	const calls = [
		{
			at: iso(0),
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			contextWindow: null,
			freshInputTokens: 1_000,
			model: MODEL,
			outputTokens: 100,
		},
		{
			at: iso(20),
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			contextWindow: null,
			freshInputTokens: 2_000,
			model: MODEL,
			outputTokens: 0,
		},
	];
	const costed = costMap(
		map({
			parts: [
				{
					count: 1,
					key: "system",
					kind: "context",
					label: "System",
					tokens: 1_000,
				},
				{
					count: 1,
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
					tokens: 1_000,
					waited: DAY + 10,
					written: DAY + 5,
				},
			],
		}),
		calls,
	);
	const rates = resolveModelPricing(MODEL, {
		at: iso(0),
		contextInputTokens: 1_000,
	});
	if (!rates) throw new Error("no rates for the test's model");
	const input = (tokens: number) => (tokens * rates.inputPerMTok) / 1e6;
	const output = (100 * rates.outputPerMTok) / 1e6;
	const byKey = new Map(
		costed?.parts.map((part) => [part.key, part.tokens / 1e6]),
	);
	expect(byKey.get("system")).toBeCloseTo(input(1_000) + input(2_000) / 2, 5);
	expect(byKey.get("files:read")).toBeCloseTo(output + input(2_000) / 2, 5);
	expect(costed?.window).toBe(costed?.used);
});

test("time: subagents waited on together share the wait; one in the background, only its hand-off", () => {
	const subagent = (id: string, end: number, waited: number) => ({
		end,
		items: [id],
		key: `agent:${id}`,
		start: 0,
		tokens: 1,
		waited,
		written: 0,
	});
	const timed = timeMap(
		map({
			parts: ["a1", "a2", "a3"].map((id) => ({
				count: 1,
				key: `agent:${id}`,
				kind: "agent" as const,
				label: id,
				tokens: 1,
			})),
			trail: [
				subagent("a1", 60_000, 60_000),
				subagent("a2", 60_000, 60_000),
				subagent("a3", 3_600_000, 2_000),
			],
			until: 60_000,
		}),
	);
	const byKey = new Map(timed?.parts.map((part) => [part.key, part.tokens]));
	expect(Math.abs((timed?.used ?? 0) - 60_000)).toBeLessThanOrEqual(1);
	expect(byKey.get("agent:a3")).toBe(667);
	expect(byKey.get("agent:a1")).toBe(29_667);
});

test("cost: each subagent's own spend on its thing in the Subagents box, not outside the map", () => {
	const call = {
		at: iso(1_000),
		cacheCreationInputTokens: 0,
		cacheReadInputTokens: 0,
		freshInputTokens: 10_000,
		model: MODEL,
		outputTokens: 0,
	};
	const costed = costMap(
		map({
			parts: [
				{
					count: 1,
					items: [{ count: 1, label: "a417 · Fix the parser", tokens: 500 }],
					key: "agents",
					kind: "agent",
					label: "Subagents",
					tokens: 500,
				},
				{
					count: 1,
					key: "system",
					kind: "context",
					label: "System",
					tokens: 500,
				},
			],
			used: 1_000,
		}),
		[call] as never,
		null,
		new Map([
			["a417aa8e2258736bc", 2],
			["a999000000000000", 3],
		]),
	);
	const agents = costed?.parts.find((part) => part.key === "agents");
	expect(agents?.items?.[0]?.label).toBe("a417 · Fix the parser");
	expect(agents?.tokens).toBeGreaterThan(2_000_000);
	expect(agents?.items?.[0]?.tokens).toBe(agents?.tokens);
});
