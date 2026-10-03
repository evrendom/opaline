import { oc } from "@orpc/contract";
import { z } from "zod";

export const RunRefSchema = z
	.object({
		sessionId: z.string().min(1).max(200),
		agentId: z.string().max(200),
		turn: z.number().int().min(1).max(4_294_967_294),
	})
	.strict();

/**
 * Every find/read call belongs to an analysis. The first call of an analysis
 * passes the asker's `question`; later calls pass the returned `analysis` id.
 * `step` names the sub-question the call answers: an existing step id, or new
 * sub-question text (optionally under `parentStep`).
 */
const traceInput = {
	analysis: z.string().min(1).max(40).optional(),
	question: z.string().min(1).max(2_000).optional(),
	step: z.string().min(1).max(500).optional(),
	parentStep: z.string().min(1).max(40).optional(),
};

/** Ids under which the server stored this call. */
export const AnalysisTraceSchema = z.object({
	analysis: z.string(),
	step: z.string(),
	query: z.string(),
});

/** The find arguments without cross-field checks; Zod 4 cannot derive a partial from a refined object. */
export const AnalysisFindInputBaseSchema = z
	.object({
		source: z.enum(["runs", "tool", "user"]),
		from: z.string().date().optional(),
		to: z.string().date().optional(),
		latest: z.number().int().min(1).max(200).optional(),
		repository: z.string().min(1).optional(),
		agent: z.enum(["claude_code", "codex"]).optional(),
		model: z.string().min(1).optional(),
		sessionId: z.string().min(1).max(200).optional(),
		userId: z.string().min(1).optional(),
		toolGroup: z
			.enum([
				"shell",
				"edit",
				"read",
				"search",
				"browser",
				"web",
				"mcp",
				"subagent",
				"other",
			])
			.optional(),
		commandClass: z.string().min(1).optional(),
		kind: z
			.enum([
				"friction",
				"mistake",
				"validation",
				"environment",
				"noise",
				"other",
			])
			.optional(),
		cause: z.string().min(1).optional(),
		detail: z.string().min(1).optional(),
		includeNoise: z.boolean().default(false),
		reaction: z
			.array(z.enum(["negative", "swear", "apology"]))
			.default(["negative", "swear", "apology"]),
		groupBy: z.enum(["week", "model", "repository", "agent"]).optional(),
		refs: z.array(RunRefSchema).max(200).optional(),
		limit: z.number().int().min(1).max(200).default(50),
		sort: z
			.enum(["startedAt", "minutes", "costUsd", "failedCalls", "rawChars"])
			.default("startedAt"),
		...traceInput,
	})
	.strict();

export const AnalysisFindInputSchema = AnalysisFindInputBaseSchema.superRefine(
	(input, context) => {
		if (input.from && input.to && input.from > input.to) {
			context.addIssue({
				code: "custom",
				path: ["to"],
				message: "to must be on or after from",
			});
		}
		if (input.groupBy && input.source !== "runs") {
			context.addIssue({
				code: "custom",
				path: ["groupBy"],
				message: "groupBy is only valid for runs",
			});
		}
	},
);

/** The read arguments without cross-field checks; Zod 4 cannot derive a partial from a refined object. */
export const AnalysisReadInputBaseSchema = z
	.object({
		refs: z.array(RunRefSchema).min(1).max(10),
		depth: z.enum(["exchange", "turn", "record"]).default("exchange"),
		maxChars: z.number().int().min(1).max(40_000).default(12_000),
		record: z.number().int().min(1).max(4_294_967_294).optional(),
		block: z.number().int().min(0).max(65_535).optional(),
		fromChar: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER - 1)
			.optional(),
		toChar: z
			.number()
			.int()
			.nonnegative()
			.max(Number.MAX_SAFE_INTEGER)
			.optional(),
		...traceInput,
	})
	.strict();

export const AnalysisReadInputSchema = AnalysisReadInputBaseSchema.superRefine(
	(input, context) => {
		if (
			input.depth === "record" &&
			(input.refs.length !== 1 || input.record === undefined)
		) {
			context.addIssue({
				code: "custom",
				path: ["record"],
				message: "record depth requires exactly one ref and a record index",
			});
		}
		if (
			input.depth !== "record" &&
			[input.record, input.block, input.fromChar, input.toChar].some(
				(value) => value !== undefined,
			)
		) {
			context.addIssue({
				code: "custom",
				message: "record slicing is only valid at record depth",
			});
		}
		if (input.toChar !== undefined && input.toChar <= (input.fromChar ?? 0)) {
			context.addIssue({
				code: "custom",
				path: ["toChar"],
				message: "toChar must be greater than fromChar",
			});
		}
	},
);

