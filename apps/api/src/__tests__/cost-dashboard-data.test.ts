import { expect, test } from "bun:test";
import { CostDashboardInputSchema } from "@rudel/api-routes";
import {
	buildCostDashboard,
	type CostAggregateRow,
} from "../services/cost-dashboard-data.js";

const input = CostDashboardInputSchema.parse({
	startDate: "2026-09-01",
	endDate: "2026-09-03",
});
const members = new Map([["alice", { label: "Alice", image: null }]]);
function row(overrides: Partial<CostAggregateRow> = {}): CostAggregateRow {
	return {
		metric: "cost",
		date: "2026-09-01",
		dimension: "members",
		id: "alice",
		value: 10,
		incomplete: 0,
		matched_value: 10,
		matched_rows: 2,
		matched_incomplete: 0,
		...overrides,
	};
}

test("zero-fills missing UTC days and computes the total without counting all three facets", () => {
	const result = buildCostDashboard(
		[
			row(),
			row({ dimension: "models", id: "claude-sonnet-4-5" }),
			row({ dimension: "repositories", id: "github.com/opaline/app" }),
		],
		input,
		members,
	);
	expect(result.metrics.cost.total).toBe(10);
	expect(result.metrics.cost.trend.map((point) => point.total)).toEqual([
		10, 0, 0,
	]);
	expect(result.metrics.cost.breakdowns.members[0]?.label).toBe("Alice");
	expect(result.metrics.cost.breakdowns.repositories[0]?.label).toBe(
		"opaline/app",
	);
});

test("uses matched amounts for the chart while keeping alternative selections in the facet", () => {
	const result = buildCostDashboard(
		[row(), row({ id: "bob", value: 80, matched_value: 0, matched_rows: 0 })],
		{ ...input, members: ["alice"] },
		members,
	);
	expect(result.metrics.cost.total).toBe(10);
	expect(
		result.metrics.cost.breakdowns.members.map((entry) => entry.value),
	).toEqual([80, 10]);
	expect(result.metrics.cost.series).toEqual([
		{ id: "total", label: "API Cost" },
	]);
});

test("every model line adds up to its day and the total, with a bounded Other series", () => {
	const rows = Array.from({ length: 10 }, (_, index) =>
		row({
			dimension: "models",
			id: `model-${index}`,
			value: index + 1,
			matched_value: index + 1,
		}),
	);
	const result = buildCostDashboard(
		rows,
		{ ...input, splitBy: "models" },
		members,
	);
	expect(result.metrics.cost.series).toHaveLength(8);
	expect(result.metrics.cost.series.at(-1)?.label).toBe("Other");
	expect(result.metrics.cost.total).toBe(55);
	expect(result.metrics.cost.trend[0]?.values.other).toBe(6);
	for (const point of result.metrics.cost.trend)
		expect(
			Object.values(point.values).reduce((sum, value) => sum + value, 0),
		).toBe(point.total);
});

test("distinguishes unpriced usage from an empty selection", () => {
	const partial = buildCostDashboard(
		[row({ value: 0, incomplete: 1, matched_value: 0, matched_incomplete: 1 })],
		input,
		members,
	);
	expect(partial.metrics.cost.hasUsage).toBe(true);
	expect(partial.metrics.cost.incomplete).toBe(true);
	expect(partial.metrics.cost.breakdowns.members[0]?.incomplete).toBe(true);
	const empty = buildCostDashboard([], input, members);
	expect(empty.metrics.cost.hasUsage).toBe(false);
	expect(empty.metrics.cost.total).toBe(0);
	expect(empty.metrics.cost.trend).toHaveLength(3);
});

test("unpriced usage outside the selection does not mark the chart incomplete", () => {
	const result = buildCostDashboard(
		[
			row(),
			row({
				id: "bob",
				incomplete: 1,
				matched_incomplete: 0,
				matched_rows: 0,
				matched_value: 0,
			}),
		],
		input,
		members,
	);
	expect(result.metrics.cost.incomplete).toBe(false);
	expect(
		result.metrics.cost.breakdowns.members.find((entry) => entry.id === "bob")
			?.incomplete,
	).toBe(true);
});

test("does not use untrusted dimension values as chart object keys", () => {
	const result = buildCostDashboard(
		[row({ dimension: "models", id: "__proto__" })],
		{ ...input, splitBy: "models" },
		members,
	);
	expect(result.metrics.cost.trend[0]?.values).toEqual({ "series-0": 10 });
	expect(result.metrics.cost.series[0]?.label).toBe("__proto__");
});

test("session counts stay separate from costs and sum across days and primary models", () => {
	const result = buildCostDashboard(
		[
			row(),
			row({ metric: "sessions", value: 2, matched_value: 2 }),
			row({
				metric: "sessions",
				date: "2026-09-02",
				value: 3,
				matched_value: 3,
			}),
			row({
				metric: "sessions",
				dimension: "models",
				id: "model-a",
				value: 4,
				matched_value: 4,
			}),
			row({
				metric: "sessions",
				dimension: "models",
				id: "model-b",
				value: 1,
				matched_value: 1,
			}),
		],
		input,
		members,
	);
	expect(result.metrics.cost.total).toBe(10);
	expect(result.metrics.sessions.total).toBe(5);
	expect(result.metrics.sessions.trend.map((day) => day.total)).toEqual([
		2, 3, 0,
	]);
	expect(
		result.metrics.sessions.breakdowns.models.map((entry) => entry.value),
	).toEqual([4, 1]);
	expect(result.metrics.sessions.incomplete).toBe(false);
	expect(result.metrics.commits).toBeNull();
});

