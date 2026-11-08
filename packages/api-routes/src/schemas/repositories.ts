import { z } from "zod";
import {
	DateRangeInputSchema,
	HistoricalSkillSummarySchema,
	RepoIdentitySchema,
} from "./analytics.js";

export const RepositoryInputSchema = z.object({
	repoKey: z.string().min(1).max(4096),
});
export const RepositoryRangedInputSchema = RepositoryInputSchema.extend({
	range: DateRangeInputSchema.optional(),
});
export const RepositoryScopedInputSchema = z.object({
	repoKey: z.string().min(1).max(4096).optional(),
	range: DateRangeInputSchema.optional(),
});
export const RepositorySummarySchema = z.object({
	identity: RepoIdentitySchema,
	dashboardIds: z.array(z.string()),
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

const RepositoryFilesUnavailableSchema = z.object({
	status: z.literal("unavailable"),
	reason: z.enum(["not-github", "not-connected", "unreachable"]),
});
export const RepositoryTreeEntrySchema = z.object({
	path: z.string(),
	type: z.enum(["file", "dir"]),
	size: z.number().nullable(),
});
export type RepositoryTreeEntry = z.infer<typeof RepositoryTreeEntrySchema>;
export const RepositoryFilesSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("available"),
		repository: z.object({
			owner: z.string(),
			name: z.string(),
			branch: z.string(),
			commitSha: z.string(),
		}),
		entries: z.array(RepositoryTreeEntrySchema),
		truncated: z.boolean(),
	}),
	RepositoryFilesUnavailableSchema,
]);
export type RepositoryFiles = z.infer<typeof RepositoryFilesSchema>;
const RepositoryFilePathSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine(
		(path) =>
			path
				.split("/")
				.every(
					(segment) => segment !== "" && segment !== "." && segment !== "..",
				),
		"Invalid repository path",
	);
export const RepositoryFileInputSchema = RepositoryInputSchema.extend({
	path: RepositoryFilePathSchema,
	commitSha: z.string().regex(/^[0-9a-f]{40}$/iu),
});
export const RepositoryFileSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("text"),
		path: z.string(),
		size: z.number(),
		content: z.string(),
	}),
	z.object({
		status: z.enum(["binary", "too-large", "withheld"]),
		path: z.string(),
		size: z.number().nullable(),
	}),
	RepositoryFilesUnavailableSchema,
]);
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>;
