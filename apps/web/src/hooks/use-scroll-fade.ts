import { useCallback, useEffect, useState } from "react";
import "./scroll-fade.css";

export function useScrollFade<T extends HTMLElement>(axis: "x" | "y" = "y") {
	const [element, setElement] = useState<T | null>(null);
	const ref = useCallback((node: T | null) => setElement(node), []);
	const [edges, setEdges] = useState({ top: false, bottom: false });
	useEffect(() => {
		if (!element) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const top = axis === "y" ? element.scrollTop > 1 : element.scrollLeft > 1;
			const bottom =
				axis === "y"
					? element.scrollTop + element.clientHeight < element.scrollHeight - 1
					: element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
			setEdges((current) =>
				current.top === top && current.bottom === bottom
					? current
					: { top, bottom },
			);
		};
		const update = () => {
			if (frame === 0) frame = requestAnimationFrame(measure);
		};
		update();
		element.addEventListener("scroll", update, { passive: true });
		const resize =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(update);
		resize?.observe(element);
		const observed = new Set<Element>();
		const watchChildren = () => {
			for (const child of element.children) {
				if (observed.has(child)) continue;
				observed.add(child);
				resize?.observe(child);
			}
			for (const child of observed) {
				if (child.parentElement === element) continue;
				observed.delete(child);
				resize?.unobserve(child);
			}
		};
		watchChildren();
		const mutations =
			typeof MutationObserver === "undefined"
				? undefined
				: new MutationObserver(() => {
						watchChildren();
						update();
					});
		mutations?.observe(element, { childList: true });
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", update);
			resize?.disconnect();
			mutations?.disconnect();
		};
	}, [axis, element]);
	return {
		fade:
			axis === "y"
				? {
						"data-fade-bottom": edges.bottom || undefined,
						"data-fade-top": edges.top || undefined,
					}
				: { "data-fade-right": edges.bottom || undefined },
		ref,
	};
}
