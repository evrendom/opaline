import { useEffect, useState } from "react";

/** Gates a loading skeleton behind a delay so quick loads don't flash one.
 * Returns true only once `loading` has stayed true for `delay` ms; loads that
 * resolve sooner never show the skeleton. Render `null` (not the empty state)
 * while loading but this is still false. */
export function useDelayedLoading(loading: boolean, delay = 700): boolean {
	const [show, setShow] = useState(false);
	useEffect(() => {
		if (!loading) {
			setShow(false);
			return;
		}
		const id = setTimeout(() => setShow(true), delay);
		return () => clearTimeout(id);
	}, [loading, delay]);
	return show;
}

/** Debounces a rapidly-changing value (e.g. a search box) so the URL isn't
 * rewritten on every keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(id);
	}, [value, delay]);
	return debounced;
}
