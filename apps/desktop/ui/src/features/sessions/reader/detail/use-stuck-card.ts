import { useCallback } from "react";

function canScroll(
	element: Element | null,
	root: Element,
	event: WheelEvent,
): boolean {
	const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
	const delta = sideways ? event.deltaX : event.deltaY;
	for (let box = element; box; box = box.parentElement) {
		const style = getComputedStyle(box);
		const overflow = sideways ? style.overflowX : style.overflowY;
		if (overflow === "auto" || overflow === "scroll") {
			const position = sideways ? box.scrollLeft : box.scrollTop;
			const room = sideways
				? box.scrollWidth - box.clientWidth
				: box.scrollHeight - box.clientHeight;
			if (delta > 0 ? position < room - 1 : position > 0) return true;
		}
		if (box === root) break;
	}
	return false;
}

export function useContainedWheel() {
	return useCallback((node: HTMLElement | null) => {
		if (!node) return;
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!canScroll(target, node, event)) event.preventDefault();
		};
		node.addEventListener("wheel", onWheel, { passive: false });
		return () => node.removeEventListener("wheel", onWheel);
	}, []);
}
