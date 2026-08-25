import { describe, expect, test } from "bun:test";
import { percentile } from "../src/summary.ts";

describe("summary percentiles", () => {
	test("uses nearest-rank percentiles", () => {
		expect(percentile([], 0.95)).toBeNull();
		expect(percentile([10], 0.95)).toBe(10);
		expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
		expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
	});
});
