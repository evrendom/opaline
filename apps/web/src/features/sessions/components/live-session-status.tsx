import type { LiveSessionSummary } from "@rudel/api-routes";
import {
	formatLiveSessionActivity,
	readLiveSessionState,
} from "../live-session-model";
import { useLiveClock } from "../use-live-sessions";
import { SessionModelProgressRing } from "./session-model-progress-ring";
import { SessionStat } from "./session-reader-stat";

const CLOCK_INTERVAL_MS = 5_000;

/** The reader's rail fact for a session with live lines: whether it runs,
 * and when it last moved. Only it follows the clock. While the session runs
 * the band loads, as it does on the session's row. */
export function LiveSessionStatus({
	session,
}: {
	session: LiveSessionSummary;
}) {
	const nowMs = useLiveClock(CLOCK_INTERVAL_MS);
	const state = readLiveSessionState(session, nowMs);
	return (
		<SessionStat
			label="Status"
			value={
				<span
					className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"
					data-live-session={state}
				>
					<span className="inline-flex items-center gap-1.5">
						{state === "running" ? (
							<span
								aria-hidden="true"
								className="relative size-3.5 shrink-0 text-(--dashboardy-heading)"
							>
								<SessionModelProgressRing progress="loading" />
							</span>
						) : null}
						{state === "running" ? "Live" : state === "idle" ? "Idle" : "Ended"}
					</span>
					<time
						className="whitespace-nowrap text-xs text-muted-foreground"
						dateTime={session.lastActivityAt}
					>
						{formatLiveSessionActivity(session.lastActivityAt, nowMs)}
					</time>
				</span>
			}
		/>
	);
}
