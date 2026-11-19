import { useSyncExternalStore } from "react";

export type WelcomeRepository = {
	key: string;
	name: string;
	sessionCount: number;
	sources: string[];
};

const EMPTY: WelcomeRepository[] = [];
let current: WelcomeRepository[] = EMPTY;
const listeners = new Set<() => void>();

export function setWelcomeSelection(next: WelcomeRepository[]) {
	current = next.length ? next : EMPTY;
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useWelcomeSelection(): WelcomeRepository[] {
	return useSyncExternalStore(
		subscribe,
		() => current,
		() => EMPTY,
	);
}
