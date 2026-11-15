import type { ErrorMap } from "@orpc/contract";
import { z } from "zod";
import {
	type TranscriptToolActivity,
	TranscriptToolActivitySchema,
} from "../session-transcript/transcript-tool-activity.js";
import { SourceSchema } from "./source.js";

const MAX_SESSION_ID_LENGTH = 512;
const MAX_TURN_CURSOR_LENGTH = 4096;
const MAX_DETAIL_ITEM_ID_LENGTH = 512;
const MAX_DETAIL_STRING_LENGTH = 4096;
const MAX_DETAIL_COLLECTION_LENGTH = 512;
const MAX_TRACE_ITEM_COUNT = 100_000;
const MAX_SESSION_DETAIL_SPINE_TURNS = 100_000;
export const SESSION_DETAIL_BODY_MAX_RAW_BYTES = 1_500_000;
const MAX_TRANSCRIPT_CODE_UNITS = SESSION_DETAIL_BODY_MAX_RAW_BYTES;

export const SESSION_DETAIL_TURN_PAGE_LIMIT = 100;
export const SESSION_DETAIL_WINDOW_INITIAL_TURNS = 200;
export const SESSION_DETAIL_WINDOW_PAGE_TURNS = 200;
export const SESSION_DETAIL_WINDOW_MAX_RAW_BYTES = 3_500_000;
export const SESSION_DETAIL_WINDOW_MAX_TURN_BYTES =
	SESSION_DETAIL_BODY_MAX_RAW_BYTES;
export const SESSION_DETAIL_BODY_CHUNK_CODE_UNITS = 256 * 1024;
export const SESSION_DETAIL_ACTIVITY_POINT_LIMIT = 512;
export const SESSION_DETAIL_ACTIVITY_DETAIL_CODE_POINT_LIMIT = 4_096;
export const SESSION_DETAIL_CONTEXT_ERROR_LIMIT = 64;
export const SESSION_DETAIL_CONTEXT_FILE_LIMIT = 128;
export const SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT = 140;
export const SESSION_DETAIL_SIGNAL_OCCURRENCE_LIMIT = 200;
export const SESSION_DETAIL_STALE_REVISION_CODE = "STALE_REVISION";
export const SESSION_DETAIL_STALE_REVISION_MESSAGE =
	"The session changed while its detail was being loaded.";
export const SESSION_DETAIL_ANCHOR_NOT_FOUND_CODE = "ANCHOR_NOT_FOUND";
export const SESSION_DETAIL_ANCHOR_NOT_FOUND_MESSAGE =
	"The requested turn does not exist in this session revision.";

const MAX_UINT64_DECIMAL = "18446744073709551615";
const DecimalSessionDetailRevisionSchema = z
	.string()
	.regex(/^(?:0|[1-9]\d*)$/u)
	.refine(
		(value) =>
			value.length < MAX_UINT64_DECIMAL.length ||
			(value.length === MAX_UINT64_DECIMAL.length &&
				value <= MAX_UINT64_DECIMAL),
		"Revision must fit in UInt64",
	);

// The deployed API uses ingestion revisions; older API builds use timestamps.
// Preserve either opaque identity exactly when requesting subsequent pages.
export const SessionDetailRevisionSchema = z.union([
	DecimalSessionDetailRevisionSchema,
	z.string().datetime({ offset: true }),
]);
export const SessionDetailWindowCursorSchema = z
	.string()
	.min(1)
	.max(MAX_TURN_CURSOR_LENGTH);
export const SessionDetailTurnIdSchema = z
	.string()
	.min(1)
	.max(MAX_DETAIL_ITEM_ID_LENGTH);

const SessionDetailRevisionInputSchema = z.object({
	revision: SessionDetailRevisionSchema,
	sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
});

export const SessionDetailOverviewInputSchema = z
	.object({
		sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		turnCursor: z.string().max(MAX_TURN_CURSOR_LENGTH).optional(),
		turnLimit: z
			.number()
			.int()
			.positive()
			.max(SESSION_DETAIL_TURN_PAGE_LIMIT)
			.default(SESSION_DETAIL_TURN_PAGE_LIMIT),
	})
	.strict();

const SessionDetailBodyChunksRequestSchema = z.literal(true).optional();

export const SessionDetailRelationshipsInputSchema =
	SessionDetailOverviewInputSchema.pick({ sessionId: true });

