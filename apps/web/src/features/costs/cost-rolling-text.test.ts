import { describe, expect, test } from "vitest";
import { rollSteps } from "./cost-rolling-text";

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
