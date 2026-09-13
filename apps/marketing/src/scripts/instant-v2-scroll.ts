import { usesSafariDemoMotion } from "./demo-browser";

// Safari keeps the document at the top so its native toolbar inset does not
// expose a moving page edge. All landing motion reads this same scroll owner.
export function getInstantV2ScrollContainer(): HTMLElement | null {
	return usesSafariDemoMotion(navigator.userAgent)
		? document.querySelector<HTMLElement>("[data-instant-v2-scroll]")
		: null;
}

export function getInstantV2ScrollPosition() {
	const container = getInstantV2ScrollContainer();
	return {
		x: container?.scrollLeft ?? window.scrollX,
		y: container?.scrollTop ?? window.scrollY,
	};
}
