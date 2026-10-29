import { useLayoutEffect } from "react";

const holders = new Map<string, number>();

/**
 * Marks `<html>` with a data attribute while the calling component is mounted,
 * so page-level CSS can style `html`/`body` for that surface. An ancestor
 * `:has()` would do the same with no code, but Chrome then re-checks it on
 * every DOM change anywhere in the page: in the session reader that restyled
 * thousands of elements per scroll frame. Counted, so two holders of one mark
 * (the loading screen and the shell) can overlap.
 */
export function useRootMark(attribute: string, active = true) {
	useLayoutEffect(() => {
		if (!active) return;
		const root = document.documentElement;
		holders.set(attribute, (holders.get(attribute) ?? 0) + 1);
		root.setAttribute(attribute, "");
		return () => {
			const left = (holders.get(attribute) ?? 1) - 1;
			if (left > 0) {
				holders.set(attribute, left);
				return;
			}
			holders.delete(attribute);
			root.removeAttribute(attribute);
		};
	}, [attribute, active]);
}

export function RootMark({ attribute }: { attribute: string }) {
	useRootMark(attribute);
	return null;
}
