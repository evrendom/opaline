import { formatCompact, formatDuration, formatUsd } from "./trends-format";
import type {
	TrendsBenchmarkModel,
	TrendsBenchmarkPoint,
	TrendsModel,
	TrendsReasoningEffort,
	TrendsSnapshot,
} from "./trends-snapshot";

export type BenchmarkMetric =
	| "costPerTaskUsd"
	| "timePerTaskSeconds"
	| "outputTokensPerTask"
	| "totalOutputTokens"
	| "totalCostUsd";

export interface BenchmarkSection {
	readonly id: string;
	readonly tab: string;
	readonly kind: "connected" | "bars";
	readonly metric: BenchmarkMetric;
	readonly unit: string;
	/** The horizontal axis in a word, for the scatter charts' axis switch. */
	readonly axis?: string;
	/** What a bar chart counts and over what, for its title's switches. */
	readonly measure?: "tokens" | "cost";
	readonly scope?: "task" | "total";
	readonly format: (value: number) => string;
}

export interface BenchmarkObservation {
	readonly model: TrendsBenchmarkModel;
	readonly point: TrendsBenchmarkPoint;
	readonly value: number;
}

export const REASONING_EFFORTS: readonly TrendsReasoningEffort[] = [
	"none",
	"default",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
export const EFFORT_LABELS: Record<TrendsReasoningEffort, string> = {
	none: "N",
	default: "D",
	low: "L",
	medium: "M",
	high: "H",
	xhigh: "X",
	max: "Mx",
};

export const BENCHMARK_SECTIONS: readonly BenchmarkSection[] = [
	{
		id: "cost-intelligence",
		tab: "Cost vs intelligence",
		kind: "connected",
		metric: "costPerTaskUsd",
		unit: "Cost per task (USD)",
		axis: "Cost",
		format: formatUsd,
	},
	{
		id: "time-intelligence",
		tab: "Time per task vs intelligence",
		kind: "connected",
		metric: "timePerTaskSeconds",
		unit: "Time per task (seconds)",
		axis: "Time",
		format: formatDuration,
	},
	{
		id: "tokens-task",
		tab: "Tokens per task",
		kind: "bars",
		metric: "outputTokensPerTask",
		unit: "Output tokens per task",
		measure: "tokens",
		scope: "task",
		format: formatCompact,
	},
	{
		id: "tokens-total",
		tab: "Total tokens",
		kind: "bars",
		metric: "totalOutputTokens",
		unit: "Output tokens · full index run",
		measure: "tokens",
		scope: "total",
		format: formatCompact,
	},
	{
		id: "cost-task",
		tab: "Cost per task",
		kind: "bars",
		metric: "costPerTaskUsd",
		unit: "USD per task",
		measure: "cost",
		scope: "task",
		format: formatUsd,
	},
	{
		id: "cost-total",
		tab: "Total cost",
		kind: "bars",
		metric: "totalCostUsd",
		unit: "USD · full index run",
		measure: "cost",
		scope: "total",
		format: formatUsd,
	},
];

export function benchmarkObservations(
	models: readonly TrendsBenchmarkModel[],
	metric: BenchmarkMetric,
	efforts: ReadonlySet<TrendsReasoningEffort>,
	geometry = false,
): BenchmarkObservation[] {
	return models
		.flatMap((model) =>
			model.points.flatMap((point) => {
				const value = point[metric];
				return !(
					geometry &&
					point.effort === "default" &&
					model.points.some(
						(candidate) =>
							candidate.effort !== "default" && candidate.effort !== "none",
					)
				) &&
					efforts.has(point.effort) &&
					value !== null &&
					Number.isFinite(value)
					? [{ model, point, value }]
					: [];
			}),
		)
		.sort(
			(first, second) => first.point.effortOrder - second.point.effortOrder,
		);
}

export function usageBenchmark(model: TrendsModel, snapshot: TrendsSnapshot) {
	const family = snapshot.benchmarks?.find(
		(candidate) => candidate.id === model.familyId,
	);
	return (
		family?.points.find((point) => point.effort === model.benchmarkEffort) ??
		null
	);
}

/**
 * A family's line joins its variants in effort order, the non-reasoning
 * point included, as Slopalytics draws it. An unnamed default is dropped
 * when named efforts exist, since it repeats one of them.
 */
export function reasoningLinePoints<TPoint extends { readonly effort: string }>(
	points: readonly TPoint[],
): readonly TPoint[] {
	const named = points.some(
		(point) => point.effort !== "none" && point.effort !== "default",
	);
	return named ? points.filter((point) => point.effort !== "default") : points;
}

/** One unbroken line per family, even where cost or score steps back. */
export function reasoningLineSegments<
	TPoint extends {
		readonly effort: string;
		readonly horizontal: number;
		readonly vertical: number;
	},
>(points: readonly TPoint[]): readonly (readonly TPoint[])[] {
	const line = reasoningLinePoints(points);
	return line.length > 0 ? [line] : [];
}

export function paretoObservations(
	observations: readonly BenchmarkObservation[],
) {
	return observations
		.filter(
			(candidate) =>
				candidate.point.intelligenceIndex !== null &&
				!observations.some((other) => {
					const intelligence = candidate.point.intelligenceIndex;
					const otherIntelligence = other.point.intelligenceIndex;
					return (
						intelligence !== null &&
						otherIntelligence !== null &&
						other.value <= candidate.value &&
						otherIntelligence >= intelligence &&
						(other.value < candidate.value || otherIntelligence > intelligence)
					);
				}),
		)
		.sort((first, second) => first.value - second.value);
}

export function benchmarkGroups(observations: readonly BenchmarkObservation[]) {
	const groups = new Map<string, BenchmarkObservation[]>();
	for (const observation of observations) {
		const id = observation.model.id;
		groups.set(id, [...(groups.get(id) ?? []), observation]);
	}
	return (
		[...groups]
			.map(([id, rows]) => ({
				id,
				rows,
				min: Math.min(...rows.map((row) => row.value)),
				max: Math.max(...rows.map((row) => row.value)),
			}))
			// Lowest first, so the highest stand last.
			.sort((first, second) => first.max - second.max)
	);
}
