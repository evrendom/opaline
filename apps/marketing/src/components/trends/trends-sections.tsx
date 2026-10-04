import {
	formatCompact,
	formatDecimal,
	formatDuration,
	formatUsd,
} from "../../trends/trends-format";
import type {
	TrendsModel,
	TrendsModelMetrics,
	TrendsQuantiles,
	TrendsSnapshot,
} from "../../trends/trends-snapshot";
import { addDays } from "../../trends/trends-usage";

interface TrendsSectionBase {
	readonly id: string;
	readonly tab: string;
	/** What the numbers measure; the only prose a chart carries. */
	readonly unit: string;
}

export interface RankedSection extends TrendsSectionBase {
	readonly kind: "ranked";
	/** Null when the model has no measurement for it. */
	readonly value: (metrics: TrendsModelMetrics) => number | null;
	readonly format: (value: number) => string;
	readonly detail?: (model: TrendsModel) => string | null;
}

export interface RangeSection extends TrendsSectionBase {
	readonly kind: "range";
	/** Null when the model has no measurement for it. */
	readonly quantiles: (metrics: TrendsModelMetrics) => TrendsQuantiles | null;
	readonly format: (value: number) => string;
	readonly ticks: readonly number[];
}

export interface ShareSection extends TrendsSectionBase {
	readonly kind: "share";
	/** "volume": each model's runs (or turns) as they are, stacked, not
	 * its share of them. */
	readonly measure?: "share" | "volume";
}

export interface ScatterSection extends TrendsSectionBase {
	readonly kind: "scatter";
}

export interface HarnessSection extends TrendsSectionBase {
	readonly kind: "harness";
}

/** One of Opaline's monthly series, every model together: run time or
 * tool calls per agent run, each as average, p95 and p99. */
export interface TimelineSection extends TrendsSectionBase {
	readonly kind: "timeline";
	readonly metric: "runTime" | "toolCalls";
}

export type TrendsSection =
	| RankedSection
	| RangeSection
	| ShareSection
	| ScatterSection
	| HarnessSection
	| TimelineSection;

export function pushbackRate(metrics: TrendsModelMetrics) {
	return metrics.reactions
		? metrics.reactions.negative + metrics.reactions.mixed
		: null;
}

/**
 * Reads a figure from a model already kept by `hasMeasurement`. Reaching an
 * unmeasured model here is a bug, so it fails instead of drawing zero.
 */
function measured<T>(value: T | null, figure: string): T {
	if (value === null) throw new Error(`Unmeasured ${figure} reached a chart`);
	return value;
}

export function rankedValue(
	section: RankedSection,
	metrics: TrendsModelMetrics,
) {
	return measured(section.value(metrics), section.id);
}

export function rangeQuantiles(
	section: RangeSection,
	metrics: TrendsModelMetrics,
) {
	return measured(section.quantiles(metrics), section.id);
}

export function measuredPushback(metrics: TrendsModelMetrics) {
	return measured(pushbackRate(metrics), "pushback");
}

/**
 * Whether a model carries the figures a section plots. Charts and tables
 * leave unmeasured models out instead of drawing them at zero.
 */
export function hasMeasurement(section: TrendsSection, model: TrendsModel) {
	switch (section.kind) {
		case "ranked":
			return section.value(model) !== null;
		case "range":
			return section.quantiles(model) !== null;
		case "scatter":
			return model.reactions !== null;
		case "share":
		case "harness":
		case "timeline":
			return true;
	}
}

/**
 * The share by model's periods: T3 Code's days when captured (its turns per
 * model), otherwise the Opaline weeks (agent runs per model).
 */
export function sharePeriods(snapshot: TrendsSnapshot) {
	const days = snapshot.modelDays;
	if (days && days.length > 0) {
		const last = days.at(-1)?.day ?? "";
		// Opaline's runs join T3 Code's turns on T3 Code's days.
		const opaline = new Map(
			(snapshot.opalineModelDays ?? []).map((day) => [
				day.day,
				day.turnsByModel,
			]),
		);
		return {
			kind: "day" as const,
			start: days[0]?.day ?? "",
			endExclusive: addDays(last, 1),
			periods: days.map((day) => ({
				start: day.day,
				runsByModel: sumCounts(day.turnsByModel, opaline.get(day.day)),
			})),
		};
	}
	return {
		kind: "week" as const,
		start: snapshot.shareWindow.start,
		endExclusive: snapshot.shareWindow.endExclusive,
		periods: snapshot.weeks.map((week) => ({
			start: week.weekStart,
			runsByModel: week.runsByModel,
		})),
	};
}

