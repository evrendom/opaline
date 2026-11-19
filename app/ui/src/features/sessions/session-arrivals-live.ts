import { useSyncExternalStore } from "react";

let live = false;
const listeners = new Set<() => void>();

export function setSessionArrivalsLive(next: boolean): void {
	if (live === next) return;
	live = next;
	for (const listener of listeners) listener();
}

export function sessionArrivalsLive(): boolean {
	return live;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useSessionArrivalsLive(): boolean {
	return useSyncExternalStore(subscribe, sessionArrivalsLive, () => false);
}

export function pollUnlessPushed(
	pushed: boolean,
	everyMs: number,
	pushedEveryMs: number | false = false,
): number | false {
	return pushed ? pushedEveryMs : everyMs;
}