export const SessionDetailInitialInputSchema =
	SessionDetailRelationshipsInputSchema.extend({
		bodyChunks: SessionDetailBodyChunksRequestSchema,
	}).strict();

const NativeSessionRelationshipSchema = z.object({
	agentPath: z.string().nullable(),
	model: z.string().nullable(),
	sessionId: z.string(),
});

export const SessionDetailRelationshipsSchema = z.object({
	children: z.array(NativeSessionRelationshipSchema),
	parent: NativeSessionRelationshipSchema.nullable(),
});

export const SessionDetailWindowRequestSchema = z.discriminatedUnion("mode", [
	z
		.object({
			bodyChunks: SessionDetailBodyChunksRequestSchema,
			includeBodies: z.literal(true),
			mode: z.literal("initial"),
			sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		})
		.strict(),
	z
		.object({
			anchorTurnId: SessionDetailTurnIdSchema,
			bodyChunks: SessionDetailBodyChunksRequestSchema,
			includeBodies: z.literal(true),
			mode: z.literal("anchor"),
			revision: SessionDetailRevisionSchema,
			sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		})
		.strict(),
	z
		.object({
			cursor: SessionDetailWindowCursorSchema,
			bodyChunks: SessionDetailBodyChunksRequestSchema,
			includeBodies: z.literal(true),
			mode: z.literal("older"),
			sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		})
		.strict(),
	z
		.object({
			cursor: SessionDetailWindowCursorSchema,
			bodyChunks: SessionDetailBodyChunksRequestSchema,
			includeBodies: z.literal(true),
			mode: z.literal("newer"),
			sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		})
		.strict(),
]);

export const SessionDetailTurnInputSchema =
	SessionDetailRevisionInputSchema.extend({
		turnId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
	}).strict();

export const SessionDetailSpineInputSchema =
	SessionDetailRevisionInputSchema.strict();

export const SessionDetailSubagentInputSchema =
	SessionDetailRevisionInputSchema.extend({
		subagentId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
	}).strict();

export const SessionDetailBodyChunkInputSchema =
	SessionDetailRevisionInputSchema.extend({
		kind: z.enum(["turn", "subagent", "subagentTrace", "fileChanges"]),
		targetId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
		offset: z.number().int().nonnegative().safe().default(0),
	}).strict();

export const SessionDetailBodyChunkSchema =
	SessionDetailBodyChunkInputSchema.extend({
		offset: z.number().int().nonnegative().safe(),
		data: z.string().min(1).max(SESSION_DETAIL_BODY_CHUNK_CODE_UNITS),
		sha256: z.string().regex(/^[a-f0-9]{64}$/u),
		totalCodeUnits: z.number().int().positive().safe(),
	}).strict();

export const SessionDetailBodyChunksSchema = z
	.object({
		sha256: z.string().regex(/^[a-f0-9]{64}$/u),
		totalCodeUnits: z.number().int().positive().safe(),
	})
	.strict();

export type SessionDetailBodyChunks = z.infer<
	typeof SessionDetailBodyChunksSchema
>;
export type SessionDetailBodyChunkInput = z.infer<
	typeof SessionDetailBodyChunkInputSchema
>;
export type SessionDetailBodyChunk = z.infer<
	typeof SessionDetailBodyChunkSchema
>;

export const SessionDetailStaleRevisionDataSchema = z
	.object({
		currentRevision: SessionDetailRevisionSchema,
		requestedRevision: SessionDetailRevisionSchema,
	})
	.strict();

export const SessionDetailAnchorNotFoundDataSchema = z
	.object({
		revision: SessionDetailRevisionSchema,
		turnId: SessionDetailTurnIdSchema,
	})
	.strict();

export const SESSION_DETAIL_REVISION_ERRORS = {
	[SESSION_DETAIL_STALE_REVISION_CODE]: {
		data: SessionDetailStaleRevisionDataSchema,
		message: SESSION_DETAIL_STALE_REVISION_MESSAGE,
		status: 409,
	},
} satisfies ErrorMap;

export const SESSION_DETAIL_WINDOW_ERRORS = {
	...SESSION_DETAIL_REVISION_ERRORS,
	[SESSION_DETAIL_ANCHOR_NOT_FOUND_CODE]: {
		data: SessionDetailAnchorNotFoundDataSchema,
		message: SESSION_DETAIL_ANCHOR_NOT_FOUND_MESSAGE,
		status: 404,
	},
} satisfies ErrorMap;

