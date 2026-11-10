import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client, orpc } from "@/lib/orpc";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";
import {
	LIVE_SESSION_IDLE_POLL_INTERVAL_MS,
	LIVE_SESSION_POLL_INTERVAL_MS,
	type LiveSessionState,
	type LiveSessionTail,
	liveSessionListPollInterval,
	liveSessionPollInterval,
	mergeLiveSessionTail,
	readLiveSessionState,
} from "./live-session-model";
import { useSessionArrivalsLive } from "./session-arrivals-live";

/** How often a view's "active 12s ago" and running state are re-read. */
const LIVE_STATE_CLOCK_MS = 30_000;

// The plugin app reaches only the procedures it serves as tools, and the
// product demo has no live sessions: both leave live views out.
function useLiveSessionsAvailable(): boolean {
	const demo = useDemoRuntime();
	return import.meta.env.MODE !== "plugin" && demo === null;
}

export function useLiveSessionList({
	enabled = true,
	poll = true,
}: {
	enabled?: boolean;
	poll?: boolean | number;
} = {}) {
	const available = useLiveSessionsAvailable();
	const pushed = useSessionArrivalsLive();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const options = orpc.analytics.sessions.liveList.queryOptions();
	const query = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: enabled && available && !!organizationId,
		refetchInterval: (current) =>
			liveSessionListPollInterval(
				poll,
				current.state.data?.sessions.length ?? 0,
				pushed,
			),
		retry: false,
	});
	return {
		sessions: query.data?.sessions ?? [],
		updatedAt: query.dataUpdatedAt,
	};
}

/**
 * One query holds where a session's live lines stand. `useLiveSessionPolling`
 * alone asks again; the other hooks read what it holds, so the session page
 * re-renders only for what it shows.
 */
function useLiveSessionOptions(sessionId: string) {
	const available = useLiveSessionsAvailable();
	const queryClient = useQueryClient();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const queryKey = ["org", organizationId, "liveSession", sessionId];
	return {
		queryKey,
		enabled: available && !!organizationId && sessionId.length > 0,
		queryFn: async ({
			signal,
		}: {
			signal: AbortSignal;
		}): Promise<LiveSessionTail> => {
			const previous = queryClient.getQueryData<LiveSessionTail>(queryKey);
			const response = await client.analytics.sessions.liveTail(
				{ sessionId, summaryOnly: true },
				{ signal },
			);
			// The upload is stored: the session page reads its detail now,
			// instead of asking for a missing one over and over (the session
			// arrival stream announces uploads after polling stopped).
			if (response.uploaded && !previous?.uploaded) {
				void queryClient.invalidateQueries({
					queryKey: sessionDetailInitialQueryOptions(sessionId).queryKey,
				});
			}
			return mergeLiveSessionTail(previous, response);
		},
		retry: false,
		// Mounting another reader does not ask again.
		staleTime: LIVE_SESSION_POLL_INTERVAL_MS,
		// Unchanged answers return the held object.
		structuralSharing: false,
	} as const;
}

/**
 * Asks where the session stands every 2 seconds while it runs and for two
 * minutes after it ends, every 30 seconds while it is quiet without having
 * ended or after a failed request, and once when there is no live session.
 * It never re-renders its component.
 */
export function useLiveSessionPolling(sessionId: string): void {
	useQuery({
		...useLiveSessionOptions(sessionId),
		notifyOnChangeProps: [],
		refetchInterval: (query) =>
			query.state.status === "error" && query.state.data === undefined
				? LIVE_SESSION_IDLE_POLL_INTERVAL_MS
				: liveSessionPollInterval(query.state.data?.session, Date.now()),
	});
}

/** Whether the session has live lines and runs; re-read every 30 seconds. */
export function useLiveSessionState(sessionId: string): LiveSessionState {
	const tick = useLiveClock(LIVE_STATE_CLOCK_MS);
	const query = useQuery({
		...useLiveSessionOptions(sessionId),
		refetchInterval: false,
		// biome-ignore lint/correctness/useExhaustiveDependencies: the clock tick re-reads the state against the current time
		select: useCallback(
			(tail: LiveSessionTail) => readLiveSessionState(tail.session, Date.now()),
			[tick],
		),
	});
	return query.data ?? "none";
}

/** The live session the polling holds, without asking for more. */
export function useLiveSession(sessionId: string): LiveSessionTail | undefined {
	return useQuery({
		...useLiveSessionOptions(sessionId),
		refetchInterval: false,
	}).data;
}

/** The current time, updated every `intervalMs` (`false`: never). */
export function useLiveClock(intervalMs: number | false): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (intervalMs === false) return;
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
