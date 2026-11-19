import { type RefObject, useState } from "react";
import { readerContentOf, readerScrollerOf } from "../reader-dom";
import { answerOf } from "./reader-jump-scroll";

// A page opened at a turn (`?turn=`) stays at it while the turns above it
// change height: their bodies landing, their subagents' steps, the layout
// pass giving each its real size. The browser's scroll anchoring keeps most
// of it, but not all (it lets go of some changes, as while a turn's
// content-visibility is lifted to be measured). So, until the reader moves
// the page themselves, each time a turn changes size the page is moved back
// by however far the turn opened at has moved.

export function pinTurn(
	scroller: HTMLElement,
	target: () => HTMLElement | null,
	turns: Iterable<HTMLElement>,
	onLetGo: () => void,
): () => void {
	const viewTop = () => scroller.getBoundingClientRect().top;
	const first = target();
	if (!first) return () => {};
	const at = first.getBoundingClientRect().top - viewTop();
	const hold = () => {
		const element = target();
		if (!element?.isConnected) return;
		const moved = element.getBoundingClientRect().top - viewTop() - at;
		if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
	};
	const resize = new ResizeObserver(hold);
	for (const turn of turns) resize.observe(turn);
	const content = readerContentOf(scroller);
	if (content) resize.observe(content);
	const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
	const page = scroller.ownerDocument;
	const release = () => {
		resize.disconnect();
		for (const type of inputs) page.removeEventListener(type, letGo, true);
	};
	const letGo = () => {
		release();
		onLetGo();
	};
	for (const type of inputs)
		page.addEventListener(type, letGo, { capture: true, passive: true });
	return release;
}

export function useTurnPin(
	turnElementsRef: RefObject<Map<string, HTMLElement>>,
) {
	const [turnPin] = useState(() => {
		const pinnedRef: { current: string | undefined } = { current: undefined };
		let release = () => {};
		return {
			pin: (element: HTMLElement, turnId: string) => {
				pinnedRef.current = turnId;
				const scroller = readerScrollerOf(element);
				if (!scroller) return;
				release();
				release = pinTurn(
					scroller,
					() => answerOf(element),
					turnElementsRef.current.values(),
					() => {
						pinnedRef.current = undefined;
					},
				);
			},
			pinnedRef,
			release: () => release(),
		};
	});
	return turnPin;
}