const SessionDetailTimestampSchema = z.string().datetime({ offset: true });
const SessionDetailNullableTimestampSchema =
	SessionDetailTimestampSchema.nullable();
const SessionDetailNullableCountSchema = z
	.number()
	.int()
	.nonnegative()
	.nullable();
const SessionDetailNullableCostSchema = z.number().nonnegative().nullable();
const SessionDetailStringListSchema = z
	.array(z.string().max(MAX_DETAIL_STRING_LENGTH))
	.max(MAX_DETAIL_COLLECTION_LENGTH);
const SessionDetailPreviewSchema = z
	.string()
	.refine(
		(value) =>
			Array.from(value).length <= SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT,
		`Preview must contain at most ${SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT} Unicode code points`,
	)
	.nullable();

const SessionDetailFileOperationSchema = z.enum(["created", "edited", "read"]);

const SessionDetailTurnFileEventSchema = z
	.object({
		at: SessionDetailTimestampSchema,
		count: z.number().int().positive(),
		eventId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
		operation: SessionDetailFileOperationSchema,
		path: z.string().min(1).max(MAX_DETAIL_STRING_LENGTH).optional(),
	})
	.strict();

const SessionDetailTurnSubagentEventSchema = z
	.object({
		at: SessionDetailTimestampSchema,
		count: z.number().int().positive(),
		eventId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
		subagentId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
	})
	.strict();

const SessionDetailUsageCallSchema = z
	.object({
		at: SessionDetailTimestampSchema,
		cacheCreationInputTokens: z.number().int().nonnegative(),
		cacheReadInputTokens: z.number().int().nonnegative(),
		contextWindow: z.number().int().positive().nullable(),
		freshInputTokens: z.number().int().nonnegative(),
		model: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		outputTokens: z.number().int().nonnegative(),
	})
	.strict();

const SessionDetailSignalOccurrenceSchema = z
	.object({
		category: z.enum(["apology", "negative", "positive"]),
		matchedText: z.string().min(1).max(MAX_DETAIL_STRING_LENGTH),
	})
	.strict();

export const SESSION_TURN_STEP_KINDS = [
	"git",
	"github",
	"mcp",
	"search",
	"shell",
	"verify",
] as const;
export type SessionTurnStepKind = (typeof SESSION_TURN_STEP_KINDS)[number];

export const SESSION_GIT_ACTIONS = ["commit", "merge", "pullRequest"] as const;
export type SessionGitAction = (typeof SESSION_GIT_ACTIONS)[number];

function positiveCountsSchema<const Key extends string>(keys: readonly Key[]) {
	const count = z.number().int().positive().optional();
	return z
		.object(
			Object.fromEntries([...keys].sort().map((key) => [key, count])) as Record<
				Key,
				typeof count
			>,
		)
		.strict();
}

