import { oc } from "@orpc/contract";
import { z } from "zod";
import { RepositoryRangedInputSchema } from "./schemas/repositories.js";
import { ContextKindSchema } from "./session-context-snapshot.js";

export const REPOSITORY_SESSION_BOXES_LIMIT = 500;

export const SESSION_STEP_KINDS = [
	"model",
	"search",
	"read",
	"edit",
	"skill",
	"verify",
	"shell",
	"git",
	"tools",
	"agent",
] as const;

export type SessionStepKind = (typeof SESSION_STEP_KINDS)[number];

const count = z.number().int().nonnegative();

export const SessionBoxContextSchema = z.object({
	used: count,
	window: count,
	parts: z.array(
		z.object({
			key: z.string(),
			kind: ContextKindSchema,
			label: z.string(),
			tokens: count,
		}),
	),
});

export const RepositorySessionBoxSchema = z.object({
	sessionId: z.string(),
	userId: z.string(),
	startedAt: z.string(),
	model: z.string().nullable(),
	cost: z.number().nonnegative(),
	unpricedRuns: count,
	agentRuns: count,
	signals: count,
	mergedPullRequests: count,
	ciRuns: count,
	context: SessionBoxContextSchema.nullable(),
	steps: z.object(
		Object.fromEntries(SESSION_STEP_KINDS.map((kind) => [kind, count])) as {
			[K in SessionStepKind]: typeof count;
		},
	),
});

export const RepositorySessionBoxesSchema = z.object({
	sessions: z
		.array(RepositorySessionBoxSchema)
		.max(REPOSITORY_SESSION_BOXES_LIMIT),
	truncated: z.boolean(),
});

export const repositorySessionBoxesContract = {
	sessionBoxes: oc
		.input(RepositoryRangedInputSchema)
		.output(RepositorySessionBoxesSchema),
};

export type SessionBoxContext = z.infer<typeof SessionBoxContextSchema>;
export type RepositorySessionBox = z.infer<typeof RepositorySessionBoxSchema>;
export type RepositorySessionBoxes = z.infer<
	typeof RepositorySessionBoxesSchema
>;
