import type { SessionDetailWindow } from "@rudel/api-routes";
import type { ReadyBody } from "@rudel/api-routes/session-context/session-reader-body";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import {
	BODY_PRIORITY,
	raiseBodyPriority,
	scheduleBodyRequest,
} from "../../components/body-request-scheduler";
import {
	fetchSessionDetailTurn,
	fetchSessionDetailWindow,
	isSessionDetailStaleRevisionError,
	SESSION_DETAIL_BODY_CACHE_TIME_MS,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	SESSION_DETAIL_WINDOW_CACHE_TIME_MS,
	sessionDetailTurnQueryKey,
	sessionDetailWindowQueryKey,
} from "../../components/session-detail-fast-query";
import type { SessionReaderBody } from "../model/session-reader-model";
import { cachedBodies } from "./session-reader-bodies-cache";

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
		if (turn.body && !bodies.has(turn.turnId))
			bodies.set(turn.turnId, turn.body);
		else if (turn.bodyOmitted === "oversized") oversized.add(turn.turnId);
	}
	return { ...store, bodies, oversized };
}

const MAX_IN_FLIGHT = 3;

export function useSessionReaderBodies({
	initialWindow,
	onStaleRevision,
	revision,
	sessionId,
	startTurnId,
	turns,
}: {
	initialWindow: SessionDetailWindow | undefined;
	onStaleRevision: (error: unknown) => void;
	revision: string;
	sessionId: string;
	startTurnId?: string;
	turns?: readonly { turnId: string }[];
}) {
	const queryClient = useQueryClient();
	const [store, setStore] = useState<BodyStore>(() =>
		mergeWindow(
			{ ...cachedBodies(queryClient, sessionId, revision), failed: new Set() },
			initialWindow?.revision === revision
				? initialWindow
				: emptyWindow(revision),
		),
	);
	const storeRef = useRef(store);
	storeRef.current = store;
	const turnsRef = useRef(turns);
	turnsRef.current = turns;
	const startRef = useRef(startTurnId);
	startRef.current = startTurnId;
	// The turn the address opened on goes first, when it isn't in already:
	// once it's drawn, not from a draw React may throw away (it can start a
	// request).
	useLayoutEffect(() => {
		if (startTurnId) raiseBodyPriority(startTurnId, BODY_PRIORITY.urgent);
	}, [startTurnId]);
	const queueRef = useRef<string[]>([]);
	const inFlightRef = useRef(new Set<string>());
	const windowInFlightRef = useRef(false);
	const [appliedWindow, setAppliedWindow] = useState(initialWindow);
	if (
		initialWindow &&
		initialWindow !== appliedWindow &&
		initialWindow.revision === revision
	) {
		setAppliedWindow(initialWindow);
		setStore(mergeWindow({ ...store, failed: new Set() }, initialWindow));
	}

	const idleRef = useRef<number | null>(null);
	useMountEffect(() => () => {
		if (idleRef.current === null) return;
		if (typeof cancelIdleCallback === "function")
			cancelIdleCallback(idleRef.current);
		window.clearTimeout(idleRef.current);
	});
	const pump = useCallback(
		async (fromIdle = false) => {
			if (inFlightRef.current.size >= MAX_IN_FLIGHT) return;
			const current = storeRef.current;
			queueRef.current = queueRef.current.filter(
				(turnId) =>
					!current.bodies.has(turnId) &&
					!current.failed.has(turnId) &&
					!inFlightRef.current.has(turnId),
			);
			const canStart = (id: string) =>
				current.oversized.has(id) || !windowInFlightRef.current;
			let queued = queueRef.current.length - 1;
			while (queued >= 0 && !canStart(queueRef.current[queued] as string))
				queued--;
			if (queued === -1 && !fromIdle) {
				if (inFlightRef.current.size === 0 && idleRef.current === null)
					idleRef.current = idle(() => {
						idleRef.current = null;
						void pumpRef.current(true);
					});
				return;
			}
			const turnId =
				queued === -1
					? inFlightRef.current.size === 0
						? nextMissing(
								turnsRef.current ?? [],
								startRef.current,
								(id) =>
									!current.bodies.has(id) &&
									!current.failed.has(id) &&
									!inFlightRef.current.has(id) &&
									canStart(id),
							)
						: undefined
					: queueRef.current.splice(queued, 1)[0];
			if (!turnId) return;
			if (queued === -1) raiseBodyPriority(turnId, BODY_PRIORITY.idle);
			const windowed = !current.oversized.has(turnId);
			if (windowed) windowInFlightRef.current = true;
			inFlightRef.current.add(turnId);
			void pump();
			try {
				if (current.oversized.has(turnId)) {
					const turn = await queryClient.fetchQuery({
						gcTime: SESSION_DETAIL_BODY_CACHE_TIME_MS,
						queryFn: ({ signal }) =>
							fetchSessionDetailTurn({ revision, sessionId, turnId }, signal),
						queryKey: sessionDetailTurnQueryKey({
							revision,
							sessionId,
							turnId,
						}),
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
						queryFn: ({ signal }) =>
							scheduleBodyRequest(turnId, signal, () =>
								fetchSessionDetailWindow(request, signal),
							),
						queryKey: sessionDetailWindowQueryKey(request, "reader"),
						staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
					});
					storeRef.current = mergeWindow(storeRef.current, window);
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
				inFlightRef.current.delete(turnId);
				if (windowed) windowInFlightRef.current = false;
				setStore(storeRef.current);
			}
			void pump();
		},
		[onStaleRevision, queryClient, revision, sessionId],
	);
	const pumpRef = useRef(pump);
	pumpRef.current = pump;

	const requestBody = useCallback(
		(turnId: string) => {
			raiseBodyPriority(turnId, BODY_PRIORITY.visible);
			const current = storeRef.current;
			if (
				!current.bodies.has(turnId) &&
				!current.failed.has(turnId) &&
				!queueRef.current.includes(turnId)
			)
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

	const statesRef = useRef(new Map<string, SessionReaderBodyState>());
	const { bodies, failed } = store;
	const getBody = useCallback(
		(turnId: string): SessionReaderBodyState => {
			const body = bodies.get(turnId);
			const status = body ? "ready" : failed.has(turnId) ? "failed" : "loading";
			const held = statesRef.current.get(turnId);
			if (
				held &&
				held.status === status &&
				(held.status !== "ready" || held.body === body)
			) {
				return held;
			}
			const next: SessionReaderBodyState = body
				? { body, status: "ready" }
				: status === "failed"
					? { status: "failed" }
					: { status: "loading" };
			statesRef.current.set(turnId, next);
			return next;
		},
		[bodies, failed],
	);

	return { getBody, requestBody, retryBody };
}

export type { ReadyBody };

function sameReadyBodies<Turn>(
	held: readonly ReadyBody<Turn>[] | null,
	next: readonly ReadyBody<Turn>[] | null,
): boolean {
	if (held === null || next === null) return held === next;
	return (
		held.length === next.length &&
		held.every(
			(each, index) =>
				each.body === next[index]?.body && each.turn === next[index]?.turn,
		)
	);
}

export function useReadyBodies<Turn extends { turnId: string }>(
	turns: readonly Turn[],
	getBody: (turnId: string) => SessionReaderBodyState,
): readonly ReadyBody<Turn>[] | null {
	const ready: ReadyBody<Turn>[] = [];
	for (const turn of turns) {
		const state = getBody(turn.turnId);
		if (state.status === "ready") ready.push({ body: state.body, turn });
	}
	const next = ready.length === turns.length ? ready : null;
	const [held, setHeld] = useState(next);
	if (sameReadyBodies(held, next)) return held;
	setHeld(next);
	return next;
}

function idle(run: () => void): number {
	return typeof requestIdleCallback === "function"
		? requestIdleCallback(run, { timeout: 300 })
		: window.setTimeout(run, 200);
}

function nextMissing(
	turns: readonly { turnId: string }[],
	startTurnId: string | undefined,
	wanted: (turnId: string) => boolean,
): string | undefined {
	const start = turns.findIndex((turn) => turn.turnId === startTurnId);
	const from = start === -1 ? turns.length - 1 : start;
	for (let distance = 0; distance < turns.length; distance++) {
		for (const index of [from + distance, from - distance]) {
			const turnId = turns[index]?.turnId;
			if (turnId && wanted(turnId)) return turnId;
		}
	}
	return undefined;
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
