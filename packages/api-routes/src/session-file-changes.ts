import { oc } from "@orpc/contract";
import { z } from "zod";
import { SESSION_DETAIL_REVISION_ERRORS } from "./schemas/session-detail-payload.js";

export const SessionFileChangesInputSchema = z
	.object({ sessionId: z.string().min(1).max(200) })
	.strict();

export const SESSION_FILE_TEXT_LIMIT = 400_000;
export const SESSION_FILE_CHANGES_TEXT_BUDGET = 8_000_000;

export const SessionFileChangeSchema = z.object({
	eventId: z.string(),
	turnId: z.string().nullable(),
	agentId: z.string(),
	at: z.string(),
	tool: z.enum(["write", "edit", "patch"]),
	operation: z.enum(["created", "edited", "deleted"]),
	before: z.string(),
	after: z.string(),
	line: z.number().int().positive().nullable(),
	failed: z.boolean(),
	cut: z.boolean(),
});

export const SessionFileSchema = z.object({
	path: z.string(),
	movedTo: z.string().nullable(),
	changes: z.array(SessionFileChangeSchema),
	reads: z.number().int().nonnegative(),
	readTurns: z.array(z.string()),
	readBy: z.array(z.object({ turnId: z.string(), agentId: z.string() })),
	content: z.string().nullable(),
	contentCut: z.boolean(),
});

export const SessionRunReadRangeSchema = z.object({
	path: z.string(),
	from: z.number().int().positive(),
	to: z.number().int().positive().nullable(),
});

export const SessionRunCheckSchema = z.enum([
	"build",
	"lint",
	"test",
	"typecheck",
]);

export const SessionRunStepKindSchema = z.enum([
	"read",
	"search",
	"edit",
	"check",
	"git",
	"github",
	"shell",
	"tool",
	"subagent",
]);

export const SESSION_RUN_STEP_LABEL_LIMIT = 200;

export const SESSION_RUN_SEEN_LIMIT = 100_000;

export const SessionRunSeenSchema = z.object({
	text: z.string(),
	line: z.number().int().positive(),
	cut: z.boolean(),
});

export const SessionRunStepSchema = z.object({
	eventId: z.string(),
	at: z.string(),
	agentId: z.string(),
	kind: SessionRunStepKindSchema,
	check: SessionRunCheckSchema.nullable(),
	verb: z.string(),
	label: z.string().nullable(),
	paths: z.array(z.string()),
	directory: z.string().optional(),
	ranges: z.array(SessionRunReadRangeSchema).optional(),
	tool: z.string().optional(),
	failed: z.boolean(),
	launched: z.string().nullable(),
	seen: SessionRunSeenSchema.nullable().optional(),
});

export const SessionFileChangesSchema = z.object({
	files: z.array(SessionFileSchema),
	runs: z.array(
		z.object({ turnId: z.string(), steps: z.array(SessionRunStepSchema) }),
	),
});

export const sessionFileChangesContract = {
	fileChanges: oc
		.input(SessionFileChangesInputSchema)
		.output(SessionFileChangesSchema)
		.errors(SESSION_DETAIL_REVISION_ERRORS),
};

export type SessionFileChange = z.infer<typeof SessionFileChangeSchema>;
export type SessionFile = z.infer<typeof SessionFileSchema>;
export type SessionFileChanges = z.infer<typeof SessionFileChangesSchema>;
export type SessionRunStep = z.infer<typeof SessionRunStepSchema>;
export type SessionRunStepKind = z.infer<typeof SessionRunStepKindSchema>;
export type SessionRunCheck = z.infer<typeof SessionRunCheckSchema>;
export type SessionRunSeen = z.infer<typeof SessionRunSeenSchema>;
export type SessionRunReadRange = z.infer<typeof SessionRunReadRangeSchema>;
