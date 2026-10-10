import { useSyncExternalStore } from "react";
import type { ActiveTurnStore } from "./session-reader-turn-rail";
import { WHOLE_TURN_ID } from "./session-reader-waterfall";

// What the reader remembers about each turn's run — whether its waterfall is
// open, which step is selected, which step kinds it shows — and which turn the
// right pane shows: the one being read until something is picked — a row in
// a waterfall, or a turn in the rail — and from then on the last pick, however
// far the reading moves. An external store, so a click in one waterfall
// re-renders that turn and the pane, not every turn in the session.

export type RunUiState = {
	filter: ReadonlySet<string>;
	open: boolean;
	/** Whether the selection was picked — a row clicked, or the turn in the
	 * rail — rather than the whole run the pane starts on. Only a picked one
	 * looks selected in the waterfall; reading along selects nothing. */
	picked: boolean;
	selected: string;
};

const INITIAL: RunUiState = {
	filter: new Set(),
	open: false,
	picked: false,
	selected: WHOLE_TURN_ID,
};

export type RunUiStore = ReturnType<typeof createRunUiStore>;

export function createRunUiStore(turnInView: ActiveTurnStore) {
	const states = new Map<string, RunUiState>();
	const listeners = new Set<() => void>();
	let focusedTurnId: string | null = turnInView.get();
	let hasPicked = false;
	const emit = () => {
		for (const listener of listeners) listener();
	};
	// Until something is picked, scrolling to another turn moves the pane
	// along with the reading.
	turnInView.subscribe(() => {
		const next = turnInView.get();
		if (hasPicked || next === focusedTurnId) return;
		focusedTurnId = next;
		emit();
	});
	return {
		focus(turnId: string) {
			if (turnId === focusedTurnId) return;
			focusedTurnId = turnId;
			emit();
		},
		get: (turnId: string): RunUiState => states.get(turnId) ?? INITIAL,
		getFocusedTurnId: () => focusedTurnId,
		/** Pick a row — a step, or the whole run — for the pane to show,
		 * holding it there until the next pick. */
		pick(turnId: string, stepId: string) {
			const current = states.get(turnId) ?? INITIAL;
			states.set(turnId, { ...current, picked: true, selected: stepId });
			focusedTurnId = turnId;
			hasPicked = true;
			emit();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		/** Change a turn's state — opening or folding it, filtering it —
		 * leaving the pane where it is. */
		update(turnId: string, change: (state: RunUiState) => Partial<RunUiState>) {
			const current = states.get(turnId) ?? INITIAL;
			states.set(turnId, { ...current, ...change(current) });
			emit();
		},
	};
}

export function useRunUi(store: RunUiStore, turnId: string): RunUiState {
	const get = () => store.get(turnId);
	return useSyncExternalStore(store.subscribe, get, get);
}

/** Whether the right pane is showing this turn — re-rendering only the turns
 * that gain or lose it, not every turn when it moves. */
export function useIsFocusedTurn(store: RunUiStore, turnId: string): boolean {
	const get = () => store.getFocusedTurnId() === turnId;
	return useSyncExternalStore(store.subscribe, get, get);
}

export function useFocusedTurnId(store: RunUiStore): string | null {
	return useSyncExternalStore(
		store.subscribe,
		store.getFocusedTurnId,
		store.getFocusedTurnId,
	);
}

export function toggleFilterKey(
	filter: ReadonlySet<string>,
	key: string,
): ReadonlySet<string> {
	const next = new Set(filter);
	if (!next.delete(key)) next.add(key);
	return next;
}
