import { describe, expect, test } from "vitest";
import { type DigitsState, nextDigits } from "./cost-rolling-text";

describe("nextDigits", () => {
	const start: DigitsState = {
		shown: { digit: "3", id: 0, direction: 1 as const },
		leaving: [],
	};

	test("the digit it shows is always the latest one, however fast it changes", () => {
		let state: DigitsState = start;
		for (const digit of ["4", "3", "4", "3"])
			state = nextDigits(state, digit, 1);
		expect(state.shown.digit).toBe("3");
		expect(state.shown.id).toBe(4);
		expect(state.leaving.map((left) => left.id)).toEqual([0, 1, 2, 3]);
		expect(
			new Set(state.leaving.map((left) => left.id)).has(state.shown.id),
		).toBe(false);
	});

	test("the same digit changes nothing", () => {
		expect(nextDigits(start, "3", -1)).toBe(start);
	});
});
