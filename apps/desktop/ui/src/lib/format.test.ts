import { describe, expect, test } from "vitest";
import {
	basename,
	formatApiCost,
	formatCompactCurrency,
	formatCompactWholeCurrency,
	formatCurrency,
	formatPaddedTimeOfDay,
	formatShare,
	formatShareOf,
	formatShortCount,
	formatTimeOfDay,
	formatWholeCurrency,
} from "./format";

describe("currency formatters", () => {
	test("render missing and invalid costs as numeric zero values", () => {
		expect(formatApiCost(undefined)).toBe("0¢");
		expect(formatCurrency(null)).toBe("$0.00");
		expect(formatCurrency(Number.NaN)).toBe("$0.00");
		expect(formatCompactCurrency(undefined)).toBe("$0.00");
		expect(formatWholeCurrency(null)).toBe("$0");
		expect(formatCompactWholeCurrency(undefined)).toBe("$0");
	});

	test("formats API costs as cents below one dollar and whole dollars above", () => {
		expect(formatApiCost(0)).toBe("0¢");
		expect(formatApiCost(0.004)).toBe("0¢");
		expect(formatApiCost(0.005)).toBe("1¢");
		expect(formatApiCost(0.08)).toBe("8¢");
		expect(formatApiCost(0.1267)).toBe("13¢");
		expect(formatApiCost(0.99)).toBe("99¢");
		expect(formatApiCost(0.999)).toBe("100¢");
		expect(formatApiCost(1)).toBe("$1");
		expect(formatApiCost(1.49)).toBe("$1");
		expect(formatApiCost(1.5)).toBe("$2");
		expect(formatApiCost(9.876)).toBe("$10");
		expect(formatApiCost(10.49)).toBe("$10");
		expect(formatApiCost(10.5)).toBe("$11");
	});
});

describe("shares", () => {
	test("a share of a whole: under 1%, none at all too, said so", () => {
		expect(formatShare(0)).toBe("<1%");
		expect(formatShare(0.004)).toBe("<1%");
		expect(formatShare(0.01)).toBe("1%");
		expect(formatShare(0.4949)).toBe("49%");
		expect(formatShare(1)).toBe("100%");
	});

	test("a part of a whole: none, or no whole, is 0%", () => {
		expect(formatShareOf(0, 100)).toBe("0%");
		expect(formatShareOf(5, 0)).toBe("0%");
		expect(formatShareOf(0.5, 100)).toBe("<1%");
		expect(formatShareOf(25, 100)).toBe("25%");
	});
});

describe("times of day and paths", () => {
	test("to the second, the hour padded or not", () => {
		const at = new Date(2026, 9, 29, 9, 4, 5).getTime();
		expect(formatTimeOfDay(at)).toBe(
			new Date(at).toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
				second: "2-digit",
			}),
		);
		expect(formatPaddedTimeOfDay(new Date(at).toISOString())).toBe(
			new Date(at).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}),
		);
		expect(formatTimeOfDay("not a time")).toBe("Invalid Date");
	});

	test("a path's last part", () => {
		expect(basename("src/app/main.ts")).toBe("main.ts");
		expect(basename("src/app/")).toBe("app");
		expect(basename("main.ts")).toBe("main.ts");
		expect(basename("")).toBe("");
	});
});

describe("short counts", () => {
	test("read whole below a thousand, then in k, rounded down, capped", () => {
		expect(
			[
				0, 894, 999, 1_000, 1_232, 1_999, 9_999, 10_000, 12_345, 999_999,
				1_000_000, 5e7,
			].map(formatShortCount),
		).toEqual([
			"0",
			"894",
			"999",
			"1k",
			"1.2k",
			"1.9k",
			"9.9k",
			"10k",
			"12k",
			"999k",
			"999k+",
			"999k+",
		]);
	});
});
