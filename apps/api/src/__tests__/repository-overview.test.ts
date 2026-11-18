import { expect, test } from "bun:test";
import { contract } from "@rudel/api-routes";
import {
	EMPTY_REPOSITORY_OVERVIEW,
	type RepositoryOverviewRow,
	shapeRepositoryOverview,
} from "../services/repository-overview.js";

const outputSchema =
	contract.analytics.repositories.overview["~orpc"].outputSchema;

const base: RepositoryOverviewRow = {
	grouping_kind: "total",
	day: "1970-01-01",
	model: "",
	member: "",
	session_count: "10",
	errored_session_count: "3",
	error_count: "7",
	turn_count: "120",
	total_tokens: "50000",
	estimated_cost: 12.5,
	incomplete_costs: "0",
	user_count: "2",
	duration_quantiles: [14, 52.5],
	cost_session_quantiles: [0.2, 0.8, 1.4, 2.9],
	duration_session_quantiles: [3, 9, 18, 40],
	user_negative: "4",
	user_positive: "6",
	model_apologies: "1",
};

const row = (overrides: Partial<RepositoryOverviewRow>) => ({
	...base,
	...overrides,
});

test("shapes totals, the daily trend and the model and member splits", () => {
	const overview = shapeRepositoryOverview([
		row({ grouping_kind: "day", day: "2026-10-02", session_count: "4" }),
		row({ grouping_kind: "day", day: "2026-10-01", incomplete_costs: "1" }),
		row({
			grouping_kind: "day_model",
			day: "2026-10-01",
			model: "gpt-5.6",
			estimated_cost: 2,
		}),
		row({
			grouping_kind: "day_model",
			day: "2026-10-01",
			model: "unpriced",
			estimated_cost: 0,
		}),
		row({ grouping_kind: "model", model: "gpt-5.6", estimated_cost: 3 }),
		row({ grouping_kind: "member", member: "ada", estimated_cost: 9.5 }),
		base,
	]);

	expect(outputSchema?.parse(overview)).toEqual(overview);
	expect(overview.stats).toEqual({
		sessionCount: 10,
		erroredSessionCount: 3,
		errorCount: 7,
		turnCount: 120,
		totalTokens: 50000,
		estimatedCost: 12.5,
		userCount: 2,
		durationMin: { p50: 14, p95: 52.5 },
		signals: { userNegative: 4, userPositive: 6, modelApologies: 1 },
		sessionQuantiles: {
			estimatedCost: [0.2, 0.8, 1.4, 2.9],
			durationMin: [3, 9, 18, 40],
		},
	});
	expect(overview.trend.map((day) => day.date)).toEqual([
		"2026-10-01",
		"2026-10-02",
	]);
	expect(overview.trend[0]).toMatchObject({
		estimatedCost: 12.5,
		incomplete: true,
		modelCosts: { "gpt-5.6": 2 },
	});
	expect(overview.trend[1]?.modelCosts).toEqual({});
	expect(overview.models).toEqual([
		{
			model: "gpt-5.6",
			sessionCount: 10,
			totalTokens: 50000,
			estimatedCost: 3,
		},
	]);
	expect(overview.members[0]?.userId).toBe("ada");
});

test("nulls a cost with unpriced sessions but ranks it by its priced part", () => {
	const overview = shapeRepositoryOverview([
		base,
		row({
			grouping_kind: "member",
			member: "cheap",
			estimated_cost: 1,
			session_count: "9",
		}),
		row({
			grouping_kind: "member",
			member: "partial",
			estimated_cost: 5,
			incomplete_costs: "2",
		}),
		row({
			grouping_kind: "member",
			member: "busy",
			estimated_cost: 1,
			session_count: "20",
		}),
		row({ grouping_kind: "member", member: "alpha", estimated_cost: 1 }),
		row({ grouping_kind: "member", member: "beta", estimated_cost: 1 }),
	]);
	expect(
		overview.members.map((member) => [member.userId, member.estimatedCost]),
	).toEqual([
		["partial", null],
		["busy", 1],
		["alpha", 1],
		["beta", 1],
		["cheap", 1],
	]);
});

test("caps each split at 50 rows", () => {
	const overview = shapeRepositoryOverview([
		base,
		...Array.from({ length: 60 }, (_, index) =>
			row({
				grouping_kind: "model",
				model: `m${index}`,
				estimated_cost: index,
			}),
		),
	]);
	expect(overview.models).toHaveLength(50);
	expect(overview.models[0]?.model).toBe("m59");
});

test("drops non-finite quantiles and returns the empty overview without sessions", () => {
	const overview = shapeRepositoryOverview([
		row({
			duration_quantiles: [Number.NaN, Number.POSITIVE_INFINITY],
			cost_session_quantiles: [],
			duration_session_quantiles: [1, Number.NaN, 3],
		}),
	]);
	expect(overview.stats.durationMin).toEqual({ p50: null, p95: null });
	expect(overview.stats.sessionQuantiles).toEqual({
		estimatedCost: [],
		durationMin: [1, 3],
	});
	expect(shapeRepositoryOverview([])).toEqual(EMPTY_REPOSITORY_OVERVIEW);
	expect(shapeRepositoryOverview([row({ session_count: "0" })])).toEqual(
		EMPTY_REPOSITORY_OVERVIEW,
	);
});
