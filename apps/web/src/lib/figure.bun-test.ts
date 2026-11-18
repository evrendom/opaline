import { describe, expect, test } from "bun:test";
import {
	formatCost,
	formatMetric,
	formatMetricRatio,
} from "@/features/costs/cost-format";
import { formatPerRun } from "@/features/costs/cost-language-rates";
import { figureText, textFigure } from "./figure";

describe("figures", () => {
	test("metric figures read the same as before", () => {
		expect(formatCost(5147.75)).toBe("$5,147.75");
		expect(formatCost(0.004)).toBe("<$0.01");
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(-12.5)).toBe("-$12.50");
		expect(formatMetric(2452.4, "sessions")).toBe("2,452");
		expect(formatMetric(1.256, "ciFailuresPerPullRequest")).toBe("1.26");
		expect(formatMetric(2, "ciFailuresPerPullRequest")).toBe("2");
		expect(formatMetricRatio(3, "ciFailuresPerPullRequest", 0)).toBe("—");
		expect(formatPerRun(1 / 1234, true)).toBe("1/1234");
		expect(formatPerRun(1500, true)).toBe("1500/1");
	});

	test("labels keep their text, numbers split out", () => {
		for (const label of [
			"Oct 20",
			"20 Oct",
			"Current · Nov 1",
			"’05",
			"2026",
			"2020s",
			"Q3",
			"M",
		])
			expect(figureText(textFigure(label))).toBe(label);
		expect(textFigure("Oct 20")).toEqual([
			"Oct ",
			{ value: 20, format: { useGrouping: false, minimumIntegerDigits: 2 } },
		]);
		expect(textFigure("Oct")).toEqual(["Oct"]);
	});
});
