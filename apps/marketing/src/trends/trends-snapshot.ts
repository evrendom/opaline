import type {
	ModelEffort,
	ModelLab,
} from "../../../../packages/api-routes/src/model-registry";

export type TrendsProvider = ModelLab;

export type TrendsReasoningEffort = ModelEffort;

export type TrendsModelGroup =
	| "in_use"
	| "frontier"
	| "coding_tools"
	| "earlier_versions";

export const TRENDS_MODEL_GROUPS: readonly {
	readonly id: TrendsModelGroup;
	readonly title: string;
}[] = [
	{ id: "in_use", title: "In use" },
	{ id: "frontier", title: "Frontier" },
	{ id: "coding_tools", title: "Coding tools" },
	{ id: "earlier_versions", title: "Earlier versions" },
];

export interface TrendsBenchmarkPoint {
	readonly sourceId: string | null;
	readonly sourceSlug: string | null;
	readonly sourceUrl: string;
	readonly estimated: boolean;
	readonly effortLabel: string;
	readonly effort: TrendsReasoningEffort;
	readonly effortOrder: number;
	readonly intelligenceIndex: number | null;
	readonly costPerTaskUsd: number | null;
	readonly timePerTaskSeconds: number | null;
	readonly outputTokensPerTask: number | null;
	readonly totalOutputTokens: number | null;
	readonly totalCostUsd: number | null;
}

export interface TrendsBenchmarkModel {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsProvider;
	readonly creator: string;
	readonly group: TrendsModelGroup;
	readonly line: string | null;
	readonly releasedAt: string | null;
	readonly url: string;
	readonly points: readonly TrendsBenchmarkPoint[];
	/** List price per million output tokens. */
	readonly outputPricePerMTok?: number | null;
	/**
	 * List price per million input tokens. Within a lab it orders models by
	 * size best of every published field (see modelSize).
	 */
	readonly inputPricePerMTok?: number | null;
}

export interface TrendsQuantiles {
	readonly p50: number;
	readonly p90: number;
	readonly p99?: number;
}

/**
 * Shares of agent runs that received a developer reply, classified by the
 * reply's lexical signal. The four shares sum to 1.
 */
export interface TrendsReactionShares {
	readonly negative: number;
	readonly mixed: number;
	readonly neutral: number;
	readonly positive: number;
}

/**
 * The figures a model is ranked on. A model carries them for the current
 * period and, optionally, for the period before it. A figure is null when
 * none of the model's runs carried the data it needs; charts leave such a
 * model out rather than show zero.
 */
export interface TrendsModelMetrics {
	readonly apologiesPer100Runs: number | null;
	readonly reactions: TrendsReactionShares | null;
	readonly swearsPer1kPrompts: number | null;
	readonly toolFailureRate: number | null;
	readonly runSeconds: Required<TrendsQuantiles> | null;
	readonly outputTokensPerRun: TrendsQuantiles | null;
	readonly costPerRunUsd: TrendsQuantiles | null;
}

export interface TrendsModel extends TrendsModelMetrics {
	readonly id: string;
	readonly name: string;
	readonly provider: TrendsProvider;
	/** Rounded before publication. */
	readonly runs: number;
	/** Sessions with a run of the model, rounded; absent from older data. */
	readonly sessions?: number;
	readonly developers: number;
	readonly topApology: string | null;
	readonly replyRate: number;
	readonly familyId: string;
	readonly benchmarkEffort: TrendsReasoningEffort;
	readonly effortPolicy: "predominant" | "vendor_default";
	readonly firstUsedAt: string;
	readonly isNew: boolean;
	readonly workspaces: number;
	readonly totalOutputTokens: number;
	readonly totalCostUsd: number;
	/** Prior-period figures; absent for a model that is new this period. */
	readonly previous?: TrendsModelMetrics;
}

export interface TrendsWeek {
	readonly weekStart: string;
	readonly runsByModel: Readonly<Record<string, number>>;
}

/** One model's friction figures within one population of developers. */
export interface TrendsFrictionModel {
	readonly familyId: string;
	readonly developers: number;
	readonly swearers: number;
	/** Developers' swear words. */
	readonly swears: number;
	/** The model's apologies. */
	readonly apologies: number;
	/** The model's failed tool calls. */
	readonly toolErrors: number;
	readonly outputTokens: number;
	readonly prompts: number;
}

/** Friction per model for three populations: every developer, developers
 * who have sworn at any model, and those who used the cohort model. */
export interface TrendsFriction {
	readonly cohortFamilyId: string;
	readonly all: { readonly models: readonly TrendsFrictionModel[] };
	readonly swearers: { readonly models: readonly TrendsFrictionModel[] };
	readonly cohort: { readonly models: readonly TrendsFrictionModel[] };
}