export const SessionDetailTurnSummarySchema = z
	.object({
		activityResolution: z.enum(["exact", "bucketed"]),
		compactions: z.number().int().positive().optional(),
		durationSeconds: z.number().nonnegative().nullable(),
		editedFiles: SessionDetailStringListSchema,
		endedAt: SessionDetailNullableTimestampSchema,
		errorCount: z.number().int().nonnegative(),
		errorEvents: z
			.array(
				z
					.object({
						at: SessionDetailTimestampSchema,
						content: z
							.string()
							.refine(
								(value) =>
									Array.from(value).length <=
									SESSION_DETAIL_ACTIVITY_DETAIL_CODE_POINT_LIMIT,
								`Activity detail must contain at most ${SESSION_DETAIL_ACTIVITY_DETAIL_CODE_POINT_LIMIT} Unicode code points`,
							)
							.optional(),
					})
					.strict(),
			)
			.max(SESSION_DETAIL_ACTIVITY_POINT_LIMIT),
		fileEvents: z
			.array(SessionDetailTurnFileEventSchema)
			.max(SESSION_DETAIL_ACTIVITY_POINT_LIMIT)
			.optional(),
		estimatedCost: SessionDetailNullableCostSchema,
		hasBody: z.boolean(),
		index: z.number().int().nonnegative(),
		inputTokens: SessionDetailNullableCountSchema,
		modelSignalCount: z.number().int().nonnegative(),
		modelApologyCount: z.number().int().nonnegative().optional(),
		outputTokens: SessionDetailNullableCountSchema,
		responsePreview: SessionDetailPreviewSchema,
		signalCount: z.number().int().nonnegative(),
		signalOccurrences: z
			.array(SessionDetailSignalOccurrenceSchema)
			.max(SESSION_DETAIL_SIGNAL_OCCURRENCE_LIMIT),
		signalOccurrencesOmittedCount: z.number().int().nonnegative(),
		signalOccurrencesTruncated: z.boolean(),
		skills: SessionDetailStringListSchema,
		skillCount: z.number().int().nonnegative(),
		skillEvents: z
			.array(
				z
					.object({
						at: SessionDetailTimestampSchema,
						skill: z.string().max(MAX_DETAIL_STRING_LENGTH),
					})
					.strict(),
			)
			.max(SESSION_DETAIL_ACTIVITY_POINT_LIMIT),
		slashCommands: SessionDetailStringListSchema,
		startedAt: SessionDetailNullableTimestampSchema,
		stepKinds: positiveCountsSchema([
			...SESSION_TURN_STEP_KINDS,
			...SESSION_GIT_ACTIONS,
		]).optional(),
		subagentEvents: z
			.array(SessionDetailTurnSubagentEventSchema)
			.max(SESSION_DETAIL_ACTIVITY_POINT_LIMIT)
			.optional(),
		toolCallCount: z.number().int().nonnegative(),
		turnId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
		usageCalls: z
			.array(SessionDetailUsageCallSchema)
			.max(SESSION_DETAIL_ACTIVITY_POINT_LIMIT),
		userCharacterCount: z.number().int().nonnegative().optional(),
		userPreview: SessionDetailPreviewSchema,
	})
	.strict();

const SessionDetailActivityTotalsSchema = z
	.object({
		edit: z.number().int().nonnegative(),
		error: z.number().int().nonnegative(),
		read: z.number().int().nonnegative(),
		signal: z.number().int().nonnegative(),
		signalScanVersion: z.number().int().nonnegative(),
		skill: z.number().int().nonnegative(),
		subagent: z.number().int().nonnegative(),
		write: z.number().int().nonnegative(),
	})
	.strict();

const SessionDetailSessionSummarySchema = z
	.object({
		durationMinutes: z.number().nonnegative().nullable(),
		estimatedCost: SessionDetailNullableCostSchema,
		gitBranch: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		gitSha: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		inputTokens: z.number().int().nonnegative(),
		lastInteractionDate: SessionDetailTimestampSchema,
		modelUsed: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		outputTokens: z.number().int().nonnegative(),
		projectPath: z.string().max(MAX_DETAIL_STRING_LENGTH),
		repository: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		sessionDate: SessionDetailTimestampSchema,
		sessionId: z.string().max(MAX_SESSION_ID_LENGTH),
		skills: SessionDetailStringListSchema,
		slashCommands: SessionDetailStringListSchema,
		source: SourceSchema.nullable(),
		totalTokens: z.number().int().nonnegative(),
		/** Uncompressed UTF-8 size of the session's transcript and its
		 * subagents' transcripts, as uploaded. Absent from older API builds. */
		transcriptBytes: z.number().int().nonnegative().optional(),
		userId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
	})
	.strict();

const SessionDetailContextUseSchema = z
	.object({
		model: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		tokens: z.number().int().nonnegative(),
		window: z.number().int().positive().nullable(),
	})
	.strict();

export type SessionDetailContextUse = z.infer<
	typeof SessionDetailContextUseSchema
>;

const SessionDetailSubagentSummarySchema = z
	.object({
		context: SessionDetailContextUseSchema.nullable().optional(),
		durationSeconds: z.number().nonnegative().nullable().optional(),
		estimatedCost: SessionDetailNullableCostSchema,
		firstInputTokens: SessionDetailNullableCountSchema.optional(),
		gitActions: positiveCountsSchema(SESSION_GIT_ACTIONS).optional(),
		hasTranscript: z.boolean(),
		inputTokens: SessionDetailNullableCountSchema,
		mainThread: SessionDetailContextUseSchema.nullable().optional(),
		model: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
		outputTokens: SessionDetailNullableCountSchema,
		subagentId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
		totalTokens: SessionDetailNullableCountSchema,
	})
	.strict();

