import { SessionOverviewAnalyticsSchema } from "@rudel/api-routes";
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
	sessions: z.array(SessionOverviewAnalyticsSchema).max(30),
	totalSessionCount: z.number(),
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