/** One complete month's wall-clock time per agent run, all models together. */
export interface TrendsRunTimeMonth {
	readonly monthStart: string;
	/** Rounded to the nearest ten. */
	readonly runs: number;
	readonly meanSeconds: number;
	readonly p95Seconds: number;
	readonly p99Seconds: number;
}

/** One complete month's tool calls per agent run, all models together. */
export interface TrendsToolCallMonth {
	readonly monthStart: string;
	/** Rounded to the nearest ten. */
	readonly runs: number;
	readonly meanCalls: number;
	readonly p95Calls: number;
	readonly p99Calls: number;
}

/** One day of turns (T3 Code) or agent runs (Opaline) per model, keyed
 * by model id: both count a prompt through to the agent's answer. */
export interface TrendsModelDay {
	readonly day: string;
	readonly turnsByModel: Readonly<Record<string, number>>;
}

/** The two coding-agent harnesses Opaline ingests. */
export type TrendsHarness = "claude-code" | "codex";

/**
 * One day of harness totals; every measure holds both harnesses, or null when
 * either harness has no report for it that day. Missing is never zero.
 */
export interface TrendsHarnessDay {
	readonly day: string;
	/** Agent runs for Opaline sessions; sent prompts for T3 Code. */
	readonly runs: Readonly<Record<TrendsHarness, number>> | null;
	/** Output tokens for Opaline sessions; input plus output for T3 Code. */
	readonly outputTokens: Readonly<Record<TrendsHarness, number>> | null;
	readonly costUsd: Readonly<Record<TrendsHarness, number>> | null;
}

export interface TrendsSnapshot {
	readonly sources: {
		readonly benchmarks: {
			readonly kind: "artificial_analysis" | "preview";
			readonly fetchedAt: string;
			readonly sourceUrl: string | null;
			readonly sourceSha256: string | null;
			readonly indexVersion: string | null;
		};
		readonly usage: {
			readonly kind: "preview" | "opaline";
			readonly periodStart: string;
			readonly periodEndExclusive: string;
		};
		/**
		 * The Claude Code vs Codex balance has its own source: Slopalytics'
		 * T3 Code usage, or the usage population as a fallback.
		 */
		readonly harnesses: {
			readonly kind: "preview" | "opaline" | "t3_code";
			readonly fetchedAt: string;
			readonly sourceUrl: string | null;
		};
	};
	readonly periodStart: string;
	readonly periodEndExclusive: string;
	/** "all_time": the usage period spans every run Opaline holds, with no
	 * prior period to compare. Absent: one month against the month before. */
	readonly usageScope?: "all_time";
	readonly publishedAt: string;
	readonly totals: {
		readonly runs: number;
		/** Rounded; absent from older data, as are prompts and workspaces. */
		readonly sessions?: number;
		readonly prompts?: number;
		readonly developers: number;
		readonly workspaces?: number;
	};
	readonly thresholds: {
		readonly minRuns: number;
		readonly minDevelopers: number;
		readonly minWorkspaces: number;
	};
	readonly models: readonly TrendsModel[];
	readonly weeks: readonly TrendsWeek[];
	readonly shareWindow: {
		readonly start: string;
		readonly endExclusive: string;
		readonly completeWeeks: number;
	};
	readonly benchmarks?: readonly TrendsBenchmarkModel[];
	/** Daily Claude Code and Codex totals, oldest first; see sources.harnesses. */
	readonly harnessDays?: readonly TrendsHarnessDay[];
	/** Friction per model by population; absent before published. */
	readonly friction?: TrendsFriction;
	/** Opaline's run time per month, oldest first; absent before published. */
	readonly runTimeMonths?: readonly TrendsRunTimeMonth[];
	/** Opaline's tool calls per run per month, oldest first; absent before
	 * published. */
	readonly toolCallMonths?: readonly TrendsToolCallMonth[];
	/** Daily turns per model from T3 Code, oldest first; when present, the
	 * share by model draws these instead of the Opaline weeks. */
	readonly modelDays?: readonly TrendsModelDay[];
	/** Opaline's agent runs per published model per day, oldest first;
	 * summed into T3 Code's days where both are captured. Absent from older
	 * captures. */
	readonly opalineModelDays?: readonly TrendsModelDay[];
	/** Opaline's own harness days (its Claude Code and Codex transcripts),
	 * kept when T3 Code's replace the balance, so their runs, tokens and
	 * spend can join T3 Code's. Input tokens are absent from older
	 * captures. */
	readonly opalineHarnessDays?: readonly (TrendsHarnessDay & {
		readonly inputTokens?: Readonly<Record<TrendsHarness, number>>;
	})[];
}
