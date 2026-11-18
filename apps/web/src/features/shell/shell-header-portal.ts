import { createContext, useContext, useLayoutEffect } from "react";

export const ShellHeaderPortalContext = createContext<HTMLElement | null>(null);

export function useShellHeaderPortal() {
	return useContext(ShellHeaderPortalContext);
}

let following = 0;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};

export const shellCrumbFollows = {
	get: () => following > 0,
	subscribe: (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};

export function useShellCrumbFollows(shown: boolean) {
	useLayoutEffect(() => {
		if (!shown) return;
		following += 1;
		emit();
		return () => {
			following -= 1;
			emit();
		};
	}, [shown]);
}
