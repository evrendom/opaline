import type { LiveSessionSummary, SessionAnalytics } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { FlowFigure } from "@/app/ui/flow-number";
import { isLiveOnlySessionRow } from "@/features/sessions/live-session-rows";
import {
	formatLiveSessionActivity,
	formatLiveSessionSource,
	type LiveSessionState,
	liveSessionAgeFigure,
	readLiveSessionState,
} from "../live-session-model";

/**
 * What a session running right now adds to its row: it reads "Live" with
 * the agent that runs it (its model and usage arrive with the upload) and
 * how long ago it last moved, in the shape of every other row.
 */
export function describeLiveSessionRow(
	session: SessionAnalytics,
	nowMs: number | undefined,
): {
	/** The row's date cell: how long ago the session last moved. */
	age: ReactNode;
	live: LiveSessionSummary;
	/** The row shows the agent in place of a model it does not know yet. */
	sourceLabel: string | undefined;
	state: LiveSessionState;
	tokenTooltipLabel: string | undefined;
} | null {
	const live = session.live_session;
	if (!live) return null;
	const now = nowMs ?? Date.now();
	const liveOnly = isLiveOnlySessionRow(session);
	return {
		age: <FlowFigure figure={liveSessionAgeFigure(live.lastActivityAt, now)} />,
		live,
		sourceLabel: liveOnly ? formatLiveSessionSource(live.source) : undefined,
		state: readLiveSessionState(live, now),
		tokenTooltipLabel: liveOnly
			? "Usage arrives with the session's upload"
			: undefined,
	};
}

export function describeLiveSessionRowDate(
	live: LiveSessionSummary,
	startedLabel: string,
	nowMs: number | undefined,
): string {
	return `Started ${startedLabel} · ${formatLiveSessionActivity(
		live.lastActivityAt,
		nowMs ?? Date.now(),
	)}`;
}

/** "Live", "Idle" or "Ended", before the agent's name in the model cell. */
export function SessionOverviewLiveLabel({
	state,
}: {
	state: LiveSessionState;
}) {
	return (
		<span
			className="inline-flex shrink-0 items-center gap-1.5 text-xs/4 font-medium text-(--session-overview-text)"
			data-session-overview-live={state}
			title={
				state === "running"
					? "Running right now"
					: state === "idle"
						? "Quiet for over five minutes; it has not ended"
						: "Ended; its upload is on its way"
			}
		>
			{state === "running" ? "Live" : state === "idle" ? "Idle" : "Ended"}
		</span>
	);
}
