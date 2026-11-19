import { type RefObject, useLayoutEffect, useState } from "react";

const MIN_CARD_PX = 170;
const GAP_PX = 16;

export function balancedColumns(
	count: number,
	width: number,
	minimum = MIN_CARD_PX,
	gap = GAP_PX,
): number {
	if (count <= 1) return 1;
	const fits = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
	const rows = Math.ceil(count / Math.min(count, fits));
	return Math.ceil(count / rows);
}

export function useBalancedColumns(
	ref: RefObject<HTMLElement | null>,
	cards: string,
): number | null {
	const [columns, setColumns] = useState<number | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = () =>
			setColumns(
				balancedColumns(
					element.querySelectorAll(cards).length,
					element.clientWidth,
				),
			);
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const children = new MutationObserver(measure);
		children.observe(element, { childList: true });
		return () => {
			resize.disconnect();
			children.disconnect();
		};
	}, [ref, cards]);
	return columns;
}
