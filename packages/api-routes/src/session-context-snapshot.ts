import { oc } from "@orpc/contract";
import { z } from "zod";
import type {
	ContextMap,
	ContextPart,
} from "./session-context/session-reader-context-map.js";
import { LANES } from "./session-context/session-reader-step-lanes.js";
import { SessionSummaryLinksInputSchema } from "./session-summary-links.js";

const CONTEXT_KINDS: [ContextPart["kind"], ...ContextPart["kind"][]] = [
	"context",
	"earlier",
	"summary",
	"you",
	...LANES.map((lane) => lane.key),
];

export const ContextKindSchema = z.enum(CONTEXT_KINDS);

const tokens = z.number().nonnegative();

const ContextItemSchema = z.object({
	count: z.number(),
	label: z.string(),
	tokens,
});

const RunPartSchema = z.object({
	key: z.string(),
	kind: ContextKindSchema,
	label: z.string(),
	things: z.array(
		z.object({ label: z.string(), steps: z.array(z.string()), tokens }),
	),
	tokens,
});

export const ContextPartSchema: z.ZodType<ContextPart> = z.lazy(() =>
	z.object({
		count: z.number(),
		key: z.string(),
		kind: ContextKindSchema,
		label: z.string(),
		tokens,
		files: z.number().optional(),
		parts: z.number().optional(),
		folded: z.array(z.string()).optional(),
		items: z.array(ContextItemSchema).optional(),
		nested: z.array(RunPartSchema).optional(),
		run: z
			.object({ model: z.string().nullable(), subagent: z.boolean() })
			.optional(),
		note: z.string().optional(),
		compacted: z.array(ContextPartSchema).optional(),
		before: z.string().optional(),
	}),
);

export const ContextMapSchema: z.ZodType<ContextMap> = z.object({
	compacted: z.boolean(),
	estimate: z.object({ scale: z.number(), text: z.number() }),
	model: z.string().nullable(),
	parts: z.array(ContextPartSchema),
	trail: z.array(
		z.object({
			end: z.number(),
			id: z.string().optional(),
			items: z.array(z.string()),
			key: z.string(),
			start: z.number(),
			tokens: z.number(),
			waited: z.number(),
			written: z.number(),
		}),
	),
	until: z.number().nullable(),
	used: z.number(),
	window: z.number(),
});

export const SessionContextViewSchema = z.object({
	compactedRuns: z.array(z.string()),
	compacting: z.array(z.string()),
	later: z.number().int().nonnegative(),
	map: ContextMapSchema,
	segmentCost: z.number(),
	withCompaction: z.boolean().nullable(),
});

export const SessionContextSnapshotSchema = z.object({
	sessionCost: z.number().nullable(),
	views: z.array(SessionContextViewSchema).min(1).max(2),
});

export const sessionContextSnapshotContract = {
	contextSnapshot: oc
		.input(SessionSummaryLinksInputSchema)
		.output(SessionContextSnapshotSchema.nullable()),
};

export type {
	SessionContextSnapshot,
	SessionContextView,
} from "./session-context/session-context-snapshot.js";
