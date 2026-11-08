import { useLayoutEffect } from "react";
import { readerScrollerOf } from "../reader-dom";

const BOTTOM_PX = 8;
const MIN_PX = 160;

export function useFillToViewBottom(element: HTMLElement | null, on: boolean) {
	useLayoutEffect(() => {
		const scroller = readerScrollerOf(element);
		if (!on || !element || !scroller) return;
		let frame = 0;
		const pinnedAt = stickyTopOf(element, scroller);
		const fitToBottom = () => {
			frame = 0;
			const view = scroller.getBoundingClientRect();
			const top = Math.max(
				element.getBoundingClientRect().top,
				view.top + pinnedAt,
			);
			const height = view.bottom - BOTTOM_PX - top;
			const next = `${Math.max(Math.round(height), MIN_PX)}px`;
			if (element.style.height !== next) element.style.height = next;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(fitToBottom);
		};
		fitToBottom();
		scroller.addEventListener("scroll", schedule, { passive: true });
		const resize = new ResizeObserver(schedule);
		resize.observe(scroller);
		const content = scroller.firstElementChild;
		if (content) resize.observe(content);
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", schedule);
			resize.disconnect();
			element.style.height = "";
		};
	}, [element, on]);
}

function stickyTopOf(element: HTMLElement, scroller: HTMLElement) {
	for (
		let node = element.parentElement;
		node && node !== scroller;
		node = node.parentElement
	) {
		const style = getComputedStyle(node);
		if (style.position === "sticky") return Number.parseFloat(style.top) || 0;
	}
	return 0;
}