const SessionDetailContextSchema = z
	.object({
		errors: z
			.array(
				z
					.object({
						count: z.number().int().positive(),
						label: z.string().min(1).max(MAX_DETAIL_STRING_LENGTH),
					})
					.strict(),
			)
			.max(SESSION_DETAIL_CONTEXT_ERROR_LIMIT),
		files: z
			.array(
				z
					.object({
						operation: SessionDetailFileOperationSchema,
						path: z.string().min(1).max(MAX_DETAIL_STRING_LENGTH),
					})
					.strict(),
			)
			.max(SESSION_DETAIL_CONTEXT_FILE_LIMIT),
	})
	.strict()
	.default({ errors: [], files: [] });

export const SESSION_DETAIL_TURN_SHAPE_POINT_LIMIT = 24;
export const SESSION_DETAIL_TURN_SHAPE_LIMIT = 20_000;

export const SessionDetailTurnShapeSchema = z
	.object({
		apology: z.boolean(),
		endedAt: SessionDetailNullableTimestampSchema,
		errorAt: z
			.array(SessionDetailTimestampSchema)
			.max(SESSION_DETAIL_TURN_SHAPE_POINT_LIMIT),
		errorCount: z.number().int().nonnegative(),
		negative: z.boolean(),
		startedAt: SessionDetailNullableTimestampSchema,
		subagents: z
			.array(
				z
					.object({
						at: SessionDetailTimestampSchema,
						subagentId: z
							.string()
							.min(1)
							.max(MAX_DETAIL_ITEM_ID_LENGTH)
							.optional(),
					})
					.strict(),
			)
			.max(SESSION_DETAIL_TURN_SHAPE_POINT_LIMIT),
		toolCallCount: z.number().int().nonnegative(),
		turnId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
		userCharacterCount: z.number().int().nonnegative(),
	})
	.strict();

export const SessionDetailOverviewSchema = z
	.object({
		activityTotals: SessionDetailActivityTotalsSchema,
		context: SessionDetailContextSchema,
		revision: SessionDetailRevisionSchema,
		session: SessionDetailSessionSummarySchema,
		subagents: z
			.array(SessionDetailSubagentSummarySchema)
			.max(MAX_DETAIL_COLLECTION_LENGTH),
		turnPage: z
			.object({
				items: z
					.array(SessionDetailTurnSummarySchema)
					.max(SESSION_DETAIL_TURN_PAGE_LIMIT),
				nextCursor: z.string().max(MAX_TURN_CURSOR_LENGTH).nullable(),
				total: z.number().int().nonnegative(),
			})
			.strict(),
		turnShapes: z
			.array(SessionDetailTurnShapeSchema)
			.max(SESSION_DETAIL_TURN_SHAPE_LIMIT)
			.optional(),
	})
	.strict();

type SessionDetailJsonValue =
	| boolean
	| null
	| number
	| string
	| readonly SessionDetailJsonValue[]
	| { readonly [key: string]: SessionDetailJsonValue };

type SessionDetailTextContent = {
	rawType?: string;
	text: string;
	type: "text";
};

type SessionDetailResultBlock =
	| SessionDetailTextContent
	| {
			rawType?: string;
			source: SessionDetailJsonValue;
			type: "image";
	  }
	| {
			rawType?: string;
			type: "structured";
			value: SessionDetailJsonValue;
	  };

type SessionDetailTraceToolResult = {
	batch?: { id: string; toolIds: string[] };
	content: string | SessionDetailResultBlock[];
	isError: boolean;
	subagentId?: string;
	timestamp?: string;
};

type SessionDetailToolResultContent = {
	batch?: { id: string; toolIds: string[] };
	content: string | SessionDetailResultBlock[];
	is_error?: boolean;
	tool_use_id: string;
	type: "tool_result";
};

type SessionDetailTraceEvent =
	| {
			id: string;
			kind: "reasoning";
			nativeId?: string;
			provider?: "claude" | "codex";
			text: string;
			timestamp: string;
	  }
	| {
			content: string | SessionDetailTextContent[];
			id: string;
			kind: "message";
			nativeId?: string;
			provider?: "claude" | "codex";
			text: string;
			timestamp: string;
	  }
	| {
			id: string;
			input: Record<string, SessionDetailJsonValue>;
			kind: "tool";
			nativeId?: string;
			activity?: TranscriptToolActivity;
			provider?: "claude" | "codex";
			result?: SessionDetailTraceToolResult;
			skillContent?: { baseDirectory: string; content: string };
			toolSearch?: { deferredTools: number };
			background?: {
				taskId: string;
				timedOut: boolean;
				status: string | null;
				exitCode: number | null;
				summary: string | null;
				result: string | null;
				finishedAt: string | null;
			};
			timestamp: string;
			toolName: string;
	  }
	| {
			id: string;
			kind: "orphan-result";
			result: SessionDetailTraceToolResult;
			timestamp: string;
	  };

