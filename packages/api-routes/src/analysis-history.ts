import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AnalysisFindInputBaseSchema,
	AnalysisFindOutputSchema,
	AnalysisReadInputBaseSchema,
	AnalysisReadOutputSchema,
} from "./analysis.js";

/** Where an analysis was run. Evaluation analyses are kept but left out of searches. */
export const AnalysisHostSchema = z.enum([
	"plugin",
	"home",
	"cli",
	"scheduled",
	"eval",
]);

const id = z.string().min(1).max(40);

export const AnalysisScopeSchema = z.object({
	from: z.string().nullable(),
	to: z.string().nullable(),
	filters: z.record(z.string(), z.string()),
});

/** How an analysis's token usage is known. Missing usage is never estimated. */
export const AnalysisCostSchema = z.object({
	source: z.enum(["linked", "reported"]),
	model: z.string(),
	inputTokens: z.number().int(),
	cachedInputTokens: z.number().int(),
	cacheWriteTokens: z.number().int(),
	outputTokens: z.number().int(),
	reasoningTokens: z.number().int(),
	costUsd: z.number().nullable(),
});

const AnalysisSummarySchema = z.object({
	id: z.string(),
	question: z.string(),
	status: z.enum(["finished", "unfinished"]),
	authorId: z.string(),
	mine: z.boolean(),
	shared: z.boolean(),
	host: AnalysisHostSchema,
	scope: AnalysisScopeSchema,
	cutoff: z.string(),
	createdAt: z.string(),
	answerHead: z.string().nullable(),
	updates: z.string().nullable(),
	topics: z.array(z.string()),
	/** Why it was listed: its question or one of its steps matched, or it is recent. */
	match: z.object({
		kind: z.enum(["question", "step", "recent"]),
		step: z.string().nullable(),
		text: z.string().nullable(),
	}),
});

export const AnalysisHistorySearchInputSchema = z
	.object({
		text: z.string().min(1).max(500).optional(),
		limit: z.number().int().min(1).max(50).default(10),
		includeEval: z.boolean().default(false),
	})
	.strict();
export const AnalysisHistorySearchOutputSchema = z.object({
	analyses: z.array(AnalysisSummarySchema),
});

const QuerySummarySchema = z.object({
	id: z.string(),
	tool: z.enum(["find", "read"]),
	args: z.record(z.string(), z.unknown()),
	outputChars: z.number().int(),
	createdAt: z.string(),
	/** Why the stored result cannot be opened, if it cannot. */
	unavailable: z.enum(["expired", "removed", "restricted"]).nullable(),
});

export const AnalysisHistoryGetInputSchema = z
	.object({ analysis: id })
	.strict();
export const AnalysisHistoryGetOutputSchema = AnalysisSummarySchema.omit({
	answerHead: true,
	match: true,
}).extend({
	finalAnswer: z.string().nullable(),
	notes: z.array(z.string()),
	cost: AnalysisCostSchema.nullable(),
	steps: z.array(
		z.object({
			id: z.string(),
			parent: z.string().nullable(),
			question: z.string(),
			/** The asker's reply, when the step was a question to them. */
			reply: z.string().nullable(),
			finding: z.string().nullable(),
			queries: z.array(QuerySummarySchema),
		}),
	),
});

export const AnalysisHistoryQueryInputSchema = z.object({ query: id }).strict();
export const AnalysisHistoryQueryOutputSchema = z.object({
	id: z.string(),
	analysis: z.string(),
	step: z.string(),
	createdAt: z.string(),
	/** A session it read has a newer transcript since; rerun before relying on it. */
	stale: z.boolean(),
	unavailable: z.enum(["expired", "removed", "restricted"]).nullable(),
	call: z.discriminatedUnion("tool", [
		z.object({
			tool: z.literal("find"),
			args: AnalysisFindInputBaseSchema.partial(),
			output: AnalysisFindOutputSchema.nullable(),
		}),
		z.object({
			tool: z.literal("read"),
			args: AnalysisReadInputBaseSchema.partial(),
			output: AnalysisReadOutputSchema.nullable(),
		}),
	]),
});

export const AnalysisHistorySaveInputSchema = z
	.object({
		/** Missing only when no find/read call of this analysis was logged. */
		analysis: z
			.string({
				error: (issue) =>
					issue.input === undefined
						? "required: pass the analysis id from the trace line of a find or read call (trace analysis=<id>); without one, nothing was logged to save"
						: undefined,
			})
			.min(1)
			.max(40),
		finalAnswer: z.string().min(1).max(20_000),
		/** `step` is a step id from the trace line, or the step's sub-question text. */
		findings: z
			.array(
				z.object({
					step: z.string().min(1).max(500),
					finding: z.string().min(1).max(4_000),
				}),
			)
			.max(100)
			.default([]),
		/** Questions the agent asked the asker, with their replies, placed before a step if given. */
		clarifications: z
			.array(
				z.object({
					question: z.string().min(1).max(500),
					reply: z.string().min(1).max(2_000),
					before: z.string().min(1).max(500).optional(),
				}),
			)
			.max(20)
			.default([]),
		topics: z.array(z.string().min(1).max(40)).max(8).default([]),
		updates: id.optional(),
	})
	.strict();
export const AnalysisHistorySaveOutputSchema = z.object({
	analysis: z.string(),
	status: z.literal("finished"),
});

export const AnalysisHistoryShareInputSchema = z
	.object({ analysis: id, shared: z.boolean() })
	.strict();
export const AnalysisHistoryShareOutputSchema = z.object({
	analysis: z.string(),
	shared: z.boolean(),
});

export type AnalysisHost = z.infer<typeof AnalysisHostSchema>;
export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;
export type AnalysisCost = z.infer<typeof AnalysisCostSchema>;
export type AnalysisHistorySearchInput = z.infer<
	typeof AnalysisHistorySearchInputSchema
>;
export type AnalysisHistorySearchOutput = z.infer<
	typeof AnalysisHistorySearchOutputSchema
>;
export type AnalysisHistoryGetOutput = z.infer<
	typeof AnalysisHistoryGetOutputSchema
>;
export type AnalysisHistoryQueryOutput = z.infer<
	typeof AnalysisHistoryQueryOutputSchema
>;
export type AnalysisHistorySaveInput = z.infer<
	typeof AnalysisHistorySaveInputSchema
>;

export const analysisHistoryContract = {
	search: oc
		.input(AnalysisHistorySearchInputSchema)
		.output(AnalysisHistorySearchOutputSchema),
	get: oc
		.input(AnalysisHistoryGetInputSchema)
		.output(AnalysisHistoryGetOutputSchema),
	query: oc
		.input(AnalysisHistoryQueryInputSchema)
		.output(AnalysisHistoryQueryOutputSchema),
	save: oc
		.input(AnalysisHistorySaveInputSchema)
		.output(AnalysisHistorySaveOutputSchema),
	share: oc
		.input(AnalysisHistoryShareInputSchema)
		.output(AnalysisHistoryShareOutputSchema),
};
