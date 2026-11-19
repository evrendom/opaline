import {
	CostDashboardInputSchema,
	CostDashboardSchema,
	LastSessionUploadSchema,
	RepositorySummarySchema,
	SessionOverviewListRowSchema,
} from "@rudel/api-routes";
import { createContext, useContext } from "react";
import { z } from "zod";
import { planUsageSearch } from "@/features/costs/plan-usage/use-plan-usage";
import { parseSelfHostInfo } from "@/features/self-hosted/self-host-info";

export const DEMO_RANGE = {
	startDate: "2026-08-01",
	endDate: "2026-08-31",
} as const;

export function demoPlanUsageSearch(): string {
	return planUsageSearch(DEMO_RANGE);
}

export const DemoSeedSchema = z.object({
	organization: z.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
		logo: z.string(),
	}),
	members: z.array(
		z.object({ userId: z.string(), name: z.string(), image: z.string() }),
	),
	viewerUserId: z.string(),
	sessions: z.array(SessionOverviewListRowSchema).max(30),
	totalSessionCount: z.number(),
	repositories: z.array(RepositorySummarySchema),
	navigation: z.array(
		RepositorySummarySchema.pick({
			identity: true,
			sessionCount: true,
			lastActiveAt: true,
		}),
	),
	lastUpload: LastSessionUploadSchema.nullable(),
	dashboard: z.object({
		input: CostDashboardInputSchema,
		data: CostDashboardSchema,
	}),
	// The other stat cards' requests: a dashboard response only carries a real
	// trend for its requested metric, so each card's sparkline needs its own.
	previews: z.array(
		z.object({
			input: CostDashboardInputSchema,
			data: CostDashboardSchema,
		}),
	),
	maxima: z.object({
		input: z.number(),
		output: z.number(),
		tokens: z.number().optional(),
		cost: z.number(),
	}),
	selfHost: z.unknown().transform((value, context) => {
		const info = parseSelfHostInfo(value);
		if (!info) {
			context.addIssue({ code: "custom", message: "Not a self-host info" });
			return z.NEVER;
		}
		return info;
	}),
	planUsage: z.unknown(),
	queries: z.array(z.tuple([z.array(z.unknown()), z.unknown()])).optional(),
});
export type DemoSeed = z.infer<typeof DemoSeedSchema>;
export interface DemoRuntime {
	seed: DemoSeed;
	live: boolean;
}
export const DemoRuntimeContext = createContext<DemoRuntime | null>(null);
export function useDemoRuntime() {
	return useContext(DemoRuntimeContext);
}