export type SessionDetailTraceItem =
	| {
			content:
				| string
				| (
						| string
						| SessionDetailTextContent
						| {
								rawType?: string;
								source: SessionDetailJsonValue;
								type: "image";
						  }
						| SessionDetailToolResultContent
				  )[];
			id: string;
			kind: "user";
			timestamp: string;
	  }
	| {
			agentName?: string;
			events: SessionDetailTraceEvent[];
			executionMode: "default" | "plan" | "unknown";
			id: string;
			kind: "agent";
			modelSetting?: string;
			provider?: "claude" | "codex";
			timestamp: string;
	  }
	| {
			id: string;
			kind: "system";
			systemType:
				| "compaction"
				| "context"
				| "hooks"
				| "interruption"
				| "member"
				| "notification"
				| "system";
			durationMs?: number;
			compaction?: {
				afterTokens?: number;
				beforeTokens?: number;
				keptMessages?: number;
				loadedTools?: string[];
				summary?: string;
				trigger?: string;
			};
			text: string;
			timestamp: string;
	  }
	| {
			id: string;
			kind: "summary";
			text: string;
			timestamp?: undefined;
	  };

const SessionDetailJsonValueSchema: z.ZodType<SessionDetailJsonValue> = z.lazy(
	() =>
		z.union([
			z.boolean(),
			z.null(),
			z.number(),
			z.string(),
			z.array(SessionDetailJsonValueSchema),
			z.record(z.string(), SessionDetailJsonValueSchema),
		]),
);

const SessionDetailTextContentSchema = z
	.object({
		rawType: z.string().optional(),
		text: z.string(),
		type: z.literal("text"),
	})
	.strict();

const SessionDetailImageContentSchema = z
	.object({
		rawType: z.string().optional(),
		source: SessionDetailJsonValueSchema,
		type: z.literal("image"),
	})
	.strict();

const SessionDetailStructuredContentSchema = z
	.object({
		rawType: z.string().optional(),
		type: z.literal("structured"),
		value: SessionDetailJsonValueSchema,
	})
	.strict();

const SessionDetailProviderSchema = z.enum(["claude", "codex"]);

const SessionDetailTraceToolResultSchema = z
	.object({
		content: z.union([
			z.string(),
			z.array(
				z.discriminatedUnion("type", [
					SessionDetailTextContentSchema,
					SessionDetailImageContentSchema,
					SessionDetailStructuredContentSchema,
				]),
			),
		]),
		isError: z.boolean(),
		batch: z
			.object({ id: z.string(), toolIds: z.array(z.string()) })
			.strict()
			.optional(),
		subagentId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
		timestamp: SessionDetailTimestampSchema.optional(),
	})
	.strict();

const SessionDetailToolResultContentSchema = z
	.object({
		content: z.union([
			z.string(),
			z.array(
				z.discriminatedUnion("type", [
					SessionDetailTextContentSchema,
					SessionDetailImageContentSchema,
					SessionDetailStructuredContentSchema,
				]),
			),
		]),
		is_error: z.boolean().optional(),
		batch: z
			.object({ id: z.string(), toolIds: z.array(z.string()) })
			.strict()
			.optional(),
		tool_use_id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
		type: z.literal("tool_result"),
	})
	.strict();

const SessionDetailUserContentSchema = z.union([
	z.string(),
	z.array(
		z.union([
			z.string(),
			SessionDetailTextContentSchema,
			SessionDetailImageContentSchema,
			SessionDetailToolResultContentSchema,
		]),
	),
]);

