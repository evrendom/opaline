import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
	CHART_INTERVALS,
	formatChartDate,
	formatChartPeriod,
	getChartSeriesValue,
	groupChartTrend,
} from "./chart-interval";

const points = [
	{ date: "2025-12-28", total: 3, values: { a: 1, b: 2 } },
	{ date: "2025-12-29", total: 7, values: { a: 3, b: 4 } },
	{ date: "2025-12-31", total: 0, values: { a: 0, b: 0 } },
	{ date: "2026-01-01", total: 11, values: { a: 5, b: 6 } },
	{ date: "2026-01-04", total: 15, values: { a: 7, b: 8 } },
	{ date: "2026-01-05", total: 19, values: { a: 9, b: 10 } },
];

describe("Dashboard chart intervals", () => {
	test("groups Monday–Sunday weeks across the year without extending the selected data", () => {
		expect(groupChartTrend(points, "weekly")).toEqual([
			{
				date: "2025-12-22",
				startDate: "2025-12-28",
				endDate: "2025-12-28",
				total: 3,
				values: { a: 1, b: 2 },
			},
			{
				date: "2025-12-29",
				startDate: "2025-12-29",
				endDate: "2026-01-04",
				total: 33,
				values: { a: 15, b: 18 },
			},
			{
				date: "2026-01-05",
				startDate: "2026-01-05",
				endDate: "2026-01-05",
				total: 19,
				values: { a: 9, b: 10 },
			},
		]);
	});

	test.each([
		...CHART_INTERVALS,
	])("preserves every split series and total for $label", ({ value }) => {
		const original = structuredClone(points);
		const result = groupChartTrend(points, value);
		expect(result.reduce((sum, point) => sum + point.total, 0)).toBe(55);
		expect(result.reduce((sum, point) => sum + (point.values.a ?? 0), 0)).toBe(
			25,
		);
		expect(result.reduce((sum, point) => sum + (point.values.b ?? 0), 0)).toBe(
			30,
		);
		expect(points).toEqual(original);
	});

	test("uses calendar months, quarters and years, including leap day", () => {
		const trend = [
			"2024-02-29",
			"2024-03-01",
			"2024-03-31",
			"2024-04-01",
			"2024-12-31",
			"2025-01-01",
		].map((date) => ({ date, total: 1, values: { total: 1 } }));
		expect(
			groupChartTrend(trend, "monthly").map(({ date, total }) => [date, total]),
		).toEqual([
			["2024-02-01", 1],
			["2024-03-01", 2],
			["2024-04-01", 1],
			["2024-12-01", 1],
			["2025-01-01", 1],
		]);
		expect(
			groupChartTrend(trend, "quarterly").map(({ date, total }) => [
				date,
				total,
			]),
		).toEqual([
			["2024-01-01", 3],
			["2024-04-01", 1],
			["2024-10-01", 1],
			["2025-01-01", 1],
		]);
		expect(
			groupChartTrend(trend, "yearly").map(({ date, total }) => [date, total]),
		).toEqual([
			["2024-01-01", 5],
			["2025-01-01", 1],
		]);
	});

	test("keeps daily zero points and handles an empty selection", () => {
		expect(groupChartTrend([], "yearly")).toEqual([]);
		expect(
			groupChartTrend(points, "daily").map(({ date, total, values }) => ({
				date,
				total,
				values,
			})),
		).toEqual(points);
	});

	test("recomputes CI ratios from additive components across intervals", () => {
		const trend = [
			{
				date: "2026-04-06",
				total: 2,
				values: { repo: 2 },
				numerator: 2,
				denominator: 1,
				numeratorValues: { repo: 2 },
				denominatorValues: { repo: 1 },
			},
			{
				date: "2026-04-07",
				total: 0.5,
				values: { repo: 0.5 },
				numerator: 1,
				denominator: 2,
				numeratorValues: { repo: 1 },
				denominatorValues: { repo: 2 },
			},
		];
		const [weekly] = groupChartTrend(trend, "weekly", "ratio");
		assert(weekly);

		expect(weekly.total).toBe(1);
		expect(weekly.values.repo).toBe(1);
		expect(getChartSeriesValue(weekly, "repo", "2026-04-08", "ratio")).toBe(1);
	});

	test("shows one failed attempt across two merged PRs as 0.5 daily and weekly", () => {
		const trend = [
			{
				date: "2026-09-18",
				total: 0.5,
				values: { total: 0.5 },
				numerator: 1,
				denominator: 2,
				numeratorValues: { total: 1 },
				denominatorValues: { total: 2 },
			},
		];
		const [daily] = groupChartTrend(trend, "daily", "ratio");
		const [weekly] = groupChartTrend(trend, "weekly", "ratio");
		assert(daily);
		assert(weekly);

		expect(daily.total).toBe(0.5);
		expect(weekly.total).toBe(0.5);
		expect(weekly.numerator).toBe(1);
		expect(weekly.denominator).toBe(2);
	});

	test("keeps the entire week on the axis but leaves future days unplotted", () => {
		const week = [2, 0, 5, 0, 0, 0, 0].map((total, index) => ({
			date: `2026-04-${String(index + 6).padStart(2, "0")}`,
			total,
			values: { total },
		}));
		const daily = groupChartTrend(week, "daily");
		expect(daily.map(({ date }) => date)).toEqual([
			"2026-04-06",
			"2026-04-07",
			"2026-04-08",
			"2026-04-09",
			"2026-04-10",
			"2026-04-11",
			"2026-04-12",
		]);
		expect(
			daily.map((point) => getChartSeriesValue(point, "total", "2026-04-08")),
		).toEqual([2, 0, 5, null, null, null, null]);
		expect(
			daily.map((point) => getChartSeriesValue(point, "total", "2026-04-06")),
		).toEqual([2, null, null, null, null, null, null]);
		expect(
			groupChartTrend(week, "weekly").map((point) =>
				getChartSeriesValue(point, "total", "2026-04-08"),
			),
		).toEqual([7]);
	});

	test("keeps zero-merged-PR periods on the line at every interval", () => {
		// The API zero-fills every day, so empty periods plot at zero instead of
		// being skipped and interpolated across.
		const trend = Array.from({ length: 30 }, (_, index) => {
			const date = new Date(Date.UTC(2026, 8, 1 + index))
				.toISOString()
				.slice(0, 10);
			const total = date === "2026-09-02" || date === "2026-09-29" ? 1 : 0;
			return { date, total, values: { total } };
		});
		const plotted = (interval: (typeof CHART_INTERVALS)[number]["value"]) =>
			groupChartTrend(trend, interval).map((point) =>
				getChartSeriesValue(point, "total", "2026-09-30"),
			);

		expect(plotted("daily")).toHaveLength(30);
		expect(plotted("daily").filter((total) => total === 0)).toHaveLength(28);
		expect(plotted("weekly")).toEqual([1, 0, 0, 0, 1]);
		expect(plotted("monthly")).toEqual([2]);
		expect(plotted("quarterly")).toEqual([2]);
		expect(plotted("yearly")).toEqual([2]);
	});

	test("labels periods in UTC and tooltips show only the included dates", () => {
		expect(formatChartDate("2026-04-01", "quarterly")).toBe("Q2 2026");
		expect(formatChartDate("2026-01-01", "yearly")).toBe("2026");
		expect(formatChartDate("2026-04-01", "monthly")).toBe("Apr 2026");
		const [point] = groupChartTrend(points.slice(0, 1), "weekly");
		assert(point);
		expect(formatChartPeriod(point)).toBe("Dec 28, 2025");
	});
});