test("session splits preserve integer totals and respect matched filters", () => {
	const result = buildCostDashboard(
		[
			row({
				metric: "sessions",
				dimension: "models",
				id: "model-a",
				value: 4,
				matched_value: 4,
			}),
			row({
				metric: "sessions",
				dimension: "models",
				id: "model-b",
				value: 8,
				matched_value: 0,
				matched_rows: 0,
			}),
		],
		{ ...input, splitBy: "models", models: ["model-a"] },
		members,
	);
	expect(result.metrics.sessions.total).toBe(4);
	expect(result.metrics.sessions.series).toHaveLength(1);
	expect(result.metrics.sessions.trend[0]?.values).toEqual({ "series-0": 4 });
	expect(
		result.metrics.sessions.breakdowns.models.map((entry) => entry.value),
	).toEqual([8, 4]);
});

test("language signals default to a combined total without counting facets twice", () => {
	const result = buildCostDashboard(
		[
			row({ metric: "sessions", value: 5, matched_value: 5 }),
			...[
				["modelApologies", 12],
				["userPositive", 7],
				["userNegative", 3],
			].map(([id, value]) =>
				row({
					metric: "signals",
					dimension: "signalTypes",
					id: String(id),
					value: Number(value),
					matched_value: Number(value),
				}),
			),
			row({
				metric: "signals",
				dimension: "members",
				value: 22,
				matched_value: 22,
			}),
			row({
				metric: "signals",
				dimension: "phrases",
				id: "Sorry",
				value: 12,
				matched_value: 12,
			}),
		],
		input,
		members,
	);
	expect(result.metrics.sessions.total).toBe(5);
	expect(result.metrics.signals?.total).toBe(22);
	expect(result.metrics.signals?.series).toEqual([
		{ id: "total", label: "Language signals" },
	]);
	const split = buildCostDashboard(
		[
			...[
				["modelApologies", 12],
				["userPositive", 7],
				["userNegative", 3],
			].map(([id, value]) =>
				row({
					metric: "signals",
					dimension: "signalTypes",
					id: String(id),
					value: Number(value),
					matched_value: Number(value),
				}),
			),
		],
		{ ...input, splitBy: "signalTypes" },
		members,
	);
	expect(split.metrics.signals?.total).toBe(22);
	expect(split.metrics.signals?.series.map((s) => s.label)).toEqual([
		"Model apologies",
		"Positive user",
		"Negative user",
	]);
	expect(result.metrics.signals?.trend[0]?.total).toBe(22);
	expect(
		Object.values(result.metrics.signals?.trend[0]?.values ?? {}).reduce(
			(s, v) => s + v,
			0,
		),
	).toBe(22);
	expect(result.metrics.signals?.breakdowns.phrases[0]?.value).toBe(12);
});

test("selected types keep alternatives visible but only selected occurrences reach the chart", () => {
	const result = buildCostDashboard(
		[
			row({
				metric: "signals",
				dimension: "signalTypes",
				id: "userPositive",
				value: 7,
				matched_value: 7,
			}),
			row({
				metric: "signals",
				dimension: "signalTypes",
				id: "userNegative",
				value: 3,
				matched_value: 0,
				matched_rows: 0,
			}),
		],
		{ ...input, signalTypes: ["userPositive"], splitBy: "signalTypes" },
		members,
	);
	expect(result.metrics.signals?.total).toBe(7);
	expect(result.metrics.signals?.series).toHaveLength(1);
	expect(result.metrics.signals?.breakdowns.signalTypes).toHaveLength(3);
});

test("verbatim splits use safe keys, preserve totals and exclude blank sentinels", () => {
	const result = buildCostDashboard(
		[
			row({
				metric: "signals",
				dimension: "phrases",
				id: "__proto__",
				value: 2,
				matched_value: 2,
			}),
			row({
				metric: "signals",
				dimension: "phrases",
				id: "",
				value: 0,
				matched_value: 0,
			}),
			row({
				metric: "signals",
				dimension: "phrases",
				id: "Great work",
				value: 5,
				matched_value: 0,
				matched_rows: 0,
			}),
			row(),
		],
		{ ...input, splitBy: "phrases", phrases: ["__proto__"] },
		members,
	);
	expect(result.metrics.signals?.total).toBe(2);
	expect(result.metrics.signals?.trend[0]?.values).toEqual({ "series-0": 2 });
	expect(result.metrics.signals?.series[0]?.label).toBe("__proto__");
	expect(result.metrics.signals?.breakdowns.phrases.map((p) => p.id)).toEqual([
		"Great work",
		"__proto__",
	]);
	expect(result.metrics.cost.total).toBe(10);
});

test("unscanned language remains unknown, including when a verbatim filter has no stored phrases yet", () => {
	const result = buildCostDashboard(
		[
			row(),
			row({
				metric: "signals",
				dimension: "members",
				value: 0,
				matched_value: 0,
				incomplete: 1,
				matched_incomplete: 1,
			}),
			row({
				metric: "signals",
				dimension: "phrases",
				id: "",
				value: 0,
				matched_value: 0,
				incomplete: 1,
				matched_incomplete: 1,
			}),
		],
		{ ...input, splitBy: "phrases", phrases: ["Sorry"] },
		members,
	);
	expect(result.metrics.signals).toBeNull();
	expect(result.metrics.cost.total).toBe(10);
});