const SessionDetailTraceEventSchema = z.discriminatedUnion("kind", [
	z
		.object({
			id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
			kind: z.literal("reasoning"),
			nativeId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
			provider: SessionDetailProviderSchema.optional(),
			text: z.string(),
			timestamp: SessionDetailTimestampSchema,
		})
		.strict(),
	z
		.object({
			content: z.union([z.string(), z.array(SessionDetailTextContentSchema)]),
			id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
			kind: z.literal("message"),
			nativeId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
			provider: SessionDetailProviderSchema.optional(),
			text: z.string(),
			timestamp: SessionDetailTimestampSchema,
		})
		.strict(),
	z
		.object({
			id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
			input: z.record(z.string(), SessionDetailJsonValueSchema),
			kind: z.literal("tool"),
			activity: TranscriptToolActivitySchema.optional(),
			nativeId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH).optional(),
			provider: SessionDetailProviderSchema.optional(),
			result: SessionDetailTraceToolResultSchema.optional(),
			skillContent: z
				.object({
					baseDirectory: z.string(),
					content: z.string(),
				})
				.strict()
				.optional(),
			toolSearch: z
				.object({ deferredTools: z.number().int().nonnegative() })
				.strict()
				.optional(),
			background: z
				.object({
					taskId: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
					timedOut: z.boolean(),
					status: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH).nullable(),
					exitCode: z.number().int().nullable(),
					summary: z.string().max(MAX_DETAIL_STRING_LENGTH).nullable(),
					result: z.string().nullable(),
					finishedAt: SessionDetailTimestampSchema.nullable(),
				})
				.strict()
				.optional(),
			timestamp: SessionDetailTimestampSchema,
			toolName: z.string().max(MAX_DETAIL_STRING_LENGTH),
		})
		.strict(),
	z
		.object({
			id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
			kind: z.literal("orphan-result"),
			result: SessionDetailTraceToolResultSchema,
			timestamp: SessionDetailTimestampSchema,
		})
		.strict(),
]);

export const SessionDetailTraceItemSchema: z.ZodType<SessionDetailTraceItem> =
	z.discriminatedUnion("kind", [
		z
			.object({
				content: SessionDetailUserContentSchema,
				id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
				kind: z.literal("user"),
				timestamp: SessionDetailTimestampSchema,
			})
			.strict(),
		z
			.object({
				agentName: z.string().max(MAX_DETAIL_STRING_LENGTH).optional(),
				events: z
					.array(SessionDetailTraceEventSchema)
					.max(MAX_TRACE_ITEM_COUNT),
				executionMode: z.enum(["plan", "default", "unknown"]),
				id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
				kind: z.literal("agent"),
				modelSetting: z.string().max(MAX_DETAIL_STRING_LENGTH).optional(),
				provider: SessionDetailProviderSchema.optional(),
				timestamp: SessionDetailTimestampSchema,
			})
			.strict(),
		z
			.object({
				id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
				kind: z.literal("system"),
				systemType: z.enum([
					"compaction",
					"context",
					"hooks",
					"interruption",
					"member",
					"notification",
					"system",
				]),
				text: z.string(),
				timestamp: SessionDetailTimestampSchema,
				durationMs: z.number().int().nonnegative().optional(),
				compaction: z
					.object({
						afterTokens: z.number().int().nonnegative().optional(),
						beforeTokens: z.number().int().nonnegative().optional(),
						keptMessages: z.number().int().nonnegative().optional(),
						loadedTools: z
							.array(z.string().max(MAX_DETAIL_STRING_LENGTH))
							.optional(),
						summary: z.string().optional(),
						trigger: z.string().max(MAX_DETAIL_STRING_LENGTH).optional(),
					})
					.strict()
					.optional(),
			})
			.strict(),
		z
			.object({
				id: z.string().max(MAX_DETAIL_ITEM_ID_LENGTH),
				kind: z.literal("summary"),
				text: z.string(),
				timestamp: z.undefined().optional(),
			})
			.strict(),
	]);

export const SessionDetailTurnSchema = z
	.object({
		responseItems: z
			.array(SessionDetailTraceItemSchema)
			.max(MAX_TRACE_ITEM_COUNT),
		revision: SessionDetailRevisionSchema,
		turnId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
		userItems: z.array(SessionDetailTraceItemSchema).max(MAX_TRACE_ITEM_COUNT),
	})
	.strict();

export const SessionDetailTurnBodySchema = z
	.object({
		responseItems: z
			.array(SessionDetailTraceItemSchema)
			.max(MAX_TRACE_ITEM_COUNT),
		userItems: z.array(SessionDetailTraceItemSchema).max(MAX_TRACE_ITEM_COUNT),
	})
	.strict();

