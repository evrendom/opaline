import { markSubagentProgress } from "../subagents/session-reader-subagent-chip";
import type { Part } from "./session-reader-minimap-line";

export function markReading(
	scroller: HTMLElement,
	top: number,
	height: number,
	spans: Parameters<typeof markSubagentProgress>[2],
) {
	const end = Math.max(scroller.scrollHeight - scroller.clientHeight, 1);
	const reading = top + height * Math.min(scroller.scrollTop / end, 1);
	markSubagentProgress(scroller, reading, spans);
	return reading;
}

export function keyed<T>(items: readonly T[], kind: (item: T) => string) {
	const counts = new Map<string, number>();
	return items.map((item) => {
		const base = kind(item);
		const count = (counts.get(base) ?? 0) + 1;
		counts.set(base, count);
		return { ...item, key: `${base}:${count}` };
	});
}

export type Drawn = {
	easing?: boolean;
	height: number;
	parts: Part[];
	scale: number;
	width: number;
};

export function movesOnMap(last: Drawn, next: Drawn): boolean {
	if (
		last.width !== next.width ||
		last.height !== next.height ||
		last.parts.length !== next.parts.length
	)
		return true;
	return next.parts.some((part, index) => {
		const before = last.parts[index] as Part;
		return (
			before.kind !== part.kind ||
			before.frustrated !== part.frustrated ||
			before.apologized !== part.apologized ||
			(before.errors?.length ?? 0) !== (part.errors?.length ?? 0) ||
			(before.marks?.length ?? 0) !== (part.marks?.length ?? 0) ||
			Math.abs(before.top * last.scale - part.top * next.scale) >= 0.5 ||
			Math.abs(before.height * last.scale - part.height * next.scale) >= 0.5
		);
	});
}

const EASE_MS = 300;
const BOX_EASE = `transform ${EASE_MS}ms var(--motion-easing), height ${EASE_MS}ms var(--motion-easing)`;
const LIT_EASE = `y ${EASE_MS}ms var(--motion-easing), height ${EASE_MS}ms var(--motion-easing)`;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function minimapBox(
	view: HTMLElement,
	lit: () => SVGRectElement | null,
	drawnBefore: () => boolean,
) {
	let unease = 0;
	const hold = () => {
		window.clearTimeout(unease);
		view.style.transition = "";
		lit()?.style.setProperty("transition", "");
	};
	return {
		ease() {
			if (!drawnBefore() || matchMedia(REDUCED_MOTION).matches) return;
			view.style.transition = BOX_EASE;
			lit()?.style.setProperty("transition", LIT_EASE);
			window.clearTimeout(unease);
			unease = window.setTimeout(hold, EASE_MS + 20);
		},
		hold,
		place(top: number, height: number) {
			view.style.transform = `translateY(${top}px)`;
			view.style.height = `${height}px`;
			const rect = lit();
			if (!rect) return;
			rect.setAttribute("y", String(top));
			rect.setAttribute("height", String(height));
			rect.style.setProperty("y", `${top}px`);
			rect.style.setProperty("height", `${height}px`);
		},
	};
}
