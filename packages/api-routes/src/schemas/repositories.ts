import { z } from "zod";
import {
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
