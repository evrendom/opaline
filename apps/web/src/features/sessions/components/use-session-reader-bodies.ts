import type { SessionDetailWindow } from "@rudel/api-routes";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
	fetchSessionDetailTurn,
	fetchSessionDetailWindow,
	isSessionDetailStaleRevisionError,
	SESSION_DETAIL_BODY_CACHE_TIME_MS,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	SESSION_DETAIL_WINDOW_CACHE_TIME_MS,
	sessionDetailTurnQueryKey,
	sessionDetailWindowQueryKey,
} from "./session-detail-fast-query";
import type { SessionReaderBody } from "./session-reader-model";

export type SessionReaderBodyState =
	| { status: "failed" }
	| { status: "loading" }
	| { body: SessionReaderBody; status: "ready" };

type BodyStore = {
	bodies: ReadonlyMap<string, SessionReaderBody>;
	failed: ReadonlySet<string>;
	oversized: ReadonlySet<string>;
};

function mergeWindow(store: BodyStore, window: SessionDetailWindow): BodyStore {
	const bodies = new Map(store.bodies);
	const oversized = new Set(store.oversized);
	for (const turn of window.turns) {
		if (turn.body) bodies.set(turn.turnId, turn.body);
		else if (turn.bodyOmitted === "oversized") oversized.add(turn.turnId);
	}
	return { ...store, bodies, oversized };
}

/**
 * Turn bodies for the reader, loaded on demand: the initial window arrives
 * with the page, and each turn that scrolls near the viewport without a body
 * pulls in the 200-turn window around it (or its own chunks when oversized).
 * Requests run one at a time, newest first, so a fast scroll doesn't fan out
 * into many overlapping windows.
 */
export function useSessionReaderBodies({
	initialWindow,
	onStaleRevision,
	revision,
	sessionId,
}: {
	initialWindow: SessionDetailWindow | undefined;
	onStaleRevision: (error: unknown) => void;
	revision: string;
	sessionId: string;
}) {
	const queryClient = useQueryClient();
	const [store, setStore] = useState<BodyStore>(() =>
		mergeWindow(
			{ bodies: new Map(), failed: new Set(), oversized: new Set() },
			initialWindow?.revision === revision
				? initialWindow
				: emptyWindow(revision),
		),
	);
	const storeRef = useRef(store);
	storeRef.current = store;
	const queueRef = useRef<string[]>([]);
	const inFlightRef = useRef(false);
	// A session read live arrives again with each change, at a new revision:
	// its window's bodies replace what they cover (the newest turn grew), the
	// rest stay until a turn asks for its body at the new revision.
	const [appliedWindow, setAppliedWindow] = useState(initialWindow);
	if (
		initialWindow &&
		initialWindow !== appliedWindow &&
		initialWindow.revision === revision
	) {
		setAppliedWindow(initialWindow);
		setStore(mergeWindow({ ...store, failed: new Set() }, initialWindow));
	}

	const pump = useCallback(async () => {
		if (inFlightRef.current) return;
		const current = storeRef.current;
		queueRef.current = queueRef.current.filter(
			(turnId) => !current.bodies.has(turnId) && !current.failed.has(turnId),
		);
		// Newest first: after a jump, the turns now on screen outrank the ones
		// the scroll passed on the way.
		const turnId = queueRef.current.pop();
		if (!turnId) return;
		inFlightRef.current = true;
		try {
			if (current.oversized.has(turnId)) {
				const turn = await queryClient.fetchQuery({
					gcTime: SESSION_DETAIL_BODY_CACHE_TIME_MS,
					queryFn: ({ signal }) =>
						fetchSessionDetailTurn({ revision, sessionId, turnId }, signal),
					queryKey: sessionDetailTurnQueryKey({ revision, sessionId, turnId }),
					staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
				});
				const next = new Map(storeRef.current.bodies);
				next.set(turnId, {
					responseItems: turn.responseItems,
					userItems: turn.userItems,
				});
				storeRef.current = { ...storeRef.current, bodies: next };
			} else {
				const request = {
					anchorTurnId: turnId,
					includeBodies: true,
					mode: "anchor",
					revision,
					sessionId,
				} as const;
				const window = await queryClient.fetchQuery({
					gcTime: SESSION_DETAIL_WINDOW_CACHE_TIME_MS,
					queryFn: ({ signal }) => fetchSessionDetailWindow(request, signal),
					queryKey: sessionDetailWindowQueryKey(request, "reader"),
					staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
				});
				storeRef.current = mergeWindow(storeRef.current, window);
				// The anchor itself may be too large for a window: fetch its chunks next.
				if (storeRef.current.oversized.has(turnId)) {
					queueRef.current.push(turnId);
				}
			}
		} catch (error) {
			if (isSessionDetailStaleRevisionError(error)) {
				onStaleRevision(error);
				return;
			}
			const failed = new Set(storeRef.current.failed);
			failed.add(turnId);
			storeRef.current = { ...storeRef.current, failed };
		} finally {
			inFlightRef.current = false;
			setStore(storeRef.current);
		}
		void pump();
	}, [onStaleRevision, queryClient, revision, sessionId]);

	const requestBody = useCallback(
		(turnId: string) => {
			const current = storeRef.current;
			if (
				current.bodies.has(turnId) ||
				current.failed.has(turnId) ||
				queueRef.current.includes(turnId)
			) {
				return;
			}
			queueRef.current.push(turnId);
			void pump();
		},
		[pump],
	);

	const retryBody = useCallback(
		(turnId: string) => {
			const failed = new Set(storeRef.current.failed);
			failed.delete(turnId);
			storeRef.current = { ...storeRef.current, failed };
			setStore(storeRef.current);
			requestBody(turnId);
		},
		[requestBody],
	);

	const getBody = (turnId: string): SessionReaderBodyState => {
		const body = store.bodies.get(turnId);
		if (body) return { body, status: "ready" };
		if (store.failed.has(turnId)) return { status: "failed" };
		return { status: "loading" };
	};

	return { getBody, requestBody, retryBody };
}

function emptyWindow(revision: string): SessionDetailWindow {
	return {
		newerCursor: null,
		olderCursor: null,
		revision,
		total: 0,
		turns: [],
	};
}
