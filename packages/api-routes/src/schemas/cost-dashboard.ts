import { z } from "zod";
import { AgentRunDurationSchema, AgentRunSignalSchema } from "./agent-runs.js";
import { DateRangeInputSchema } from "./analytics.js";

export const DashboardSignalSchema = z.enum([
	"modelApologies",
	"userNegative",
	"userPositive",
]);

export const CostDimensionSchema = z.enum([
	"members",
	"repositories",
	"models",
	"signalTypes",
	"phrases",
	"runSignals",
	"durations",
	"skillsUsed",
]);
export const AgentRunDurationIntervalSchema = z.enum([
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"yearly",
]);
/**
 * Metrics a dashboard request can select. Which of them exist for a given
 * scope and deployment is decided by the server and returned as
 * `availableMetrics`, so clients never render a metric the server cannot serve.
 */
export const CostDashboardRequestedMetricSchema = z.enum([
	"cost",
	"sessions",
	"signals",
	"agentRuns",
	"mergedPullRequests",
	"ciFailuresPerPullRequest",
]);
const CostDashboardInputBaseSchema = DateRangeInputSchema.extend({
	requestedMetric: CostDashboardRequestedMetricSchema.optional(),
	durationInterval: AgentRunDurationIntervalSchema.optional(),
	members: z.array(z.string().max(512)).max(100).default([]),
	repositories: z.array(z.string().max(4096)).max(100).default([]),
	models: z.array(z.string().max(512)).max(100).default([]),
	signalTypes: z.array(DashboardSignalSchema).max(3).default([]),
	phrases: z.array(z.string().min(1).max(4096)).max(100).default([]),
	runSignals: z.array(AgentRunSignalSchema).max(5).default([]),
	durations: z.array(AgentRunDurationSchema).max(9).default([]),
	skillsUsed: z
		.array(z.enum(["yes", "no"]))
		.max(2)
		.default([]),
	splitBy: z.enum(["none", ...CostDimensionSchema.options]).default("none"),
});
function isWithinOneYear(input: { startDate: string; endDate: string }) {
	const days =
		(Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000;
	return days >= 0 && days < 366;
}
const ONE_YEAR_MESSAGE = { message: "Choose a date range of up to one year." };
export const CostDashboardInputSchema = CostDashboardInputBaseSchema.refine(
	isWithinOneYear,
	ONE_YEAR_MESSAGE,
);
// Anonymous cross-tenant operator view: members and repositories are neither
// filterable nor split targets, so user identities and customer repository
// names never leave the API.
export const AdminCostDashboardInputSchema = CostDashboardInputBaseSchema.omit({
	members: true,
	repositories: true,
})
	.extend({
		requestedMetric: z.enum(["cost", "sessions", "signals", "agentRuns"]),
		splitBy: z
			.enum([
				"none",
				...CostDimensionSchema.exclude(["members", "repositories"]).options,
			])
			.default("none"),
	})
	.strict()
	.refine(isWithinOneYear, ONE_YEAR_MESSAGE);

export const CostBreakdownEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
	value: z.number().nonnegative(),
	incomplete: z.boolean(),
	image: z.string().nullable(),
	numerator: z.number().nonnegative().optional(),
	denominator: z.number().nonnegative().optional(),
});
export const DashboardMetricSchema = z.enum([
	"cost",
	"sessions",
	"commits",
	"signals",
	"agentRuns",
	"mergedPullRequests",
	"ciFailuresPerPullRequest",
]);

export const AgentRunDurationStatsSchema = z.object({
	interval: AgentRunDurationIntervalSchema,
	sampleCount: z.number().int().nonnegative(),
	unknownCount: z.number().int().nonnegative(),
	medianSeconds: z.number().nonnegative().nullable(),
	p95Seconds: z.number().nonnegative().nullable(),
	trend: z.array(
		z.object({
			date: z.string(),
			startDate: z.string(),
			endDate: z.string(),
			sampleCount: z.number().int().nonnegative(),
			unknownCount: z.number().int().nonnegative(),
			medianSeconds: z.number().nonnegative().nullable(),
			p95Seconds: z.number().nonnegative().nullable(),
		}),
	),
});

export const DashboardMetricDataSchema = z.object({
	total: z.number().nonnegative(),
	incomplete: z.boolean(),
	hasUsage: z.boolean(),
	series: z.array(z.object({ id: z.string(), label: z.string() })),
	trend: z.array(
		z.object({
			date: z.string(),
			total: z.number(),
			values: z.record(z.number()),
			numerator: z.number().nonnegative().optional(),
			denominator: z.number().nonnegative().optional(),
			numeratorValues: z.record(z.number().nonnegative()).optional(),
			denominatorValues: z.record(z.number().nonnegative()).optional(),
		}),
	),
	breakdowns: z.object({
		members: z.array(CostBreakdownEntrySchema),
		repositories: z.array(CostBreakdownEntrySchema),
		models: z.array(CostBreakdownEntrySchema),
		signalTypes: z.array(CostBreakdownEntrySchema),
		phrases: z.array(CostBreakdownEntrySchema),
		runSignals: z.array(CostBreakdownEntrySchema),
		durations: z.array(CostBreakdownEntrySchema),
		skillsUsed: z.array(CostBreakdownEntrySchema),
	}),
	coverage: z
		.object({
			indexedSessions: z.number().int().nonnegative(),
			indexingSessions: z.number().int().nonnegative(),
			unavailableSessions: z.number().int().nonnegative(),
		})
		.optional(),
	durationStats: AgentRunDurationStatsSchema.optional(),
	numerator: z.number().nonnegative().optional(),
	denominator: z.number().nonnegative().optional(),
});
export const CostDashboardSchema = z.object({
	requestedMetric: CostDashboardRequestedMetricSchema.optional(),
	splitBy: z.enum(["none", ...CostDimensionSchema.options]),
	// Server source of truth for the metrics this scope offers. Requests for a
	// metric outside this list are answered as the default cost view.
	availableMetrics: z.array(CostDashboardRequestedMetricSchema),
	metrics: z.object({
		cost: DashboardMetricDataSchema,
		sessions: DashboardMetricDataSchema,
		// A Git revision on a session does not establish that it created a commit.
		commits: DashboardMetricDataSchema.nullable(),
		signals: DashboardMetricDataSchema.nullable(),
		agentRuns: DashboardMetricDataSchema.nullable(),
		mergedPullRequests: DashboardMetricDataSchema.nullable(),
		ciFailuresPerPullRequest: DashboardMetricDataSchema.nullable(),
	}),
});
export type DashboardSignal = z.infer<typeof DashboardSignalSchema>;
export type DashboardMetric = z.infer<typeof DashboardMetricSchema>;
export type DashboardMetricData = z.infer<typeof DashboardMetricDataSchema>;
export type CostDimension = z.infer<typeof CostDimensionSchema>;
export type CostDashboardInput = z.infer<typeof CostDashboardInputSchema>;
export type CostDashboardRequestedMetric = z.infer<
	typeof CostDashboardRequestedMetricSchema
>;
export type AdminCostDashboardInput = z.infer<
	typeof AdminCostDashboardInputSchema
>;
export type CostDashboard = z.infer<typeof CostDashboardSchema>;
export type CostBreakdownEntry = z.infer<typeof CostBreakdownEntrySchema>;
