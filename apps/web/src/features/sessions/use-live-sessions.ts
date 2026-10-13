import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client, orpc } from "@/lib/orpc";
import { sessionDetailInitialQueryKey } from "./components/session-detail-fast-query";
import {
	buildLiveSessionTailCursor,
	LIVE_SESSION_IDLE_POLL_INTERVAL_MS,
	LIVE_SESSION_LIST_POLL_INTERVAL_MS,
	LIVE_SESSION_TAIL_POLL_INTERVAL_MS,
	type LiveSessionState,
	type LiveSessionTail,
	liveSessionPollInterval,
	mergeLiveSessionTail,
	readLiveSessionState,
} from "./live-session-model";

// The plugin app reaches only the procedures it serves as tools, and the
// product demo has no live sessions: both leave live views out.
function useLiveSessionsAvailable(): boolean {
	const demo = useDemoRuntime();
	return import.meta.env.MODE !== "plugin" && demo === null;
}

/**
 * The workspace's live sessions (last 24 hours), polled every 5 seconds. A
 * failure reads as none: live sessions never hold up the sessions list.
 */
export function useLiveSessionList() {
	const available = useLiveSessionsAvailable();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const options = orpc.analytics.sessions.liveList.queryOptions();
	const query = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: available && !!organizationId,
		refetchInterval: LIVE_SESSION_LIST_POLL_INTERVAL_MS,
		retry: false,
	});
	return {
		sessions: query.data?.sessions ?? [],
		updatedAt: query.dataUpdatedAt,
	};
}

/**
 * One query holds a session's live lines: its tail first, then the lines
 * added since. `useLiveSessionTailPolling` alone asks for more; the other
 * hooks read what it holds, so the session page re-renders only for what it
 * shows.
 */
function useLiveSessionTailOptions(sessionId: string) {
	const available = useLiveSessionsAvailable();
	const queryClient = useQueryClient();
	const { state: organization } = useOrganization();
	const organizationId = organization.activeOrg?.id;
	const queryKey = ["org", organizationId, "liveSessionTail", sessionId];
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
				{ sessionId, cursor: buildLiveSessionTailCursor(previous) },
				{ signal },
			);
			// The upload is stored: the session page reads its detail now,
			// instead of asking for a missing one over and over (the session
			// arrival stream announces uploads after polling stopped).
			if (response.uploaded && !previous?.uploaded) {
				void queryClient.invalidateQueries({
					queryKey: sessionDetailInitialQueryKey(sessionId),
				});
			}
			return mergeLiveSessionTail(previous, response);
		},
		retry: false,
		// Mounting another reader of the same lines does not ask again.
		staleTime: LIVE_SESSION_TAIL_POLL_INTERVAL_MS,
		// Unchanged answers return the held object; comparing every line of
		// the transcript on each poll would cost more than it saves.
		structuralSharing: false,
	} as const;
}

/**
 * Asks for new lines every 2 seconds while the session runs and for two
 * minutes after it ends, every 30 seconds while it is quiet without having
 * ended or after a failed request, and once when there is no live session.
 * It never re-renders its component.
 */
export function useLiveSessionTailPolling(sessionId: string): void {
	useQuery({
		...useLiveSessionTailOptions(sessionId),
		notifyOnChangeProps: [],
		refetchInterval: (query) =>
			query.state.status === "error" && query.state.data === undefined
				? LIVE_SESSION_IDLE_POLL_INTERVAL_MS
				: liveSessionPollInterval(query.state.data?.session, Date.now()),
	});
}

/** Whether the session has live lines and runs; changes rarely. */
export function useLiveSessionState(sessionId: string): LiveSessionState {
	const query = useQuery({
		...useLiveSessionTailOptions(sessionId),
		refetchInterval: false,
		select: (tail: LiveSessionTail) =>
			readLiveSessionState(tail.session, Date.now()),
	});
	return query.data ?? "none";
}

/** The live lines the polling holds, without asking for more. */
export function useLiveSessionTail(
	sessionId: string,
): LiveSessionTail | undefined {
	return useQuery({
		...useLiveSessionTailOptions(sessionId),
		refetchInterval: false,
	}).data;
}

/** The current time, updated every `intervalMs`: for "active 12s ago". */
export function useLiveClock(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
