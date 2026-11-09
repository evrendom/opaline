import { describe, expect, test } from "bun:test";
import type { DashboardMetricData } from "@rudel/api-routes";
import { formatPerRun, languageRates } from "./cost-language-rates";

const point = (
	date: string,
	total: number,
	values: Record<string, number>,
) => ({
	date,
	total,
	values,
});

const signals = {
	series: [
		{ id: "series-0", label: "Model apologies" },
		{ id: "series-1", label: "Negative user" },
		{ id: "series-2", label: "Positive user" },
	],
	trend: [
		point("2026-10-05", 9, { "series-0": 4, "series-1": 2, "series-2": 3 }),
		point("2026-10-06", 3, { "series-0": 0, "series-1": 3, "series-2": 0 }),
		point("2026-10-07", 0, { "series-0": 0, "series-1": 0, "series-2": 0 }),
	],
} as unknown as DashboardMetricData;

const runs = {
	trend: [
		point("2026-10-05", 10, { total: 10 }),
		point("2026-10-06", 5, { total: 5 }),
		point("2026-10-07", 0, { total: 0 }),
	],
} as unknown as DashboardMetricData;

describe("languageRates", () => {
	test("divides swears and apologies by the agent runs of each day", () => {
		const rates = languageRates(signals, runs, "daily");
		expect(rates?.swears).toEqual([0.2, 0.6, 0]);
		expect(rates?.apologies).toEqual([0.4, 0, 0]);
		expect(rates?.dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
	});

	test("the range total divides summed counts by summed runs", () => {
		const rates = languageRates(signals, runs, "daily");
		expect(rates?.total.swears).toBeCloseTo(5 / 15);
		expect(rates?.total.apologies).toBeCloseTo(4 / 15);
	});

	test("without the split or the runs there is nothing to show", () => {
		expect(languageRates(undefined, runs, "daily")).toBeUndefined();
		expect(languageRates(signals, null, "daily")).toBeUndefined();
	});

	test("a rate reads as one per N runs", () => {
		expect(formatPerRun(5 / 15)).toBe("1 per 3 runs");
		expect(formatPerRun(68 / 2452)).toBe("1 per 36 runs");
		expect(formatPerRun(2.34)).toBe("2.3 per run");
		expect(formatPerRun(0)).toBe("none");
		expect(formatPerRun(68 / 2452, true)).toBe("1/36");
		expect(formatPerRun(2.34, true)).toBe("2.3/run");
	});
});