export const SessionDetailWindowTurnSchema =
	SessionDetailTurnSummarySchema.extend({
		body: SessionDetailTurnBodySchema.nullable(),
		bodyChunks: SessionDetailBodyChunksSchema.optional(),
		bodyOmitted: z.enum(["oversized"]).nullable(),
	}).strict();

export const SessionDetailWindowSchema = z
	.object({
		newerCursor: SessionDetailWindowCursorSchema.nullable(),
		olderCursor: SessionDetailWindowCursorSchema.nullable(),
		revision: SessionDetailRevisionSchema,
		total: z.number().int().nonnegative(),
		turns: z
			.array(SessionDetailWindowTurnSchema)
			.max(SESSION_DETAIL_WINDOW_PAGE_TURNS),
	})
	.strict();

export const SessionDetailSpineTurnSchema = z
	.object({
		eventCount: z.number().int().nonnegative(),
		responseBytes: z.number().int().nonnegative(),
		turnId: SessionDetailTurnIdSchema,
	})
	.strict();

export const SessionDetailSpineSchema = z
	.object({
		revision: SessionDetailRevisionSchema,
		turns: z
			.array(SessionDetailSpineTurnSchema)
			.max(MAX_SESSION_DETAIL_SPINE_TURNS),
	})
	.strict();

export const SessionDetailInitialSchema = z
	.object({
		overview: SessionDetailOverviewSchema,
		spine: SessionDetailSpineSchema.nullable(),
		window: SessionDetailWindowSchema,
	})
	.strict()
	.refine(
		(value) =>
			value.overview.revision === value.window.revision &&
			(value.spine === null ||
				value.spine.revision === value.overview.revision),
		"Initial session detail must use one revision",
	);

export type SessionDetailInitial = z.infer<typeof SessionDetailInitialSchema>;
export type SessionDetailRelationships = z.infer<
	typeof SessionDetailRelationshipsSchema
>;

export const SessionDetailSubagentSchema = z
	.object({
		content: z.string().max(MAX_TRANSCRIPT_CODE_UNITS),
		revision: SessionDetailRevisionSchema,
		subagentId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
	})
	.strict();

export const SessionDetailSubagentTraceSchema = z
	.object({
		items: z.array(SessionDetailTraceItemSchema).max(MAX_TRACE_ITEM_COUNT),
		revision: SessionDetailRevisionSchema,
		subagentId: z.string().min(1).max(MAX_DETAIL_ITEM_ID_LENGTH),
	})
	.strict();

export type SessionDetailSubagentTrace = z.infer<
	typeof SessionDetailSubagentTraceSchema
>;

export const SessionDetailChunkedSubagentSchema =
	SessionDetailSubagentSchema.extend({ content: z.string() });

export type SessionDetailOverviewInput = z.infer<
	typeof SessionDetailOverviewInputSchema
>;
export type SessionDetailSpineInput = z.infer<
	typeof SessionDetailSpineInputSchema
>;
export type SessionDetailSpine = z.infer<typeof SessionDetailSpineSchema>;
export type SessionDetailSpineTurn = z.infer<
	typeof SessionDetailSpineTurnSchema
>;
export type SessionDetailWindowRequest = z.infer<
	typeof SessionDetailWindowRequestSchema
>;
export type SessionDetailWindow = z.infer<typeof SessionDetailWindowSchema>;
export type SessionDetailTurnShape = z.infer<
	typeof SessionDetailTurnShapeSchema
>;
export type SessionDetailTurnSummary = z.infer<
	typeof SessionDetailTurnSummarySchema
>;
export type SessionDetailWindowTurn = z.infer<
	typeof SessionDetailWindowTurnSchema
>;
export type SessionDetailTurnBody = z.infer<typeof SessionDetailTurnBodySchema>;
export type SessionDetailAnchorNotFoundData = z.infer<
	typeof SessionDetailAnchorNotFoundDataSchema
>;
export type SessionDetailTurnInput = z.infer<
	typeof SessionDetailTurnInputSchema
>;
export type SessionDetailSubagentInput = z.infer<
	typeof SessionDetailSubagentInputSchema
>;
export type SessionDetailStaleRevisionData = z.infer<
	typeof SessionDetailStaleRevisionDataSchema
>;
export type SessionDetailOverview = z.infer<typeof SessionDetailOverviewSchema>;
export type SessionDetailTurn = z.infer<typeof SessionDetailTurnSchema>;
export type SessionDetailSubagent = z.infer<typeof SessionDetailSubagentSchema>;
