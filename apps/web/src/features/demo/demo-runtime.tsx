import {
	CostDashboardInputSchema,
	CostDashboardSchema,
	SessionOverviewAnalyticsSchema,
} from "@rudel/api-routes";
import { createContext, useContext } from "react";
import { z } from "zod";

export const DemoSeedSchema = z.object({
	organization: z.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
	}),
	members: z.array(
		z.object({ userId: z.string(), name: z.string(), image: z.string() }),
	),
	// The showcase account's member, shown as the signed-in user before Explore.
	viewerUserId: z.string(),
	sessions: z.array(SessionOverviewAnalyticsSchema).max(30),
	totalSessionCount: z.number(),
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
