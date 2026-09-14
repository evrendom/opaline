import { expect, test } from "bun:test";
import { getSessionRenderIndexes } from "./session-list-virtualization";

test("a long list renders only the viewport, buffer and focused row", () => {
	const indexes = getSessionRenderIndexes(
		{ startIndex: 500, endIndex: 519, overscan: 8, count: 10_000 },
		2,
	);
	expect(indexes).toHaveLength(37);
	expect(indexes[0]).toBe(2);
	expect(indexes[1]).toBe(492);
	expect(indexes.at(-1)).toBe(527);
	expect(indexes).not.toContain(300);
});

test("deleted focus and overscan never produce indexes outside the current results", () => {
	expect(
		getSessionRenderIndexes(
			{ startIndex: 0, endIndex: 2, overscan: 8, count: 3 },
			100,
		),
	).toEqual([0, 1, 2]);
	expect(
		getSessionRenderIndexes(
			{ startIndex: 0, endIndex: 2, overscan: 8, count: 3 },
			1,
		),
	).toEqual([0, 1, 2]);
});
