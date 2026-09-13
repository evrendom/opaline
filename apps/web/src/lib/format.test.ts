import { describe, expect, test } from "vitest";
import {
	formatApiCost,
	formatCompactCurrency,
	formatCompactWholeCurrency,
	formatCurrency,
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