const ReactionSchema = z.enum(["negative", "swear", "apology"]);
const HeaderSchema = z.object({
	from: z.string(),
	to: z.string(),
	sessionsInScope: z.number(),
	indexedSessions: z.number(),
	runsInScope: z.number(),
	minutes: z.number(),
	pricedCostUsd: z.number(),
	unattributedCostUsd: z.number(),
	unpricedRuns: z.number(),
	rawChars: z.number(),
	truncated: z.boolean(),
	notes: z.array(z.string()),
	classifierVersion: z.number().int(),
	trace: AnalysisTraceSchema.optional(),
});
export const AnalysisRunSchema = z.object({
	ref: RunRefSchema,
	startedAt: z.string(),
	minutes: z.number(),
	costUsd: z.number().nullable(),
	model: z.string(),
	repository: z.string(),
	agent: z.enum(["claude_code", "codex"]),
	promptHead: z.string().max(160),
	edits: z.number(),
	toolCalls: z.number(),
	failedCalls: z.number(),
	readCalls: z.number(),
	searchCalls: z.number(),
	notFound: z.number(),
	nextReaction: ReactionSchema.nullable(),
	rawChars: z.number(),
});
const RunGroupSchema = z.object({
	key: z.string(),
	runs: z.number(),
	sessions: z.number(),
	minutes: z.number(),
	costUsd: z.number().nullable(),
});
const ToolGroupSchema = z.object({
	toolGroup: z.string(),
	cause: z.string(),
	detail: z.string(),
	kind: z.string(),
	count: z.number(),
	sessions: z.number(),
	firstSeen: z.string(),
	lastSeen: z.string(),
	topCommands: z.array(z.string()).max(3),
	minutes: z.number(),
	costUsd: z.number().nullable(),
	examples: z
		.array(
			z.object({
				ref: RunRefSchema,
				record: z.number(),
				errorLine: z.string(),
			}),
		)
		.max(5),
});
export const AnalysisEventSchema = z.object({
	type: ReactionSchema,
	terms: z.array(z.string()),
	eventRef: RunRefSchema.extend({ record: z.number() }),
	quote: z.string().max(200),
	partial: z.boolean(),
	originRef: RunRefSchema.nullable(),
	originMinutes: z.number().nullable(),
	originCostUsd: z.number().nullable(),
});
export const AnalysisFindOutputSchema = z.union([
	z.object({
		source: z.literal("runs"),
		header: HeaderSchema,
		rows: z.array(AnalysisRunSchema),
	}),
	z.object({
		source: z.literal("runs"),
		header: HeaderSchema,
		groups: z.array(RunGroupSchema),
	}),
	z.object({
		source: z.literal("tool"),
		header: HeaderSchema,
		groups: z.array(ToolGroupSchema),
	}),
	z.object({
		source: z.literal("user"),
		header: HeaderSchema,
		events: z.array(AnalysisEventSchema),
		groups: z.array(
			z.object({
				type: ReactionSchema,
				count: z.number(),
				sessions: z.number(),
			}),
		),
	}),
]);
export const AnalysisReadOutputSchema = z.object({
	maxChars: z.number().int().min(1).max(40_000).optional(),
	trace: AnalysisTraceSchema.optional(),
	truncated: z.boolean(),
	reads: z.array(
		z.object({
			ref: RunRefSchema,
			header: z.string(),
			found: z.boolean(),
			truncated: z.boolean(),
			sections: z.array(
				z.object({
					name: z.string(),
					text: z.string(),
					record: z
						.object({
							index: z.number(),
							block: z.number(),
							kind: z.string(),
							tool: z.string(),
							callId: z.string(),
							path: z.string(),
							commandClass: z.string(),
							isError: z.boolean(),
							exitCode: z.number().nullable(),
							cut: z.boolean(),
						})
						.optional(),
				}),
			),
		}),
	),
});

export type RunRef = z.infer<typeof RunRefSchema>;
export type AnalysisTrace = z.infer<typeof AnalysisTraceSchema>;
export type AnalysisFindInput = z.infer<typeof AnalysisFindInputSchema>;
export type AnalysisFindOutput = z.infer<typeof AnalysisFindOutputSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type AnalysisEvent = z.infer<typeof AnalysisEventSchema>;
export type AnalysisReadInput = z.infer<typeof AnalysisReadInputSchema>;
export type AnalysisReadOutput = z.infer<typeof AnalysisReadOutputSchema>;

export const analysisContract = {
	find: oc.input(AnalysisFindInputSchema).output(AnalysisFindOutputSchema),
	read: oc.input(AnalysisReadInputSchema).output(AnalysisReadOutputSchema),
};
