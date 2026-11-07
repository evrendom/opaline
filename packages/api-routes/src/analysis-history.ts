import { oc } from "@orpc/contract";
import { z } from "zod";
import {
	AnalysisFindInputBaseSchema,
	AnalysisFindOutputSchema,
	AnalysisReadInputBaseSchema,
	AnalysisReadOutputSchema,
	AnalysisSqlInputSchema,
	AnalysisSqlOutputSchema,
	RunRefSchema,
} from "./analysis.js";
import { SourceSchema } from "./schemas/source.js";

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

const ChangeKindSchema = z.enum([
	"confirmed",
	"strengthened",
	"weakened",
	"new",
	"dropped",
]);

/**
 * How one finding moved against the analysis a revision updates, as saved:
 * `step` names the revision's step whose finding it covers (by id or exact
 * sub-question), or, for `dropped` only, a step of the prior whose finding
 * is no longer supported.
 */
export const AnalysisChangeInputSchema = z
	.object({
		step: z.string().min(1).max(500),
		change: ChangeKindSchema,
		evidence: z.string().min(1).max(500),
	})
	.strict();

/** A stored change: the step id it was resolved to and that step's finding. */
export const AnalysisChangeSchema = z.object({
	step: z.string(),
	/** The finding it covers (the prior's, for a dropped one). */
	finding: z.string(),
	change: ChangeKindSchema,
	evidence: z.string(),
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
	tool: z.enum(["find", "read", "sql"]),
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
	/** How each finding changed against `updates`; empty for a first analysis. */
	changes: z.array(AnalysisChangeSchema),
	/** Saved analyses the viewer may see that revise this one, oldest first. */
	updatedBy: z.array(z.string()),
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
	/** Chats uploaded for this analysis (`opaline import --analysis`), oldest first. */
	chatSessions: z.array(
		z.object({
			sessionId: z.string(),
			source: SourceSchema,
			/** The member whose chat it is. */
			userId: z.string(),
			uploadedAt: z.string(),
		}),
	),
});

export const AnalysisHistoryReportOutputSchema =
	AnalysisHistoryGetOutputSchema.extend({
		results: z.array(
			z.object({
				query: z.string(),
				title: z.string(),
				columns: z.array(z.string()),
				rows: z.array(z.array(z.string())),
				truncated: z.boolean(),
			}),
		),
		citedRuns: z.array(
			z.object({ step: z.string(), runs: z.array(RunRefSchema) }),
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
		z.object({
			tool: z.literal("sql"),
			args: AnalysisSqlInputSchema.partial().extend({
				call: z.record(z.string(), z.unknown()).optional(),
			}),
			output: AnalysisSqlOutputSchema.nullable(),
		}),
	]),
});

/** A stored sql result, opened by its id (`sr_…`). */
export const AnalysisHistorySqlResultInputSchema = z.object({ id }).strict();
export const AnalysisHistorySqlResultOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	query: z.string(),
	createdAt: z.string(),
	/**
	 * Why the rows are gone: expired after 90 days, or removed because a
	 * member whose sessions it counted deleted their account. The title and
	 * SQL stay so it can be rerun.
	 */
	unavailable: z.enum(["expired", "removed"]).nullable(),
	output: AnalysisSqlOutputSchema.omit({ id: true, trace: true }).nullable(),
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
		/**
		 * The question the answer addresses, as a short title (not the user's
		 * words, no personal data); replaces the draft's placeholder.
		 */
		question: z
			.string({
				error: (issue) =>
					issue.input === undefined
						? "required: the question this answer addresses, as a short title"
						: undefined,
			})
			.min(1)
			.max(120),
		finalAnswer: z.string().min(1).max(20_000),
		/** `step` is a step or query id from a trace line. */
		findings: z
			.array(
				z.object({
					step: z.string().min(1).max(500),
					finding: z.string().min(1).max(4_000),
				}),
			)
			.max(100)
			.default([]),
		topics: z.array(z.string().min(1).max(40)).max(8).default([]),
		/** The saved analysis this one revises. */
		updates: id.optional(),
		/** Required when the analysis revises another: how each finding changed. */
		changes: z.array(AnalysisChangeInputSchema).max(150).default([]),
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
export type AnalysisHistoryReportOutput = z.infer<
	typeof AnalysisHistoryReportOutputSchema
>;
export type AnalysisHistoryQueryOutput = z.infer<
	typeof AnalysisHistoryQueryOutputSchema
>;
export type AnalysisChange = z.infer<typeof AnalysisChangeSchema>;
export type AnalysisHistorySqlResultOutput = z.infer<
	typeof AnalysisHistorySqlResultOutputSchema
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
	report: oc
		.input(AnalysisHistoryGetInputSchema)
		.output(AnalysisHistoryReportOutputSchema),
	query: oc
		.input(AnalysisHistoryQueryInputSchema)
		.output(AnalysisHistoryQueryOutputSchema),
	sqlResult: oc
		.input(AnalysisHistorySqlResultInputSchema)
		.output(AnalysisHistorySqlResultOutputSchema),
	save: oc
		.input(AnalysisHistorySaveInputSchema)
		.output(AnalysisHistorySaveOutputSchema),
	share: oc
		.input(AnalysisHistoryShareInputSchema)
		.output(AnalysisHistoryShareOutputSchema),
};
