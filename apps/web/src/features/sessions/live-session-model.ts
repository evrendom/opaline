import type {
	LiveSessionSource,
	LiveSessionSummary,
	LiveSessionTailCursor,
	LiveSessionTailOutput,
	LiveSessionTailStream,
} from "@rudel/api-routes";

/** A live session counts as running while its last update is this recent. */
export const LIVE_SESSION_ACTIVE_WINDOW_MS = 5 * 60_000;
/** The session page keeps polling this long after a live session ended. */
export const LIVE_SESSION_ENDED_POLL_MS = 2 * 60_000;
export const LIVE_SESSION_TAIL_POLL_INTERVAL_MS = 2_000;
/** A live session that went quiet without ending, or a failed request, is asked again this often. */
export const LIVE_SESSION_IDLE_POLL_INTERVAL_MS = 30_000;
export const LIVE_SESSION_LIST_POLL_INTERVAL_MS = 5_000;
/** Lines the page keeps per stream; older ones fall out of the live view. */
const MAX_RETAINED_MAIN_LINES = 1_000;
const MAX_RETAINED_SUBAGENT_LINES = 300;

export type LiveSessionStream = LiveSessionTailStream;

export interface LiveSessionTail {
	readonly session: LiveSessionSummary | null;
	readonly streams: readonly LiveSessionStream[];
	/** The session's upload has been stored: its detail can be read. */
	readonly uploaded: boolean;
}

/** Running: not ended, and updated within the last five minutes. */
export function isLiveSessionActive(
	session: LiveSessionSummary,
	nowMs: number,
): boolean {
	return (
		session.endedAt === null &&
		nowMs - Date.parse(session.lastActivityAt) <= LIVE_SESSION_ACTIVE_WINDOW_MS
	);
}

export type LiveSessionState = "ended" | "idle" | "none" | "running";

/**
 * `running` (updated in the last five minutes), `idle` (quiet, never ended:
 * the agent may have been killed, or may resume), `ended`, or `none`.
 */
export function readLiveSessionState(
	session: LiveSessionSummary | null | undefined,
	nowMs: number,
): LiveSessionState {
	if (!session) return "none";
	if (session.endedAt !== null) return "ended";
	return isLiveSessionActive(session, nowMs) ? "running" : "idle";
}

/**
 * How often the session page asks for new lines: every 2 seconds while the
 * session runs and for two minutes after it ended, every 30 seconds while it
 * is quiet without having ended, and not at all once it ended (or there is
 * no live session).
 */
export function liveSessionPollInterval(
	session: LiveSessionSummary | null | undefined,
	nowMs: number,
): number | false {
	switch (readLiveSessionState(session, nowMs)) {
		case "running":
			return LIVE_SESSION_TAIL_POLL_INTERVAL_MS;
		case "idle":
			return LIVE_SESSION_IDLE_POLL_INTERVAL_MS;
		case "ended":
			return session?.endedAt &&
				nowMs - Date.parse(session.endedAt) < LIVE_SESSION_ENDED_POLL_MS
				? LIVE_SESSION_TAIL_POLL_INTERVAL_MS
				: false;
		case "none":
			return false;
	}
}

export function buildLiveSessionTailCursor(
	tail: LiveSessionTail | undefined,
): LiveSessionTailCursor[] | undefined {
	if (!tail || tail.streams.length === 0) return undefined;
	return tail.streams.map((stream) => ({
		agentId: stream.agentId,
		generation: stream.generation,
		nextLine: stream.nextLine,
	}));
}

/**
 * Adds a tail response to what the page holds. A stream continues where the
 * response starts at its `nextLine` in the same generation; otherwise (a new
 * generation, or a tail the server answered) the response replaces it. A
 * stream without new lines keeps its object, and an answer without anything
 * new returns `previous` itself, so views keyed on them do not rebuild.
 */
export function mergeLiveSessionTail(
	previous: LiveSessionTail | undefined,
	response: LiveSessionTailOutput,
): LiveSessionTail {
	const previousStreams = new Map(
		(previous?.streams ?? []).map((stream) => [stream.agentId, stream]),
	);
	const merged: LiveSessionTail = {
		uploaded: response.uploaded,
		session:
			previous?.session && sameSummary(previous.session, response.session)
				? previous.session
				: response.session,
		streams: response.streams.map((stream) => {
			const held = previousStreams.get(stream.agentId);
			const continues =
				held !== undefined &&
				held.generation === stream.generation &&
				held.nextLine === stream.firstLine;
			if (!continues) return retainNewest(stream);
			if (stream.lines.length === 0) return held;
			return retainNewest({
				...held,
				lines: [...held.lines, ...stream.lines],
				nextLine: stream.nextLine,
			});
		}),
	};
	return previous &&
		merged.uploaded === previous.uploaded &&
		merged.session === previous.session &&
		merged.streams.length === previous.streams.length &&
		merged.streams.every((stream, index) => stream === previous.streams[index])
		? previous
		: merged;
}

export function formatLiveSessionSource(source: LiveSessionSource): string {
	return source === "codex" ? "Codex" : "Claude Code";
}

/**
 * The model of the stream's latest model line, if any: a Claude Code
 * assistant message, or a Codex turn context.
 */
export function readLatestLiveSessionModel(
	lines: readonly string[],
): string | undefined {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line?.includes('"assistant"') && !line?.includes('"turn_context"'))
			continue;
		try {
			const record: unknown = JSON.parse(line);
			if (!isRecord(record)) continue;
			const holder =
				record.type === "assistant"
					? record.message
					: record.type === "turn_context"
						? record.payload
						: null;
			const model = isRecord(holder) ? holder.model : null;
			if (typeof model === "string" && model.trim()) return model;
		} catch {
			// A line the page cannot read names no model.
		}
	}
	return undefined;
}

/** "active now", "active 12s ago", "active 3m ago", "active 2h ago". */
export function formatLiveSessionActivity(
	lastActivityAt: string,
	nowMs: number,
): string {
	const seconds = Math.max(
		0,
		Math.floor((nowMs - Date.parse(lastActivityAt)) / 1_000),
	);
	if (seconds < 5) return "active now";
	if (seconds < 60) return `active ${seconds}s ago`;
	if (seconds < 3_600) return `active ${Math.floor(seconds / 60)}m ago`;
	return `active ${Math.floor(seconds / 3_600)}h ago`;
}

function retainNewest(stream: LiveSessionStream): LiveSessionStream {
	const limit =
		stream.agentId === null
			? MAX_RETAINED_MAIN_LINES
			: MAX_RETAINED_SUBAGENT_LINES;
	const dropped = stream.lines.length - limit;
	if (dropped <= 0) return stream;
	return {
		...stream,
		firstLine: stream.firstLine + dropped,
		lines: stream.lines.slice(dropped),
		truncatedBefore: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sameSummary(
	held: LiveSessionSummary,
	next: LiveSessionSummary | null,
): boolean {
	return (
		next !== null &&
		held.sessionId === next.sessionId &&
		held.userId === next.userId &&
		held.source === next.source &&
		held.projectPath === next.projectPath &&
		held.gitRemote === next.gitRemote &&
		held.gitBranch === next.gitBranch &&
		held.startedAt === next.startedAt &&
		held.lastActivityAt === next.lastActivityAt &&
		held.endedAt === next.endedAt
	);
}
