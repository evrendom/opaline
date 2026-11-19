import type { RepositoryOverview } from "@rudel/api-routes";

/** ClickHouse returns 64-bit integers as JSON strings. */
type Count = number | string;

/**
 * One row of the overview query's
 * `GROUPING SETS ((day), (day, model), (model), (member), ())`:
 * `grouping_kind` names the set; the keys outside it hold their defaults.
 */
export interface RepositoryOverviewRow {
	grouping_kind: "day" | "day_model" | "model" | "member" | "total";
	day: string;
	model: string;
	member: string;
	session_count: Count;
	errored_session_count: Count;
	error_count: Count;
	turn_count: Count;
	total_tokens: Count;
	/** Priced sessions only (unpriced sessions add 0). */
	estimated_cost: Count;
	incomplete_costs: Count;
	user_count: Count;
	/** [p50, p95] of per-session duration_min. */
	duration_quantiles: readonly Count[];
	/** 20/40/60/80th percentiles of positive per-session values. */
	cost_session_quantiles: readonly Count[];
	duration_session_quantiles: readonly Count[];
	user_negative: Count;
	user_positive: Count;
	model_apologies: Count;
}

export const REPOSITORY_OVERVIEW_BREAKDOWN_LIMIT = 50;

export const EMPTY_REPOSITORY_OVERVIEW: RepositoryOverview = {
	stats: {
		sessionCount: 0,
		erroredSessionCount: 0,
		errorCount: 0,
		turnCount: 0,
		totalTokens: 0,
		estimatedCost: null,
		userCount: 0,
		durationMin: { p50: null, p95: null },
		signals: { userNegative: 0, userPositive: 0, modelApologies: 0 },
		sessionQuantiles: { estimatedCost: [], durationMin: [] },
	},
	trend: [],
	models: [],
	members: [],
};

function finiteOrNull(value: Count | undefined) {
	const number = Number(value);
	return value === undefined || value === null || !Number.isFinite(number)
		? null
		: number;
}

function finiteValues(values: readonly Count[]) {
	return values.map(Number).filter(Number.isFinite);
}

function durationMin(row: RepositoryOverviewRow) {
	if (Number(row.session_count) === 0) return { p50: null, p95: null };
	const [p50, p95] = row.duration_quantiles;
	return { p50: finiteOrNull(p50), p95: finiteOrNull(p95) };
}

/** Null when any contributing session is unpriced, as on the repository cards. */
function totalCost(row: RepositoryOverviewRow) {
	return Number(row.incomplete_costs) > 0 ? null : Number(row.estimated_cost);
}

/**
 * Ranks by priced cost (an unpriced slice ranks by its priced part even
 * though it reports `estimatedCost: null`), then by session count.
 */
function rankBreakdown(
	rows: readonly RepositoryOverviewRow[],
	kind: "model" | "member",
) {
	return rows
		.filter((row) => row.grouping_kind === kind)
		.map((row) => ({
			key: row[kind],
			pricedCost: Number(row.estimated_cost),
			sessionCount: Number(row.session_count),
			totalTokens: Number(row.total_tokens),
			estimatedCost: totalCost(row),
		}))
		.sort(
			(a, b) =>
				b.pricedCost - a.pricedCost ||
				b.sessionCount - a.sessionCount ||
				a.key.localeCompare(b.key),
		)
		.slice(0, REPOSITORY_OVERVIEW_BREAKDOWN_LIMIT);
}

export function shapeRepositoryOverview(
	rows: readonly RepositoryOverviewRow[],
): RepositoryOverview {
	const total = rows.find((row) => row.grouping_kind === "total");
	if (!total || Number(total.session_count) === 0)
		return EMPTY_REPOSITORY_OVERVIEW;
	const modelCostsByDay = new Map<string, [string, number][]>();
	for (const row of rows) {
		const cost = Number(row.estimated_cost);
		if (row.grouping_kind !== "day_model" || !(cost > 0)) continue;
		const costs = modelCostsByDay.get(row.day) ?? [];
		costs.push([row.model, cost]);
		modelCostsByDay.set(row.day, costs);
	}
	return {
		stats: {
			sessionCount: Number(total.session_count),
			erroredSessionCount: Number(total.errored_session_count),
			errorCount: Number(total.error_count),
			turnCount: Number(total.turn_count),
			totalTokens: Number(total.total_tokens),
			estimatedCost: totalCost(total),
			userCount: Number(total.user_count),
			durationMin: durationMin(total),
			signals: {
				userNegative: Number(total.user_negative),
				userPositive: Number(total.user_positive),
				modelApologies: Number(total.model_apologies),
			},
			sessionQuantiles: {
				estimatedCost: finiteValues(total.cost_session_quantiles),
				durationMin: finiteValues(total.duration_session_quantiles),
			},
		},
		trend: rows
			.filter((row) => row.grouping_kind === "day")
			.sort((a, b) => a.day.localeCompare(b.day))
			.map((row) => ({
				date: row.day,
				sessionCount: Number(row.session_count),
				erroredSessionCount: Number(row.errored_session_count),
				estimatedCost: Number(row.estimated_cost),
				incomplete: Number(row.incomplete_costs) > 0,
				modelCosts: Object.fromEntries(modelCostsByDay.get(row.day) ?? []),
				durationMin: durationMin(row),
			})),
		models: rankBreakdown(rows, "model").map(
			({ key, sessionCount, totalTokens, estimatedCost }) => ({
				model: key,
				sessionCount,
				totalTokens,
				estimatedCost,
			}),
		),
		members: rankBreakdown(rows, "member").map(
			({ key, sessionCount, totalTokens, estimatedCost }) => ({
				userId: key,
				sessionCount,
				totalTokens,
				estimatedCost,
			}),
		),
	};
}
