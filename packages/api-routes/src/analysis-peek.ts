import { oc } from "@orpc/contract";
import { z } from "zod";

export const PEEK_HEAD_ROWS = 5;

export const AnalysisPeekInputSchema = z
	.object({
		query: z.string().trim().min(1).max(24_000),
	})
	.strict();

export const AnalysisPeekOutputSchema = z.object({
	rows: z.number().int(),
	chars: z.number().int(),
	columns: z.array(z.string()),
	head: z.array(z.record(z.string(), z.unknown())),
	ms: z.number().int(),
});
export type AnalysisPeekOutput = z.infer<typeof AnalysisPeekOutputSchema>;

export const SLICE_MAX_ROWS = 50_000;

export const AnalysisSliceOutputSchema = z.object({
	rows: z.array(z.record(z.string(), z.unknown())),
	more: z.boolean(),
});

export const analysisPeekContract = {
	peek: oc.input(AnalysisPeekInputSchema).output(AnalysisPeekOutputSchema),
	slice: oc.input(AnalysisPeekInputSchema).output(AnalysisSliceOutputSchema),
};
