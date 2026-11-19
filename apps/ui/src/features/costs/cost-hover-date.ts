import { createContext, useContext, useSyncExternalStore } from "react";

export type HoverDateStore = {
	get: () => string | null;
	set: (date: string | null) => void;
	subscribe: (listener: () => void) => () => void;
};

export function createHoverDateStore(): HoverDateStore {
	let date: string | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => date,
		set: (next) => {
			if (next === date) return;
			date = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const HoverDateContext = createContext<HoverDateStore | null>(null);

const idle = () => () => {};

export function useHoverDate() {
	const store = useContext(HoverDateContext);
	return useSyncExternalStore(
		store?.subscribe ?? idle,
		() => store?.get() ?? null,
		() => null,
	);
}

export function useHoverDateStore() {
	return useContext(HoverDateContext);
}

export type DotPick = { date: string; end: string };

export const DotPickContext = createContext<{
	picked: DotPick | null;
	pick: (next: DotPick | null) => void;
} | null>(null);

export function useDotPick() {
	return useContext(DotPickContext);
}

export const DotPreviewContext = createContext<
	((next: DotPick | null) => void) | null
>(null);

export function useMarkedDate() {
	const hovered = useHoverDate();
	const picked = useContext(DotPickContext)?.picked?.date ?? null;
	return hovered ?? picked;
}
