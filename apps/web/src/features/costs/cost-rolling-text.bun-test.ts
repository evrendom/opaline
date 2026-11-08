import { describe, expect, test } from "bun:test";
import { amountOf } from "./cost-rolling-text";

describe("amountOf", () => {
	test("reads money, counts and abbreviations", () => {
		expect(amountOf("$5,147.75")).toBe(5147.75);
		expect(amountOf("2,452")).toBe(2452);
		expect(amountOf("1.2k")).toBe(1200);
		expect(amountOf("3M")).toBe(3_000_000);
		expect(amountOf("76¢")).toBe(76);
	});

	test("reads the number inside dates and years", () => {
		expect(amountOf("Oct 31")).toBe(31);
		expect(amountOf("Nov 1")).toBe(1);
		expect(amountOf("’26")).toBe(26);
	});

	test("text without a number has no amount", () => {
		expect(amountOf("Mon")).toBeNaN();
		expect(amountOf("—")).toBeNaN();
	});
});
