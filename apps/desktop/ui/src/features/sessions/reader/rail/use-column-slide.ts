import { useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import "./column-slide.css";

const NAME = "column-slide";

export function useColumnSlide<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const slide = useCallback((forward: boolean, update: () => void) => {
		const element = ref.current;
		const root = document.documentElement;
		if (
			!element ||
			typeof document.startViewTransition !== "function" ||
			root.dataset.columnSlide ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			update();
			return;
		}
		element.style.viewTransitionName = NAME;
		root.dataset.columnSlide = forward ? "forward" : "back";
		const transition = document.startViewTransition(() => flushSync(update));
		transition.finished.finally(() => {
			element.style.viewTransitionName = "";
			delete root.dataset.columnSlide;
		});
	}, []);
	return { ref, slide };
}
