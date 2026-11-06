import { oc } from "@orpc/contract";
import { z } from "zod";
import { AnalysisSqlOutputSchema } from "./analysis.js";
import {
	AnalysisPeekOutputSchema,
	AnalysisSliceOutputSchema,
} from "./analysis-peek.js";

export const MEASURE_STATUSES = ["approved", "proposed"] as const;
export const MEASURE_KINDS = ["aggregate", "query"] as const;

const traceInput = {
	analysis: z.string().min(1).max(40).optional(),
};

const measureName = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z][a-z0-9_]*$/);

export const MeasureScopeSchema = z.object({
	from: z.string().date().optional(),
	to: z.string().date().optional(),
	repository: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.regex(/^[A-Za-z0-9._/:@~+-]+$/)
		.optional(),
	latest: z.number().int().min(1).max(500).optional(),
	sessions: z
		.array(
			z
				.string()
				.trim()
				.min(1)
				.max(200)
				.regex(/^[A-Za-z0-9._:-]+$/),
		)
		.min(1)
		.max(200)
		.optional(),
});

export const MeasureSummarySchema = z.object({
	name: z.string(),
	title: z.string(),
	description: z.string(),
	status: z.enum(MEASURE_STATUSES),
	isDrifted: z.boolean(),
	unit: z.string(),
	kind: z.enum(MEASURE_KINDS),
	parameters: z.array(z.string()),
});

export const MeasuresListOutputSchema = z.object({
	measures: z.array(MeasureSummarySchema),
});

export const MeasuresDescribeInputSchema = z
	.object({ name: measureName })
	.strict();

export const MeasuresDescribeOutputSchema = MeasureSummarySchema.extend({
	definition: z.string(),
	sql: z.string(),
	traps: z.array(z.string()),
	columns: z.array(z.object({ name: z.string(), meaning: z.string() })),
	hash: z.string(),
});

export const MeasureDrillSchema = z
	.record(
		z
			.string()
			.min(1)
			.max(40)
			.regex(/^[a-z_]+$/),
		z.union([z.string().min(1).max(2_000), z.number().finite()]),
	)
	.refine((drill) => Object.keys(drill).length > 0, {
		message: "drill names one row of the measure's result by its key columns",
	});

export const MeasuresRunInputSchema = MeasureScopeSchema.extend({
	name: measureName,
	limit: z.number().int().min(1).max(200).default(50),
	drill: MeasureDrillSchema.optional(),
	...traceInput,
}).strict();

export const PATTERN_KINDS = [
	"failing_call",
	"retry_loop",
	"wrong_route",
	"correction",
	"incomplete",
	"theme",
] as const;

export const PatternIdSchema = z
	.string()
	.trim()
	.regex(/^[a-z]{2}_[0-9a-f]{10}$/, {
		message: "a pattern id from patterns action=list, e.g. fc_1a2b3c4d5e",
	});

const patternScope = {
	kind: z.enum(PATTERN_KINDS).optional(),
	minCount: z.number().int().min(1).max(10_000).default(2),
	...traceInput,
};

export const PatternsListInputSchema = MeasureScopeSchema.extend({
	...patternScope,
	limit: z.number().int().min(1).max(100).default(20),
}).strict();

export const PatternsDrillInputSchema = MeasureScopeSchema.extend({
	id: PatternIdSchema,
	limit: z.number().int().min(1).max(200).default(50),
	...traceInput,
}).strict();

export const PatternsVerifyInputSchema = MeasureScopeSchema.extend({
	...patternScope,
	id: PatternIdSchema.optional(),
	since: z.string().date().optional(),
	limit: z.number().int().min(1).max(50).default(10),
}).strict();

export const PatternsPeekInputSchema = PatternsListInputSchema.extend({
	id: PatternIdSchema.optional(),
	limit: z.number().int().min(1).max(200).default(20),
}).strict();

export const PatternsDigestInputSchema = MeasureScopeSchema.strict();

export const DigestRowSchema = z.object({
	metric: z.string(),
	value: z.string(),
	definition: z.string(),
	sessions: z.array(z.string()),
	example: z.string().optional(),
});

export const DigestSectionSchema = z.object({
	id: z.string(),
	title: z.string(),
	rows: z.array(DigestRowSchema),
	missing: z.array(z.string()),
});

const DigestShareSchema = z.object({
	explained: z.number(),
	total: z.number(),
});

export const PatternsDigestOutputSchema = z.object({
	text: z.string(),
	ms: z.number(),
	from: z.string(),
	to: z.string(),
	digest: z.object({
		scope: z.object({
			repository: z.string().nullable(),
			from: z.string(),
			to: z.string(),
			latest: z.number().nullable(),
			listed: z.number().nullable(),
		}),
		sessions: z.number(),
		bySource: z.record(z.string(), z.number()),
		notRecorded: z.record(z.string(), z.array(z.string())),
		coverage: z.object({
			frustrated: DigestShareSchema,
			failed: DigestShareSchema,
			active: DigestShareSchema,
		}),
		sections: z.array(DigestSectionSchema),
	}),
});

