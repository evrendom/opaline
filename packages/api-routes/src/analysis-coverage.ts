import { oc } from "@orpc/contract";
import { z } from "zod";
import { MeasureScopeSchema } from "./analysis-measures.js";

export const COVERAGE_LIVE_MINUTES = 15;

export const AnalysisCoverageInputSchema = z.object({
	scope: MeasureScopeSchema.optional(),
});

const count = z.number().int().nonnegative();

export const AnalysisCoverageInventorySchema = z.object({
	membersReporting: count,
	membersInScope: count,
	oldestReportAt: z.string(),
	allRepositories: z.boolean(),
	onMachines: count,
	missing: count,
	partial: count,
	unchecked: count,
	live: count,
	omitted: count,
});

export const AnalysisCoverageOutputSchema = z.object({
	window: z.object({ from: z.string(), to: z.string() }).nullable(),
	repository: z.string().nullable(),
	sessions: count,
	current: count,
	olderIndex: count,
	notIndexed: count,
	inventory: AnalysisCoverageInventorySchema.nullable(),
	line: z.string(),
});

export type AnalysisCoverageInput = z.infer<typeof AnalysisCoverageInputSchema>;
export type AnalysisCoverageOutput = z.infer<
	typeof AnalysisCoverageOutputSchema
>;
export type AnalysisCoverageInventory = z.infer<
	typeof AnalysisCoverageInventorySchema
>;

export const analysisCoverageContract = {
	coverage: oc
		.input(AnalysisCoverageInputSchema)
		.output(AnalysisCoverageOutputSchema),
};
