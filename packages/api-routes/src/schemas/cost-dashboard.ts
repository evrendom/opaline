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
export const CostDashboardInputSchema = DateRangeInputSchema.extend({
	requestedMetric: z
		.enum(["cost", "sessions", "signals", "agentRuns"])
		.optional(),
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
}).refine(
	(input) => {
		const days =
			(Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000;
		return days >= 0 && days < 366;
	},
	{ message: "Choose a date range of up to one year." },
);

export const CostBreakdownEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
	value: z.number().nonnegative(),
	incomplete: z.boolean(),
	image: z.string().nullable(),
});
export const DashboardMetricSchema = z.enum([
	"cost",
	"sessions",
	"commits",
	"signals",
	"agentRuns",
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
});
export const CostDashboardSchema = z.object({
	requestedMetric: z
		.enum(["cost", "sessions", "signals", "agentRuns"])
		.optional(),
	splitBy: z.enum(["none", ...CostDimensionSchema.options]),
	metrics: z.object({
		cost: DashboardMetricDataSchema,
		sessions: DashboardMetricDataSchema,
		// A Git revision on a session does not establish that it created a commit.
		commits: DashboardMetricDataSchema.nullable(),
		signals: DashboardMetricDataSchema.nullable(),
		agentRuns: DashboardMetricDataSchema.nullable(),
	}),
});
export type DashboardSignal = z.infer<typeof DashboardSignalSchema>;
export type DashboardMetric = z.infer<typeof DashboardMetricSchema>;
export type DashboardMetricData = z.infer<typeof DashboardMetricDataSchema>;
export type CostDimension = z.infer<typeof CostDimensionSchema>;
export type CostDashboardInput = z.infer<typeof CostDashboardInputSchema>;
export type CostDashboard = z.infer<typeof CostDashboardSchema>;
export type CostBreakdownEntry = z.infer<typeof CostBreakdownEntrySchema>;
