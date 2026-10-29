import { useLayoutEffect } from "react";
import { readerScrollerOf } from "../reader-dom";

const BOTTOM_PX = 8;
const MIN_PX = 160;

export function useFillToViewBottom(element: HTMLElement | null, on: boolean) {
	useLayoutEffect(() => {
		const scroller = readerScrollerOf(element);
		if (!on || !element || !scroller) return;
		let frame = 0;
		const fit = () => {
			frame = 0;
			const bottom = scroller.getBoundingClientRect().bottom - BOTTOM_PX;
			const height = bottom - element.getBoundingClientRect().top;
			const next = `${Math.max(Math.round(height), MIN_PX)}px`;
			if (element.style.height !== next) element.style.height = next;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(fit);
		};
		fit();
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
