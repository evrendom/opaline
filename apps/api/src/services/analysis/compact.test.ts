import { expect, test } from "bun:test";
import {
	compactList,
	encodedLength,
	fitRows,
	fitToBudget,
	MAX_SUMMARY_CHARS,
	MCP_TOOL_OUTPUT_CHAR_BUDGET,
	omittedMarker,
	PER_VALUE_CHAR_LIMIT,
	responseBudget,
	truncatedMarker,
	truncateString,
} from "./compact.js";

test("the budgets are PostHog's: 80,000 delivered characters, 60,000 for a summary, 10,000 a value", () => {
	expect(MCP_TOOL_OUTPUT_CHAR_BUDGET).toBe(80_000);
	expect(MAX_SUMMARY_CHARS).toBe(60_000);
	expect(PER_VALUE_CHAR_LIMIT).toBe(10_000);
	expect(responseBudget()).toBe(80_000);
	expect(responseBudget("full")).toBe(80_000);
	expect(responseBudget("summary")).toBe(60_000);
});

test("markers count what was dropped", () => {
	expect(truncatedMarker(5, 12)).toBe(
		"… [truncated 5 of 12 chars — open it in Opaline for the full value]",
	);
	expect(omittedMarker(3)).toBe(
		"… [3 more rows omitted to fit the response size limit]",
	);
	expect(omittedMarker(2, "sections")).toBe(
		"… [2 more sections omitted to fit the response size limit]",
	);
});

test("a value within the per-value limit and the budget is kept verbatim", () => {
	expect(truncateString("short")).toBe("short");
	expect(truncateString("x".repeat(PER_VALUE_CHAR_LIMIT))).toBe(
		"x".repeat(PER_VALUE_CHAR_LIMIT),
	);
});

test("a value past the per-value limit keeps its first 10,000 characters and says how many it dropped", () => {
	const value = "y".repeat(25_000);
	expect(truncateString(value)).toBe(
		`${"y".repeat(10_000)}${truncatedMarker(15_000, 25_000)}`,
	);
});

test("the budget is measured as delivered text, so escapes count twice", () => {
	const value = "\n".repeat(100);
	const out = truncateString(value, 100);
	const kept = out.slice(0, out.indexOf("…"));
	expect(encodedLength(kept)).toBeLessThanOrEqual(100);
	expect(kept.length).toBeGreaterThan(30);
	expect(out).toEndWith(truncatedMarker(100 - kept.length, 100));
});

test("a cut never splits a surrogate pair", () => {
	const out = truncateString("😀".repeat(10), 5);
	const kept = out.slice(0, out.indexOf("…"));
	expect(kept).toBe("😀".repeat(kept.length / 2));
});

test("a list keeps items in order until its budget is spent, shortening the last, then counts the rest", () => {
	const items = Array.from({ length: 50 }, (_, index) =>
		`${index}`.padEnd(300, "-"),
	);
	const out = compactList(items, 2_000);
	const parts = out.split("; ");
	expect(parts.at(-1)).toMatch(
		/^… \[\d+ more items omitted to fit the response size limit\]$/u,
	);
	const kept = parts.slice(0, -1);
	const whole = kept.slice(0, -1);
	expect(whole).toEqual(items.slice(0, whole.length));
	expect(kept.at(-1)).toMatch(
		/^\d+-+… \[truncated \d+ of 300 chars — open it in Opaline for the full value\]$/u,
	);
	expect(parts.at(-1)).toBe(omittedMarker(50 - kept.length, "items"));
	expect(compactList(["a", "b"])).toBe("a; b");
});

test("rows are kept while they fit, the first always", () => {
	expect(fitRows([100, 100, 100], 1_000, 0)).toBe(3);
	expect(fitRows([100, 100, 100], 250, 0)).toBe(2);
	expect(fitRows([100, 100, 100], 250, 100)).toBe(1);
	expect(fitRows([5_000, 10], 100, 0)).toBe(1);
	expect(fitRows([], 100, 0)).toBe(0);
});

test("the fit loop measures the delivered result and shrinks the walk with 1.2 headroom, at most four times", () => {
	const walks: number[] = [];
	const out = fitToBudget(
		1_000,
		(walk) => {
			walks.push(walk);
			return walk;
		},
		-1,
		(walk) => walk * 1.5,
	);
	expect(out).toBeLessThanOrEqual(1_000 / 1.5);
	expect(walks[0]).toBe(1_000);
	expect(walks[1]).toBe(Math.floor((1_000 * 1_000) / 1_500 / 1.2));
	expect(walks).toHaveLength(2);

	const never: number[] = [];
	expect(
		fitToBudget(
			1_000,
			(walk) => {
				never.push(walk);
				return walk;
			},
			-1,
			() => 2_000,
		),
	).toBe(-1);
	expect(never).toHaveLength(5);
});
