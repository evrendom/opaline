import {
	isLiveSessionActive,
	type LiveSessionSummary,
	type SessionAnalytics,
} from "@rudel/api-routes";
import { sessionRowKey } from "./session-row-key";

/**
 * A sessions-table row for a session running right now, before its upload:
 * the live session's facts, without transcript metrics (like an upload
 * failure's row, the placeholders are hidden and left out of metric filters).
 */
export function liveSessionRow(live: LiveSessionSummary): SessionAnalytics {
	return {
		live_session: live,
		session_id: live.sessionId,
		user_id: live.userId,
		source: live.source,
		session_date: live.startedAt,
		project_path: live.projectPath,
		repository: null,
		git_remote: live.gitRemote ?? undefined,
		git_branch: live.gitBranch,
		model_used: "",
		estimated_cost: null,
		duration_min: 0,
		total_tokens: 0,
		input_tokens: 0,
		output_tokens: 0,
		total_interactions: 0,
		subagent_types: [],
		skills: [],
		slash_commands: [],
	};
}

/** A row built from a live session alone: it has no transcript metrics. */
export function isLiveOnlySessionRow(session: SessionAnalytics): boolean {
	return (
		session.live_session !== undefined &&
		session.upload_failure === undefined &&
		session.model_used === "" &&
		session.total_tokens === 0
	);
}

/**
 * The table's rows with the sessions running right now first, most recently
 * active first. A live session whose upload is listed already marks that
 * row live while it runs (its metrics stay); once it stopped running, the
 * uploaded row stands alone. A live session without an upload is a row of
 * its own until its upload lands.
 */
export function mergeLiveSessionRows(
	sessions: readonly SessionAnalytics[],
	live: readonly LiveSessionSummary[],
	nowMs: number,
): SessionAnalytics[] {
	if (live.length === 0) return [...sessions];
	const uploadedByKey = new Map(
		sessions.map((session) => [sessionRowKey(session), session]),
	);
	const pinned: SessionAnalytics[] = [];
	const pinnedKeys = new Set<string>();
	for (const summary of [...live].sort(byLastActivityDescending)) {
		const key = `${summary.source}:${summary.sessionId}`;
		if (pinnedKeys.has(key)) continue;
		const uploaded = uploadedByKey.get(key);
		if (uploaded) {
			if (!isLiveSessionActive(summary, nowMs)) continue;
			pinned.push({ ...uploaded, live_session: summary });
		} else {
			pinned.push(liveSessionRow(summary));
		}
		pinnedKeys.add(key);
	}
	return [
		...pinned,
		...sessions.filter((session) => !pinnedKeys.has(sessionRowKey(session))),
	];
}

/**
 * Live rows before the rest, the most recently active first; two rows that
 * are not live compare as equal, for the table's own sort to order.
 */
export function compareLiveSessionRows(
	left: SessionAnalytics,
	right: SessionAnalytics,
): number {
	const leftActivity = lastActivityMs(left);
	const rightActivity = lastActivityMs(right);
	if (leftActivity === null && rightActivity === null) return 0;
	if (leftActivity === null) return 1;
	if (rightActivity === null) return -1;
	return rightActivity - leftActivity;
}

function lastActivityMs(session: SessionAnalytics): number | null {
	return session.live_session
		? Date.parse(session.live_session.lastActivityAt)
		: null;
}

function byLastActivityDescending(
	left: LiveSessionSummary,
	right: LiveSessionSummary,
): number {
	return Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
}
