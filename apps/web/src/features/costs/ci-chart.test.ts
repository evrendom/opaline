import { describe, expect, test } from "vitest";
import { ciTotals, failedSegments } from "./ci-chart";

describe("failedSegments", () => {
	test("a clean period shows no red segment", () => {
		expect(failedSegments({ runs: 14, failed: 0 })).toBe(0);
		expect(failedSegments({ runs: 0, failed: 0 })).toBe(0);
	});
	test("any failure shows at least one segment", () => {
		expect(failedSegments({ runs: 192, failed: 1 })).toBe(1);
	});
	test("rounds to the nearest fifth, halves down", () => {
		expect(failedSegments({ runs: 192, failed: 28 })).toBe(1);
		expect(failedSegments({ runs: 2, failed: 1 })).toBe(2);
		expect(failedSegments({ runs: 10, failed: 7 })).toBe(3);
		expect(failedSegments({ runs: 10, failed: 8 })).toBe(4);
		expect(failedSegments({ runs: 3, failed: 3 })).toBe(5);
	});
});

describe("ciTotals", () => {
	test("sums runs and failures across periods", () => {
		expect(
			ciTotals([
				{ date: "2026-11-06", runs: 160, failed: 12, merged: 16 },
				{ date: "2026-11-07", runs: 40, failed: 4, merged: 5 },
			]),
		).toEqual({ runs: 200, failed: 16 });
	});
});
