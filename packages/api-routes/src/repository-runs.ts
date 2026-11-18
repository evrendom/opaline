import { oc } from "@orpc/contract";
import { z } from "zod";
import { RepositoryScopedInputSchema } from "./schemas/repositories.js";

export const REPOSITORY_RUNS_LIMIT = 200;
export const REPOSITORY_RUNS_PATH_LIMIT = 64;

const RepositoryRunsOfSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("file"),
			paths: z
				.array(z.string().min(1).max(4096))
				.min(1)
				.max(REPOSITORY_RUNS_PATH_LIMIT),
		})
		.strict(),
	z
		.object({
			kind: z.literal("setup"),
			setupFile: z.string().min(1).max(2000),
		})
		.strict(),
	z
		.object({
			kind: z.literal("mcp"),
			server: z.string().min(1).max(500),
			tool: z.string().min(1).max(500).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.enum(["pull_request", "ci_run"]),
			node: z.string().min(1).max(1000),
		})
		.strict(),
]);

export const RepositoryRunsInputSchema = RepositoryScopedInputSchema.extend({
	of: RepositoryRunsOfSchema,
}).strict();

export const RepositoryRunSchema = z.object({
	sessionId: z.string(),
	agentId: z.string(),
	startRecord: z.number().int().nonnegative(),
	turn: z.number().int().nonnegative(),
	turnId: z.string().nullable(),
	startedAt: z.string(),
	prompt: z.string().nullable(),
	changes: z.number().int().nonnegative(),
	reads: z.number().int().nonnegative(),
	calls: z.number().int().nonnegative(),
	relations: z.array(z.string()),
	costUsd: z.number().nonnegative().nullable().optional(),
	model: z.string().nullable().optional(),
	mergedPullRequests: z.number().int().nonnegative().optional(),
	ciRuns: z.number().int().nonnegative().optional(),
});

const RepositoryRunFigureEntrySchema = z.object({
	id: z.string(),
	value: z.number().nonnegative(),
});

export const RepositoryRunFiguresSchema = z.object({
	sessions: z.number().int().nonnegative(),
	agentRuns: z.number().int().nonnegative(),
	cost: z.number().nonnegative(),
	unpricedRuns: z.number().int().nonnegative(),
	signals: z.number().int().nonnegative(),
	mergedPullRequests: z.number().int().nonnegative(),
	ciRuns: z.number().int().nonnegative(),
	breakdowns: z
		.object({
			models: z.array(RepositoryRunFigureEntrySchema),
			members: z.array(RepositoryRunFigureEntrySchema),
			durations: z.array(RepositoryRunFigureEntrySchema),
			signalTypes: z.array(RepositoryRunFigureEntrySchema),
		})
		.optional(),
});

export const RepositoryRunsSchema = z.object({
	runs: z.array(RepositoryRunSchema).max(REPOSITORY_RUNS_LIMIT),
	truncated: z.boolean(),
	figures: RepositoryRunFiguresSchema.nullable(),
});

export const REPOSITORY_RUN_CALLS_LIMIT = 50;
export const REPOSITORY_RUN_CALL_TEXT_LIMIT = 32_000;

export const RepositoryRunCallsInputSchema = RepositoryScopedInputSchema.extend(
	{
		of: RepositoryRunsOfSchema,
		sessionId: z.string().min(1).max(200),
		agentId: z.string().max(200),
		startRecord: z.number().int().nonnegative(),
	},
).strict();

const CallTextSchema = z.object({
	text: z.string(),
	cut: z.boolean(),
});

export const RepositoryRunCallSchema = z.object({
	callId: z.string(),
	at: z.string(),
	tool: z.string(),
	op: z.string(),
	path: z.string().nullable(),
	created: z.boolean(),
	failed: z.boolean(),
	input: CallTextSchema.nullable(),
	output: CallTextSchema.nullable(),
	loaded: CallTextSchema.nullable(),
	line: z.number().int().positive().nullable(),
	endAt: z.string().nullable().optional(),
});

export const RepositoryRunCallsSchema = z.object({
	calls: z.array(RepositoryRunCallSchema).max(REPOSITORY_RUN_CALLS_LIMIT),
	truncated: z.boolean(),
});

export const repositoryRunsContract = {
	runs: oc.input(RepositoryRunsInputSchema).output(RepositoryRunsSchema),
	runCalls: oc
		.input(RepositoryRunCallsInputSchema)
		.output(RepositoryRunCallsSchema),
};

export type RepositoryRunsOf = z.infer<typeof RepositoryRunsOfSchema>;
export type RepositoryRun = z.infer<typeof RepositoryRunSchema>;
export type RepositoryRuns = z.infer<typeof RepositoryRunsSchema>;
export type RepositoryRunFigures = z.infer<typeof RepositoryRunFiguresSchema>;
export type RepositoryRunCall = z.infer<typeof RepositoryRunCallSchema>;
export type RepositoryRunCalls = z.infer<typeof RepositoryRunCallsSchema>;
