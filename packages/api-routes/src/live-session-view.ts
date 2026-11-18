import { z } from "zod";
import {
	LiveSessionAgentIdSchema,
	LiveSessionSourceSchema,
} from "./live-session.js";

// The web app's read side of live sessions (`analytics.sessions.liveList` and
// `liveTail`). Not part of the CLI protocol in `live-session.ts`.

/** Live sessions listed: active in the last 24 hours, newest first. */
export const LIVE_SESSION_LIST_MAX_SESSIONS = 50;
/** Lines of the main transcript a tail without a cursor returns. */
export const LIVE_SESSION_TAIL_MAIN_LINES = 400;
/** Lines of each subagent transcript a tail without a cursor returns. */
export const LIVE_SESSION_TAIL_SUBAGENT_LINES = 100;
/** Total line bytes one tail response returns; the client continues from `nextLine`. */
export const LIVE_SESSION_TAIL_MAX_BYTES = 3 * 1024 * 1024;
/** Streams one tail response describes: the main transcript and subagents by id. */
export const LIVE_SESSION_TAIL_MAX_STREAMS = 1_024;

/** A live session counts as running while its last update is this recent. */
export const LIVE_SESSION_ACTIVE_WINDOW_MS = 5 * 60_000;

export const LiveSessionSummarySchema = z.object({
	sessionId: z.string(),
	userId: z.string(),
	source: LiveSessionSourceSchema,
	projectPath: z.string(),
	gitRemote: z.string().nullable(),
	gitBranch: z.string().nullable(),
	startedAt: z.string(),
	lastActivityAt: z.string(),
	endedAt: z.string().nullable(),
	/** Subagents written to recently, when the source knows them. */
	agents: z
		.array(z.object({ agentId: z.string(), lastActivityAt: z.string() }))
		.optional(),
});

export const LiveSessionListOutputSchema = z.object({
	sessions: z.array(LiveSessionSummarySchema),
});

export const LiveSessionTailCursorSchema = z.object({
	agentId: LiveSessionAgentIdSchema,
	generation: z.number().int().min(0),
	nextLine: z.number().int().min(0),
});

export const LiveSessionTailInputSchema = z.object({
	sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
	/** Without it, the most recently active live session with this id. */
	source: LiveSessionSourceSchema.optional(),
	cursor: z
		.array(LiveSessionTailCursorSchema)
		.max(LIVE_SESSION_TAIL_MAX_STREAMS)
		.optional(),
	/** The session and where each stream stands, without any lines. */
	summaryOnly: z.boolean().optional(),
});

export const LiveSessionTailStreamSchema = z.object({
	agentId: LiveSessionAgentIdSchema,
	generation: z.number().int().min(0),
	/** Line number of `lines[0]` (or of the next line when `lines` is empty). */
	firstLine: z.number().int().min(0),
	/** Line number to continue from: `firstLine + lines.length`. */
	nextLine: z.number().int().min(0),
	lines: z.array(z.string()),
	/** Earlier lines exist that this response (a tail) did not return. */
	truncatedBefore: z.boolean(),
});

export const LiveSessionTailOutputSchema = z.object({
	session: LiveSessionSummarySchema.nullable(),
	/** The session's upload has been stored: its detail can be read. */
	uploaded: z.boolean(),
	streams: z.array(LiveSessionTailStreamSchema),
});

export type LiveSessionSummary = z.infer<typeof LiveSessionSummarySchema>;
export type LiveSessionListOutput = z.infer<typeof LiveSessionListOutputSchema>;
export type LiveSessionTailCursor = z.infer<typeof LiveSessionTailCursorSchema>;
export type LiveSessionTailInput = z.infer<typeof LiveSessionTailInputSchema>;
export type LiveSessionTailStream = z.infer<typeof LiveSessionTailStreamSchema>;
export type LiveSessionTailOutput = z.infer<typeof LiveSessionTailOutputSchema>;

/** Running: not ended, and updated within the last five minutes. */
export function isLiveSessionActive(
	session: Pick<LiveSessionSummary, "endedAt" | "lastActivityAt">,
	nowMs: number,
): boolean {
	return (
		session.endedAt === null &&
		nowMs - Date.parse(session.lastActivityAt) <= LIVE_SESSION_ACTIVE_WINDOW_MS
	);
}

/**
 * The session detail revision of a live session: the time of its last
 * update, which moves on with every change. Uploaded sessions have decimal
 * ingestion revisions; a timestamp names a session read from its live lines.
 */
export function liveSessionDetailRevision(
	session: Pick<LiveSessionSummary, "lastActivityAt">,
): string {
	return session.lastActivityAt;
}

export function isLiveSessionDetailRevision(revision: string): boolean {
	return revision.includes("T");
}
