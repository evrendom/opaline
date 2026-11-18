import { TURN_ANSWER } from "../reader-dom";

const JUMP_MS = 220;
const JUMP_NEAR_BEYOND_VIEWS = 1.5;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const TAKEOVERS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
const running = new WeakMap<HTMLElement, () => void>();

export function jumpNearThenEase(
	scroller: HTMLElement,
	target: () => number,
	onDone?: () => void,
) {
	running.get(scroller)?.();
	const clamp = (top: number) =>
		Math.min(Math.max(top, 0), scroller.scrollHeight - scroller.clientHeight);
	if (matchMedia(REDUCED_MOTION).matches) {
		scroller.scrollTop = clamp(target());
		if (onDone) requestAnimationFrame(onDone);
		return;
	}
	const lead = scroller.clientHeight;
	const first = clamp(target());
	const distance = first - scroller.scrollTop;
	if (Math.abs(distance) > lead * JUMP_NEAR_BEYOND_VIEWS)
		scroller.scrollTop = first - Math.sign(distance) * lead;
	const from = scroller.scrollTop;
	const start = performance.now();
	let frame = 0;
	const stop = () => {
		cancelAnimationFrame(frame);
		running.delete(scroller);
		for (const type of TAKEOVERS) scroller.removeEventListener(type, stop);
		onDone?.();
	};
	const step = (now: number) => {
		const t = Math.min((now - start) / JUMP_MS, 1);
		scroller.scrollTop = from + (clamp(target()) - from) * (1 - (1 - t) ** 3);
		if (t < 1) frame = requestAnimationFrame(step);
		else stop();
	};
	for (const type of TAKEOVERS)
		scroller.addEventListener(type, stop, { passive: true });
	running.set(scroller, stop);
	frame = requestAnimationFrame(step);
}

export function jumpNearThenEaseTo(
	scroller: HTMLElement,
	element: HTMLElement,
	at = 0,
	onDone?: () => void,
) {
	const margin =
		at === 0
			? Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0
			: 0;
	jumpNearThenEase(
		scroller,
		() => {
			const view = scroller.getBoundingClientRect();
			const box = element.getBoundingClientRect();
			return (
				scroller.scrollTop +
				box.top -
				view.top -
				(view.height - box.height) * at -
				margin
			);
		},
		onDone,
	);
}

export function answerOf(turnElement: HTMLElement): HTMLElement {
	return turnElement.querySelector<HTMLElement>(TURN_ANSWER) ?? turnElement;
}
