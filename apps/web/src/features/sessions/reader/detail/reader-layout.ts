import {
	createContext,
	type RefObject,
	useContext,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { markLaidOut, markMeasuring } from "../reader-dom";

export type AttemptShape = {
	height: number;
	rows: {
		failed?: boolean;
		tags?: string;
		height: number;
		id: string;
		startMs: string;
		top: number;
	}[];
	subagents: {
		endMs: string | undefined;
		height: number;
		id: string | undefined;
		top: number;
		until: string | undefined;
	}[];
	talks: { height: number; id: string; top: number }[];
};

export type ReaderLayout = {
	shapes: Map<string, AttemptShape>;
	laidOutListeners: Set<(turnId: string, element: HTMLElement) => void>;
	isMeasuring: (turnId: string) => boolean;
	isKept: (turnId: string) => boolean;
	getMeasuring: () => ReadonlySet<string>;
	getSettled: () => boolean;
	subscribe: (listener: () => void) => () => void;
	done: (turnId: string) => void;
	defer: (turnId: string) => boolean;
	waitsForWhole: (turnId: string) => boolean;
	setWhole: (turnId: string, whole: boolean) => void;
	isWhole: (turnId: string) => boolean | undefined;
	holdsSettle: (turnId: string) => boolean;
	invalidate: (turnId: string) => void;
	isDeferred: (turnId: string) => boolean;
	start: (...turnIds: string[]) => void;
	finish: (...turnIds: string[]) => void;
	isLaidOut: (turnId: string) => boolean;
	setSettled: (settled: boolean) => void;
	isDone: (turnId: string) => boolean;
	wasDeferred: (turnId: string) => boolean;
};

const DEFER_MS = 500;
const WHOLE_WAIT_MS = 6_000;
const QUIET_MS = 1_000;
const WHOLE_SETTLE_MS = 60_000;

export function createReaderLayout(
	kept?: Map<string, AttemptShape>,
	keptTurns: Iterable<string> = [],
): ReaderLayout {
	const shapes = kept ?? new Map<string, AttemptShape>();
	const laidOut = new Set<string>();
	const keptLaidOut = new Set(keptTurns);
	const laidOutPartial = new Set<string>();
	const listeners = new Set<() => void>();
	const measuring = new Set<string>();
	const reported = new Set<string>();
	const deferredNow = new Set<string>();
	const deferredUntil = new Map<string, number>();
	const notWholeSince = new Map<string, number>();
	const wholes = new Map<string, boolean>();
	const waitedOut = (turnId: string, wait = WHOLE_WAIT_MS) => {
		const now = performance.now();
		const since = notWholeSince.get(turnId) ?? now;
		notWholeSince.set(turnId, since);
		return now - since >= wait;
	};
	let settled = false;
	const emit = () => {
		for (const listener of listeners) listener();
	};
	const invalidate = (turnId: string) => {
		const now = performance.now();
		const wasKept = keptLaidOut.delete(turnId);
		if (
			!laidOut.delete(turnId) &&
			!wasKept &&
			(deferredUntil.get(turnId) ?? 0) <= now
		)
			return;
		deferredUntil.set(turnId, now + QUIET_MS);
		if (settled) {
			settled = false;
			emit();
		}
	};
	return {
		shapes,
		laidOutListeners: new Set(),
		isMeasuring: (turnId) => measuring.has(turnId),
		isKept: (turnId) => keptLaidOut.has(turnId),
		getMeasuring: () => measuring,
		getSettled: () => settled,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		done(turnId) {
			if (measuring.has(turnId)) reported.add(turnId);
		},
		defer(turnId) {
			if (!measuring.has(turnId) || waitedOut(turnId)) return false;
			deferredNow.add(turnId);
			deferredUntil.set(turnId, performance.now() + DEFER_MS);
			return true;
		},
		setWhole(turnId, whole) {
			const was = wholes.get(turnId);
			wholes.set(turnId, whole);
			if (was === false && whole && laidOutPartial.delete(turnId))
				invalidate(turnId);
		},
		isWhole: (turnId) => wholes.get(turnId),
		waitsForWhole(turnId) {
			if (wholes.get(turnId) !== false) return false;
			return !waitedOut(turnId);
		},
		holdsSettle(turnId) {
			if (wholes.get(turnId) !== false) return false;
			return !waitedOut(turnId, WHOLE_SETTLE_MS);
		},
		invalidate,
		isDeferred: (turnId) =>
			(deferredUntil.get(turnId) ?? 0) > performance.now(),
		start(...turnIds) {
			for (const turnId of turnIds) {
				measuring.add(turnId);
				reported.delete(turnId);
				deferredNow.delete(turnId);
			}
			emit();
		},
		finish(...turnIds) {
			for (const turnId of turnIds) {
				if (!deferredNow.has(turnId)) {
					laidOut.add(turnId);
					if (wholes.get(turnId) === false) laidOutPartial.add(turnId);
				}
				measuring.delete(turnId);
				reported.delete(turnId);
				deferredNow.delete(turnId);
			}
			emit();
		},
		isLaidOut: (turnId) => laidOut.has(turnId),
		setSettled(next) {
			if (next === settled) return;
			settled = next;
			emit();
		},
		isDone: (turnId) => reported.has(turnId),
		wasDeferred: (turnId) => deferredNow.has(turnId),
	};
}

export const ReaderLayoutContext = createContext<ReaderLayout | null>(null);

export function useMeasuringTurn(turnId: string | undefined): boolean {
	const layout = useContext(ReaderLayoutContext);
	return useSyncExternalStore(
		layout?.subscribe ?? noSubscribe,
		() => Boolean(turnId) && (layout?.isMeasuring(turnId ?? "") ?? false),
		() => false,
	);
}

export function useReaderLayoutSettled(): boolean {
	const layout = useContext(ReaderLayoutContext);
	return useSyncExternalStore(
		layout?.subscribe ?? noSubscribe,
		() => layout?.getSettled() ?? true,
		() => true,
	);
}

const noSubscribe = () => () => {};

const REPORT_WITHIN_MS = 1_000;

const BATCH_STEPS = 40;
const BATCH_TURNS = 4;

function useReaderLayoutPass({
	complete,
	hasBody,
	layout,
	paused,
	startTurnId,
	turnElementsRef,
	turns,
}: {
	complete: boolean;
	hasBody: (turnId: string) => boolean;
	layout: ReaderLayout;
	paused: boolean;
	startTurnId: string | undefined;
	turnElementsRef: RefObject<Map<string, HTMLElement>>;
	turns: readonly { toolCallCount?: number; turnId: string }[];
}): void {
	const stateRef = useRef({ complete, hasBody, paused, startTurnId, turns });
	stateRef.current = { complete, hasBody, paused, startTurnId, turns };
	useMountEffect(() => {
		let handle = 0;
		let startedAt = 0;
		let releasing = false;
		// Laid out for two frames more before they're let go: the browser
		// keeps a turn's size (contain-intrinsic-size: auto) only once it has
		// been rendered at it, not from a layout let go within the same frame.
		const release = (turnIds: string[]) => {
			releasing = true;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					for (const turnId of turnIds) {
						const element = turnElementsRef.current.get(turnId);
						if (!element) continue;
						if (!layout.wasDeferred(turnId)) {
							for (const listener of layout.laidOutListeners)
								listener(turnId, element);
							markLaidOut(element);
						}
						markMeasuring(element, false);
					}
					layout.finish(...turnIds);
					releasing = false;
				}),
			);
		};
		const tick = () => {
			const {
				complete: allIn,
				hasBody: ready,
				paused: hidden,
				startTurnId: start,
				turns: all,
			} = stateRef.current;
			const measuring = [...layout.getMeasuring()];
			if ((hidden && measuring.length === 0) || releasing) {
				schedule();
				return;
			}
			if (measuring.length > 0) {
				if (
					measuring.every(
						(turnId) => layout.isDone(turnId) || layout.wasDeferred(turnId),
					) ||
					performance.now() - startedAt > REPORT_WITHIN_MS
				)
					release(measuring);
				schedule();
				return;
			}
			const from = Math.max(
				all.findIndex((turn) => turn.turnId === start),
				0,
			);
			const next: string[] = [];
			let steps = 0;
			let waiting = false;
			for (let distance = 0; distance < all.length; distance++) {
				for (const index of distance === 0
					? [from]
					: [from + distance, from - distance]) {
					const turn = all[index];
					if (
						!turn ||
						layout.isLaidOut(turn.turnId) ||
						layout.isKept(turn.turnId)
					)
						continue;
					if (
						!ready(turn.turnId) ||
						layout.isDeferred(turn.turnId) ||
						layout.waitsForWhole(turn.turnId)
					) {
						waiting = true;
						continue;
					}
					const cost = turn.toolCallCount ?? 0;
					if (
						next.length > 0 &&
						(steps + cost > BATCH_STEPS || next.length >= BATCH_TURNS)
					)
						continue;
					next.push(turn.turnId);
					steps += cost;
				}
			}
			layout.setSettled(
				next.length === 0 &&
					!waiting &&
					allIn &&
					!all.some((turn) => layout.holdsSettle(turn.turnId)),
			);
			if (next.length > 0) {
				for (const turnId of next) {
					const element = turnElementsRef.current.get(turnId);
					if (element) markMeasuring(element, true);
				}
				startedAt = performance.now();
				layout.start(...next);
			}
			schedule();
		};
		const schedule = () => {
			handle =
				typeof requestIdleCallback === "function"
					? requestIdleCallback(tick, { timeout: 250 })
					: window.setTimeout(tick, 50);
		};
		schedule();
		return () => {
			if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
			window.clearTimeout(handle);
		};
	});
}

export function useReaderLayout({
	complete,
	getBody,
	isMounted,
	keptShapes,
	paused,
	startTurnId,
	turnElementsRef,
	turns,
}: {
	complete: boolean;
	getBody: (turnId: string) => { status: string };
	isMounted: (turnId: string) => boolean;
	keptShapes?: () => {
		shapes: Map<string, AttemptShape>;
		turns: Iterable<string>;
	};
	paused: boolean;
	startTurnId: string | undefined;
	turnElementsRef: RefObject<Map<string, HTMLElement>>;
	turns: readonly { toolCallCount?: number; turnId: string }[];
}): ReaderLayout {
	const [layout] = useState(() => {
		const held = keptShapes?.();
		return createReaderLayout(held?.shapes, held?.turns);
	});
	useReaderLayoutPass({
		complete,
		hasBody: (turnId) =>
			isMounted(turnId) && getBody(turnId).status !== "loading",
		layout,
		paused,
		startTurnId,
		turnElementsRef,
		turns,
	});
	return layout;
}
