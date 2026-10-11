import { z } from "zod";
import {
	DateRangeInputSchema,
	HistoricalSkillSummarySchema,
	RepoIdentitySchema,
} from "./analytics.js";

export const RepositoryInputSchema = z.object({
	repoKey: z.string().min(1).max(4096),
});
export const RepositorySummarySchema = z.object({
	identity: RepoIdentitySchema,
	sessionCount: z.number(),
	totalTokens: z.number(),
	estimatedCost: z.number().nullable(),
	/** Latest interaction across the repository's sessions (ISO, UTC).
	 * Optional while older API deployments still answer without it. */
	lastActiveAt: z.string().nullable().optional(),
	userCount: z.number(),
	topUsers: z
		.array(z.object({ userId: z.string(), sessionCount: z.number() }))
		.max(3),
	signals: z.object({
		modelApologies: z.number(),
		userNegative: z.number(),
		userPositive: z.number(),
		complete: z.boolean(),
	}),
});
export const RepositoryDetailSchema = z.object({
	skills: z.array(HistoricalSkillSummarySchema),
});
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;

export const RepositoryOverviewInputSchema = DateRangeInputSchema.merge(
	RepositoryInputSchema,
);
/** A slice of one repository's sessions (one model, one member). */
const RepositoryOverviewBreakdownSchema = z.object({
	sessionCount: z.number(),
	totalTokens: z.number(),
	/** Null when any of the slice's sessions has unpriced usage. */
	estimatedCost: z.number().nullable(),
});
/** One repository over a date range: totals, a per-day trend (days without
 * sessions are omitted), and cost/volume split by model and by member. */
export const RepositoryOverviewSchema = z.object({
	stats: z.object({
		sessionCount: z.number(),
		/** Sessions with at least one recorded error. */
		erroredSessionCount: z.number(),
		errorCount: z.number(),
		turnCount: z.number(),
		totalTokens: z.number(),
		estimatedCost: z.number().nullable(),
		userCount: z.number(),
		durationMin: z.object({
			p50: z.number().nullable(),
			p95: z.number().nullable(),
		}),
		signals: z.object({
			userNegative: z.number(),
			userPositive: z.number(),
			modelApologies: z.number(),
		}),
		/** 20/40/60/80th percentiles of per-session values across the range,
		 * for heat-tinting the sessions table (positive values only; empty when
		 * there are none). */
		sessionQuantiles: z.object({
			estimatedCost: z.array(z.number()),
			durationMin: z.array(z.number()),
		}),
	}),
	trend: z.array(
		z.object({
			date: z.string().date(),
			sessionCount: z.number(),
			erroredSessionCount: z.number(),
			/** Priced usage only; `incomplete` marks days with unpriced sessions. */
			estimatedCost: z.number(),
			incomplete: z.boolean(),
			/** That day's priced cost per model (same model ids as `models`). */
			modelCosts: z.record(z.string(), z.number()),
			durationMin: z.object({
				p50: z.number().nullable(),
				p95: z.number().nullable(),
			}),
		}),
	),
	models: z.array(
		RepositoryOverviewBreakdownSchema.extend({ model: z.string() }),
	),
	members: z.array(
		RepositoryOverviewBreakdownSchema.extend({ userId: z.string() }),
	),
});
export type RepositoryOverview = z.infer<typeof RepositoryOverviewSchema>;
