import { z as zod } from "zod";

/**
 * The public, aggregate-only usage dataset behind Opaline Trends' In the wild
 * view, served at `GET /api/trends/usage`. It spans every workspace (and, with
 * scope "all_time", every day through the last complete one) and holds
 * no user, workspace, session or repository identity: only per-model and
 * per-day totals, rates and quantiles. A model is listed only once it clears
 * the publication thresholds the response states.
 */
export const TRENDS_USAGE_PATH = "/api/trends/usage";

const day = zod.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = zod.number().int().nonnegative();
const amount = zod.number().finite().nonnegative();
const rate = zod.number().finite().min(0).max(1);
const quantiles = zod.object({ p50: amount, p90: amount, p99: amount });
const harnessTotals = zod.object({ "claude-code": amount, codex: amount });

/**
 * One model's figures for one period. A rate or distribution is null when no
 * run of the model carried the data it needs, never zero.
 */
export const trendsUsageMetricsSchema = zod.object({
	runs: count,
	/** Apologies per 100 runs, over sessions attributed to the model. */
	apologiesPer100Runs: amount.nullable(),
	/** Shares of replied runs; they sum to 1. Null without replied runs. */
	reactions: zod
		.object({
			negative: rate,
			mixed: rate,
			neutral: rate,
			positive: rate,
		})
		.nullable(),
	replyRate: rate,
	swearsPer1kPrompts: amount.nullable(),
	toolFailureRate: rate.nullable(),
	runSeconds: quantiles.nullable(),
	outputTokensPerRun: quantiles.nullable(),
	costPerRunUsd: quantiles.nullable(),
});

export const trendsUsageModelSchema = zod.object({
	/** Canonical rate-card model id, the model registry's family id. */
	familyId: zod.string().min(1),
	/** Rounded to the nearest ten. */
	runs: count,
	/** Sessions with a run of the model, rounded to the nearest ten. Absent
	 * from responses made before it was published. */
	sessions: count.optional(),
	developers: count,
	workspaces: count,
	firstUsedAt: day,
	totalOutputTokens: amount,
	totalCostUsd: amount,
	topApology: zod.string().nullable(),
	current: trendsUsageMetricsSchema,
	previous: trendsUsageMetricsSchema.nullable(),
});

const frictionPopulation = zod.object({
	models: zod.array(
		zod.object({
			familyId: zod.string().min(1),
			developers: count,
			/** Developers of the population who swore at this model. */
			swearers: count,
			/** Developers' swear words. */
			swears: count,
			/** The model's apologies. */
			apologies: count,
			/** The model's failed tool calls. */
			toolErrors: count,
			outputTokens: amount,
			prompts: count,
		}),
	),
});

export const trendsUsageSchema = zod.object({
	generatedAt: zod.string().datetime(),
	/** "all_time": the period runs from the first run ever through the last
	 * complete UTC day, with no prior period. Absent: the last complete
	 * month, set against the month before it. */
	scope: zod.literal("all_time").optional(),
	periodStart: day,
	periodEndExclusive: day,
	previousPeriodStart: day,
	thresholds: zod.object({
		minRuns: count,
		minDevelopers: count,
		minWorkspaces: count,
		minRunShare: rate,
	}),
	/** Every run in the period, including models below the thresholds.
	 * Sessions (rounded to the nearest ten) and workspaces are absent from
	 * responses made before they were published. */
	totals: zod.object({
		runs: count,
		sessions: count.optional(),
		/** Developer prompts, rounded to the nearest ten. */
		prompts: count.optional(),
		developers: count,
		workspaces: count.optional(),
	}),
	models: zod.array(trendsUsageModelSchema),
	shareWindow: zod.object({
		start: day,
		endExclusive: day,
		completeWeeks: count,
	}),
	weeks: zod.array(
		zod.object({
			weekStart: day,
			runsByModel: zod.record(zod.string(), count),
		}),
	),
	/** The published models' agent runs on every day from the first with
	 * any through the period's end, oldest first. Absent from responses made
	 * before it was published. */
	modelDays: zod
		.array(zod.object({ day, runsByModel: zod.record(zod.string(), count) }))
		.optional(),
	/** Every complete month's wall-clock time per agent run, all models
	 * together, oldest first; a month is listed once its runs clear the run
	 * and developer thresholds. Absent from responses made before it was
	 * published. */
	runTimeMonths: zod
		.array(
			zod.object({
				monthStart: day,
				/** Rounded to the nearest ten. */
				runs: count,
				meanSeconds: amount,
				p95Seconds: amount,
				p99Seconds: amount,
			}),
		)
		.optional(),
	/** Friction per model for three populations: every developer,
	 * developers who have sworn at any model, and developers who used
	 * `cohortFamilyId`. Each lists the models enough of its developers used,
	 * with developers' swear words, the model's apologies and failed tool
	 * calls, prompts and output tokens, so a reader can pick what counts and
	 * the denominator. Absent from responses made before it was published. */
	friction: zod
		.object({
			cohortFamilyId: zod.string().min(1),
			all: frictionPopulation,
			swearers: frictionPopulation,
			cohort: frictionPopulation,
		})
		.optional(),
	/** Every complete month's tool calls per agent run, all models
	 * together, oldest first: every call between a run's prompt and its
	 * answer, subagents' included, over sessions with transcript records. A
	 * month is listed once its runs clear the run and developer thresholds.
	 * Absent from responses made before it was published. */
	toolCallMonths: zod
		.array(
			zod.object({
				monthStart: day,
				/** Rounded to the nearest ten. */
				runs: count,
				meanCalls: amount,
				p95Calls: amount,
				p99Calls: amount,
			}),
		)
		.optional(),
	/** Claude Code's and Codex's runs, tokens and cost on every day from the
	 * first with any (at least the last 30 days), oldest first. */
	harnessDays: zod.array(
		zod.object({
			day,
			runs: harnessTotals,
			outputTokens: harnessTotals,
			/** Every input token: uncached, cache reads and cache writes.
			 * Absent from responses made before it was published. */
			inputTokens: harnessTotals.optional(),
			costUsd: harnessTotals,
		}),
	),
});

export type TrendsUsage = zod.infer<typeof trendsUsageSchema>;
export type TrendsUsageModel = zod.infer<typeof trendsUsageModelSchema>;
export type TrendsUsageMetrics = zod.infer<typeof trendsUsageMetricsSchema>;

/** The marketing build's local copy of one response, with provenance. */
export const trendsUsageCaptureSchema = zod.object({
	fetchedAt: zod.string().datetime(),
	sourceUrl: zod.string().url(),
	usage: trendsUsageSchema,
});

export type TrendsUsageCapture = zod.infer<typeof trendsUsageCaptureSchema>;
