import { useState, useSyncExternalStore } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import type { SessionTurnSelection } from "./session-turn-table-selection";

type SessionContinuousTurnVisibleRange = readonly [number, number] | undefined;
export type SessionContinuousTurnViewportPoint = {
	index: number;
	progress: number;
};
export type SessionContinuousTurnViewportTurnRange =
	| readonly [
			SessionContinuousTurnViewportPoint,
			SessionContinuousTurnViewportPoint,
	  ]
	| undefined;

type SessionContinuousTurnViewportSnapshot = {
	activeSelection: SessionTurnSelection | undefined;
	viewedSelections: readonly SessionTurnSelection[];
	visibleRange: SessionContinuousTurnVisibleRange;
};

export type SessionContinuousTurnViewportStore = {
	getSnapshot: () => SessionContinuousTurnViewportSnapshot;
	getViewportTurnRange: () => SessionContinuousTurnViewportTurnRange;
	publishSelection: (selection: SessionTurnSelection) => void;
	publishViewport: (
		activeSelection: SessionTurnSelection,
		visibleRange: readonly [number, number],
		viewedSelections: readonly SessionTurnSelection[],
		viewportTurnRange?: Exclude<
			SessionContinuousTurnViewportTurnRange,
			undefined
		>,
	) => void;
	subscribe: (listener: () => void) => () => void;
};

export function createSessionContinuousTurnViewportStore(): SessionContinuousTurnViewportStore {
	let snapshot: SessionContinuousTurnViewportSnapshot = {
		activeSelection: undefined,
		viewedSelections: [],
		visibleRange: undefined,
	};
	let viewportTurnRange: SessionContinuousTurnViewportTurnRange;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		getSnapshot: () => snapshot,
		getViewportTurnRange: () => viewportTurnRange,
		publishSelection: (selection) => {
			if (
				snapshot.activeSelection?.index === selection.index &&
				snapshot.activeSelection.speaker === selection.speaker
			) {
				return;
			}
			snapshot = {
				...snapshot,
				activeSelection: selection,
			};
			notify();
		},
		publishViewport: (
			activeSelection,
			visibleRange,
			viewedSelections,
			nextViewportTurnRange,
		) => {
			const viewedSelectionsUnchanged =
				snapshot.viewedSelections.length === viewedSelections.length &&
				snapshot.viewedSelections.every(
					(selection, index) =>
						selection.index === viewedSelections[index]?.index &&
						selection.speaker === viewedSelections[index]?.speaker,
				);
			const viewportTurnRangeUnchanged =
				viewportTurnRange?.[0].index === nextViewportTurnRange?.[0].index &&
				viewportTurnRange?.[0].progress ===
					nextViewportTurnRange?.[0].progress &&
				viewportTurnRange?.[1].index === nextViewportTurnRange?.[1].index &&
				viewportTurnRange?.[1].progress === nextViewportTurnRange?.[1].progress;
			const selectionUnchanged =
				snapshot.activeSelection?.index === activeSelection.index &&
				snapshot.activeSelection.speaker === activeSelection.speaker;
			const visibleRangeUnchanged =
				snapshot.visibleRange?.[0] === visibleRange[0] &&
				snapshot.visibleRange[1] === visibleRange[1];
			const snapshotUnchanged =
				selectionUnchanged &&
				visibleRangeUnchanged &&
				viewedSelectionsUnchanged;
			if (snapshotUnchanged && viewportTurnRangeUnchanged) {
				return;
			}
			if (!snapshotUnchanged) {
				snapshot = {
					activeSelection: selectionUnchanged
						? snapshot.activeSelection
						: activeSelection,
					viewedSelections: viewedSelectionsUnchanged
						? snapshot.viewedSelections
						: viewedSelections,
					visibleRange: visibleRangeUnchanged
						? snapshot.visibleRange
						: [visibleRange[0], visibleRange[1]],
				};
			}
			if (!viewportTurnRangeUnchanged) {
				viewportTurnRange = nextViewportTurnRange
					? [{ ...nextViewportTurnRange[0] }, { ...nextViewportTurnRange[1] }]
					: undefined;
			}
			notify();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function useSessionContinuousTurnViewportTurnRange(
	store: SessionContinuousTurnViewportStore,
) {
	return useSyncExternalStore(
		store.subscribe,
		store.getViewportTurnRange,
		store.getViewportTurnRange,
	);
}

export function useSessionContinuousTurnVisibleRange(
	store: SessionContinuousTurnViewportStore,
) {
	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().visibleRange,
		() => store.getSnapshot().visibleRange,
	);
}

export function useSessionContinuousTurnViewedSelections(
	store: SessionContinuousTurnViewportStore,
) {
	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().viewedSelections,
		() => store.getSnapshot().viewedSelections,
	);
}

export function useSessionContinuousTurnActiveSelection(
	store: SessionContinuousTurnViewportStore,
) {
	return useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().activeSelection,
		() => store.getSnapshot().activeSelection,
	);
}

export function useSessionContinuousTurnTrailingActiveSelection(
	store: SessionContinuousTurnViewportStore,
) {
	const [selection, setSelection] = useState(
		() => store.getSnapshot().activeSelection,
	);

	useMountEffect(() => {
		let timeout: number | undefined;
		const scheduleSelection = () => {
			window.clearTimeout(timeout);
			timeout = window.setTimeout(() => {
				setSelection(store.getSnapshot().activeSelection);
			}, 50);
		};
		scheduleSelection();
		const unsubscribe = store.subscribe(scheduleSelection);
		return () => {
			window.clearTimeout(timeout);
			unsubscribe();
		};
	});

	return selection;
}
