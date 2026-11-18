import { oc } from "@orpc/contract";
import { z } from "zod";

export const RUN_INDEX_HEAL_SKIP_REASONS = [
	"disabled",
	"worker_disabled",
	"busy",
	"queue_backlog",
	"recent_failures",
	"clickhouse_error",
	"clickhouse_slow",
] as const;

export const RunIndexHealSkipReasonSchema = z.enum(RUN_INDEX_HEAL_SKIP_REASONS);

export const RUN_INDEX_HEAL_TIERS = [
	"admin",
	"retro",
	"active",
	"deprioritized",
] as const;

export const RunIndexHealTierSchema = z.enum(RUN_INDEX_HEAL_TIERS);

const RunIndexHealCountsSchema = z.object({
	sessions: z.number(),
	stale: z.number(),
	indexStale: z.number(),
	parserStale: z.number(),
});

export const RunIndexHealOrganizationSchema = RunIndexHealCountsSchema.extend({
	organizationId: z.string(),
	name: z.string().nullable(),
	tier: RunIndexHealTierSchema,
	lastSessionAt: z.string().nullable(),
});

export const RunIndexHealStatusSchema = z.object({
	generatedAt: z.string(),
	versions: z.object({
		runIndex: z.number(),
		runIndexPricing: z.string(),
		transcriptParser: z.number(),
	}),
	config: z.object({
		enabled: z.boolean(),
		workerEnabled: z.boolean(),
		reparse: z.boolean(),
		maxPerTick: z.number(),
		maxReparsePerTick: z.number(),
		maxPending: z.number(),
		maxRecentFailures: z.number(),
		slowMs: z.number(),
		maxLoad: z.number(),
		deprioritizedOrganizationIds: z.array(z.string()),
	}),
	queue: z.object({ pending: z.number(), recentFailures: z.number() }),
	nextTick: z.object({ skipped: RunIndexHealSkipReasonSchema.nullable() }),
	census: z.union([
		z.object({
			ms: z.number(),
			totals: RunIndexHealCountsSchema,
			organizations: z.array(RunIndexHealOrganizationSchema),
		}),
		z.object({ error: z.string() }),
	]),
});

export const runIndexHealAdminContract = {
	status: oc.output(RunIndexHealStatusSchema),
};

export type RunIndexHealSkipReason = z.infer<
	typeof RunIndexHealSkipReasonSchema
>;
export type RunIndexHealTier = z.infer<typeof RunIndexHealTierSchema>;
export type RunIndexHealOrganization = z.infer<
	typeof RunIndexHealOrganizationSchema
>;
export type RunIndexHealStatus = z.infer<typeof RunIndexHealStatusSchema>;
