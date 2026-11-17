import { describe, expect, test } from "vitest";
import { rollSteps, unitsOf } from "./cost-rolling-text";

describe("rollSteps", () => {
	test("characters line up from the right, so only changed places roll", () => {
		expect(rollSteps("$586.95", "$1,118.05").map((step) => step.kind)).toEqual([
			"add",
			"add",
			"swap",
			"swap",
			"swap",
			"swap",
			"keep",
			"swap",
			"keep",
		]);
	});

	test("a shorter value drops places on the left", () => {
		expect(rollSteps("~73% left", "8% left").map((step) => step.kind)).toEqual([
			"remove",
			"remove",
			"swap",
			"keep",
			"keep",
			"keep",
		]);
	});

	test("the same text keeps every place", () => {
		expect(rollSteps("445", "445").every((step) => step.kind === "keep")).toBe(
			true,
		);
	});
});

describe("unitsOf", () => {
	test("words roll as one unit, digits and signs one by one", () => {
		expect(unitsOf("24% used")).toEqual(["2", "4", "%", " ", "used"]);
		expect(rollSteps("24% used", "43% left").map((step) => step.kind)).toEqual([
			"swap",
			"swap",
			"keep",
			"keep",
			"swap",
		]);
	});
});