export const CHECK_TARGETS = ["run", "session"] as const;

const checkWhere = z
	.string()
	.trim()
	.min(1)
	.max(4_000)
	.refine((where) => !where.includes(";"), {
		message: "where is one condition, without ;",
	});

export const CheckDefinitionSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("runs"),
			where: checkWhere,
			target: z.enum(CHECK_TARGETS).default("run"),
		})
		.strict(),
	z
		.object({
			kind: z.literal("measure"),
			measure: measureName,
			column: z
				.string()
				.trim()
				.min(1)
				.max(60)
				.regex(/^[a-z_][a-z0-9_]*$/),
			min: z.number().finite(),
			repository: MeasureScopeSchema.shape.repository,
		})
		.strict(),
]);

export const CheckSchema = z.object({
	id: z.string(),
	name: z.string(),
	definition: CheckDefinitionSchema,
	enabled: z.boolean(),
	createdAt: z.string(),
});

export const ChecksTestInputSchema = z
	.object({
		definition: CheckDefinitionSchema,
		last: z.number().int().min(1).max(5_000).default(500),
		...traceInput,
	})
	.strict();

export const ChecksCreateInputSchema = z
	.object({
		name: z.string().trim().min(1).max(120),
		definition: CheckDefinitionSchema,
	})
	.strict();

export const ChecksRunInputSchema = z
	.object({
		id: z.string().trim().min(1).max(40),
		from: z.string().date().optional(),
		to: z.string().date().optional(),
		...traceInput,
	})
	.strict();

export const ChecksListOutputSchema = z.object({
	checks: z.array(CheckSchema),
});

export const ChecksResultSchema = z.object({
	check: z.object({ name: z.string(), definition: CheckDefinitionSchema }),
	over: z.string(),
	matches: z.number().int().nonnegative().nullable(),
	result: AnalysisSqlOutputSchema,
});

export const ChecksCreateOutputSchema = z.object({
	check: CheckSchema,
	notices: z.array(z.string()),
});

export type MeasureScope = z.infer<typeof MeasureScopeSchema>;
export type MeasureSummary = z.infer<typeof MeasureSummarySchema>;
export type MeasuresListOutput = z.infer<typeof MeasuresListOutputSchema>;
export type MeasuresDescribeOutput = z.infer<
	typeof MeasuresDescribeOutputSchema
>;
export type MeasuresRunInput = z.infer<typeof MeasuresRunInputSchema>;
export type PatternKind = (typeof PATTERN_KINDS)[number];
export type PatternsListInput = z.infer<typeof PatternsListInputSchema>;
export type PatternsDrillInput = z.infer<typeof PatternsDrillInputSchema>;
export type PatternsVerifyInput = z.infer<typeof PatternsVerifyInputSchema>;
export type PatternsPeekInput = z.infer<typeof PatternsPeekInputSchema>;
export type PatternsDigestInput = z.infer<typeof PatternsDigestInputSchema>;
export type PatternsDigestOutput = z.infer<typeof PatternsDigestOutputSchema>;
export type CheckDefinition = z.infer<typeof CheckDefinitionSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type ChecksResult = z.infer<typeof ChecksResultSchema>;
export type ChecksCreateOutput = z.infer<typeof ChecksCreateOutputSchema>;
export type ChecksListOutput = z.infer<typeof ChecksListOutputSchema>;
export type ChecksTestInput = z.infer<typeof ChecksTestInputSchema>;
export type ChecksRunInput = z.infer<typeof ChecksRunInputSchema>;

export const analysisMeasuresContract = {
	measures: {
		list: oc.output(MeasuresListOutputSchema),
		describe: oc
			.input(MeasuresDescribeInputSchema)
			.output(MeasuresDescribeOutputSchema),
		run: oc.input(MeasuresRunInputSchema).output(AnalysisSqlOutputSchema),
		peek: oc.input(MeasuresRunInputSchema).output(AnalysisPeekOutputSchema),
		slice: oc.input(MeasuresRunInputSchema).output(AnalysisSliceOutputSchema),
	},
	patterns: {
		list: oc.input(PatternsListInputSchema).output(AnalysisSqlOutputSchema),
		drill: oc.input(PatternsDrillInputSchema).output(AnalysisSqlOutputSchema),
		verify: oc.input(PatternsVerifyInputSchema).output(AnalysisSqlOutputSchema),
		peek: oc.input(PatternsPeekInputSchema).output(AnalysisPeekOutputSchema),
		digest: oc
			.input(PatternsDigestInputSchema)
			.output(PatternsDigestOutputSchema),
	},
	checks: {
		test: oc.input(ChecksTestInputSchema).output(ChecksResultSchema),
		create: oc.input(ChecksCreateInputSchema).output(ChecksCreateOutputSchema),
		list: oc.output(ChecksListOutputSchema),
		run: oc.input(ChecksRunInputSchema).output(ChecksResultSchema),
	},
};
