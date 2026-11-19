import { useCallback, useEffect, useRef } from "react";

export function useSharedWidth() {
	const columns = useRef(new Set<HTMLElement>());
	const observer = useRef<ResizeObserver | null>(null);
	const align = useCallback(() => {
		const all = [...columns.current];
		for (const column of all) column.style.minWidth = "";
		const widest = Math.max(0, ...all.map((column) => column.offsetWidth));
		for (const column of all) column.style.minWidth = `${widest}px`;
	}, []);
	useEffect(() => () => observer.current?.disconnect(), []);
	return useCallback(
		(node: HTMLElement | null) => {
			if (!node) return;
			columns.current.add(node);
			observer.current ??= new ResizeObserver(align);
			observer.current.observe(node);
			return () => {
				columns.current.delete(node);
				observer.current?.unobserve(node);
			};
		},
		[align],
	);
}
