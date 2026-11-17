import { describe, expect, test } from "vitest";
import { rollSteps } from "./cost-rolling-text";

const kinds = (before: string, after: string) =>
	rollSteps(before, after).map((step) =>
		step.kind === "remove" ? "remove" : `${step.kind} ${step.char}`,
	);

describe("rollSteps", () => {
	test("a new leading digit is added; the digits already there stay", () => {
		expect(kinds("87", "187")).toEqual(["add 1", "keep 8", "keep 7"]);
	});

	test("the currency sign and decimal point keep their place", () => {
		expect(kinds("$6.97", "$16.08")).toEqual([
			"keep $",
			"add 1",
			"keep 6",
			"keep .",
			"swap 0",
			"swap 8",
		]);
	});

	test("a lost digit and its comma are removed, the suffix stays", () => {
		expect(kinds("$1,118.05", "$586.95")).toEqual([
			"keep $",
			"remove",
			"remove",
			"swap 5",
			"swap 8",
			"swap 6",
			"keep .",
			"swap 9",
			"keep 5",
		]);
		expect(kinds("8% used", "24% used")).toEqual([
			"add 2",
			"swap 4",
			"keep %",
			"keep  ",
			"keep u",
			"keep s",
			"keep e",
			"keep d",
		]);
	});
});
