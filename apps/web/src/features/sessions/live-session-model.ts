import {
	isLiveSessionActive,
	type LiveSessionSource,
	type LiveSessionSummary,
	type LiveSessionTailOutput,
	type LiveSessionTailStream,
} from "@rudel/api-routes";

export { isLiveSessionActive };

/** The session page keeps polling this long after a live session ended. */
export const LIVE_SESSION_ENDED_POLL_MS = 2 * 60_000;
export const LIVE_SESSION_POLL_INTERVAL_MS = 2_000;
/** A live session that went quiet without ending, or a failed request, is asked again this often. */
export const LIVE_SESSION_IDLE_POLL_INTERVAL_MS = 30_000;
export const LIVE_SESSION_LIST_POLL_INTERVAL_MS = 5_000;
export const LIVE_SESSION_LIST_PUSHED_POLL_INTERVAL_MS = 60_000;

export function liveSessionListPollInterval(
	poll: boolean | number,
	running: number,
	pushed: boolean,
): number | false {
	if (poll === false) return false;
	const every = poll === true ? LIVE_SESSION_LIST_POLL_INTERVAL_MS : poll;
	return running > 0 || !pushed
		? every
		: Math.max(every, LIVE_SESSION_LIST_PUSHED_POLL_INTERVAL_MS);
}

/**
 * What the page holds of a live session: the session, where each of its
 * streams stands, and whether its upload has been stored. The lines
 * themselves are read through the session detail, like an upload's.
 */
export interface LiveSessionTail {
	readonly session: LiveSessionSummary | null;
	readonly streams: readonly LiveSessionTailStream[];
	/** The session's upload has been stored: its detail can be read. */
	readonly uploaded: boolean;
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
 * How often the session page asks where a live session stands: every 2
 * seconds while the session runs and for two minutes after it ended, every
 * 30 seconds while it is quiet without having ended, and not at all once it
 * ended (or there is no live session).
 */
export function liveSessionPollInterval(
	session: LiveSessionSummary | null | undefined,
	nowMs: number,
): number | false {
	switch (readLiveSessionState(session, nowMs)) {
		case "running":
			return LIVE_SESSION_POLL_INTERVAL_MS;
		case "idle":
			return LIVE_SESSION_IDLE_POLL_INTERVAL_MS;
		case "ended":
			return session?.endedAt &&
				nowMs - Date.parse(session.endedAt) < LIVE_SESSION_ENDED_POLL_MS
				? LIVE_SESSION_POLL_INTERVAL_MS
				: false;
		case "none":
			return false;
	}
}

/**
 * Takes a poll's answer into what the page holds. The session and each
 * stream keep their objects while unchanged, and an answer without anything
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
			return held && sameStream(held, stream) ? held : stream;
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

/** "now", "12s ago", "3m ago", "2h ago". */
export function formatLiveSessionAge(
	lastActivityAt: string,
	nowMs: number,
): string {
	const seconds = Math.max(
		0,
		Math.floor((nowMs - Date.parse(lastActivityAt)) / 1_000),
	);
	if (seconds < 5) return "now";
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
	return `${Math.floor(seconds / 3_600)}h ago`;
}

/** "active now", "active 12s ago", "active 3m ago", "active 2h ago". */
export function formatLiveSessionActivity(
	lastActivityAt: string,
	nowMs: number,
): string {
	return `active ${formatLiveSessionAge(lastActivityAt, nowMs)}`;
}

function sameStream(
	held: LiveSessionTailStream,
	next: LiveSessionTailStream,
): boolean {
	return (
		held.generation === next.generation &&
		held.nextLine === next.nextLine &&
		held.firstLine === next.firstLine &&
		held.lines.length === 0 &&
		next.lines.length === 0
	);
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