/** Two models' counts added up, model by model. */
function sumCounts(
	first: Readonly<Record<string, number>>,
	second: Readonly<Record<string, number>> = {},
): Record<string, number> {
	const sum: Record<string, number> = { ...first };
	for (const [id, count] of Object.entries(second))
		sum[id] = (sum[id] ?? 0) + count;
	return sum;
}

/** Whether the daily share and volume add Opaline's runs to T3 Code's
 * turns. */
export function shareAddsOpaline(snapshot: TrendsSnapshot) {
	const opalineDays = new Set(
		(snapshot.opalineModelDays ?? []).map((day) => day.day),
	);
	return (snapshot.modelDays ?? []).some((day) => opalineDays.has(day.day));
}

/** Whether a harness balance measure includes Opaline's own days: its
 * runs, spend, or (once captured with input tokens) tokens. */
export function harnessAddsOpaline(
	snapshot: TrendsSnapshot,
	measure: "runs" | "outputTokens" | "costUsd",
) {
	const opalineDays = new Set(
		(snapshot.opalineHarnessDays ?? [])
			.filter((day) => measure !== "outputTokens" || day.inputTokens)
			.map((day) => day.day),
	);
	return (
		snapshot.sources.harnesses.kind === "t3_code" &&
		(snapshot.harnessDays ?? []).some(
			(day) => day[measure] !== null && opalineDays.has(day.day),
		)
	);
}

export function shareOfRuns(snapshot: TrendsSnapshot, modelIds: Set<string>) {
	return sharePeriods(snapshot).periods.map((period) => {
		const total = Object.entries(period.runsByModel)
			.filter(([id]) => modelIds.has(id))
			.reduce((sum, [, runs]) => sum + runs, 0);
		return {
			start: period.start,
			shares: Object.fromEntries(
				Object.entries(period.runsByModel)
					.filter(([id]) => modelIds.has(id))
					.map(([id, runs]) => [id, total > 0 ? runs / total : 0]),
			) as Record<string, number>,
		};
	});
}

export const TRENDS_SECTIONS: readonly TrendsSection[] = [
	{
		// Figures come from the snapshot's friction breakdown for what the
		// reader counts, whose and per what (frictionSection).
		id: "friction-model",
		tab: "Friction by model",
		kind: "ranked",
		unit: "Friction per 10M output tokens",
		value: () => null,
		format: (value) => formatDecimal(value),
	},
	{
		id: "run-time-months",
		tab: "Time per run",
		kind: "timeline",
		metric: "runTime",
		unit: "Wall-clock time per agent run, by month: average, p95 and p99 · log scale",
	},
	{
		id: "tool-calls-months",
		tab: "Tool calls per run",
		kind: "timeline",
		metric: "toolCalls",
		unit: "Tool calls per agent run (reads, edits, shell, MCP, skills, subagents), by month: average, p95 and p99 · log scale",
	},

	{
		id: "runs",
		tab: "Share of runs",
		kind: "share",
		unit: "Weekly share of agent runs among selected models",
	},
	{
		id: "volume",
		tab: "Volume of runs",
		kind: "share",
		measure: "volume",
		unit: "Weekly agent runs among selected models",
	},
	{
		id: "harnesses",
		tab: "Claude Code vs Codex",
		kind: "harness",
		unit: "Daily share difference, Claude Code minus Codex",
	},
	{
		id: "run-time",
		tab: "Run time",
		kind: "range",
		unit: "Wall-clock time per agent run, log scale",
		quantiles: (model) => model.runSeconds,
		format: formatDuration,
		ticks: [10, 30, 60, 180, 600, 1_800, 3_600, 10_800, 36_000],
	},
	{
		id: "tokens",
		tab: "Tokens per run",
		kind: "range",
		unit: "Output tokens per agent run, log scale",
		quantiles: (model) => model.outputTokensPerRun,
		format: formatCompact,
		ticks: [300, 1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000],
	},
	{
		id: "cost",
		tab: "Cost per run",
		kind: "range",
		unit: "Estimated API cost per agent run, USD, log scale",
		quantiles: (model) => model.costPerRunUsd,
		format: formatUsd,
		ticks: [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
	},
];
