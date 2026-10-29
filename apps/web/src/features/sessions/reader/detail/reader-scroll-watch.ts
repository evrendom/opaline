import type { ActiveTurnStore } from "../rail/session-reader-turn-rail";
import { KEEPS_PICK_TARGET, readTurnMarks } from "../reader-dom";
import {
	keepReaderScroll,
	markScrollEdges,
	watchTurnRead,
} from "./reader-scroll-memory";
import { attachReaderFollower } from "./session-reader-follow";

export function watchReaderScroll(
	element: HTMLElement,
	reader: {
		answerOf: (turnId: string) => HTMLElement | null;
		isFollowing: () => boolean;
		isJumping: () => boolean;
		letGo: () => void;
		reading: ActiveTurnStore;
		requestBody: (turnId: string) => void;
		sessionId: string;
		startAtEnd: boolean;
		turns: Iterable<HTMLElement>;
	},
): {
	bodies: IntersectionObserver;
	spy: IntersectionObserver;
	stop: () => void;
} {
	const detachFollower = attachReaderFollower(element, {
		isFollowing: reader.isFollowing,
		startAtEnd: reader.startAtEnd,
	});
	const letGo = (event: PointerEvent) => {
		const target = event.target;
		if (target instanceof Element && !target.closest(KEEPS_PICK_TARGET))
			reader.letGo();
	};
	element.addEventListener("pointerdown", letGo);
	const fadeTop = () => markScrollEdges(element);
	fadeTop();
	element.addEventListener("scroll", fadeTop, { passive: true });
	const bodies = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const { turnId } = readTurnMarks(entry.target as HTMLElement);
				if (entry.isIntersecting && turnId) reader.requestBody(turnId);
			}
		},
		{ root: element, rootMargin: "1200px 0px" },
	);
	const spy = watchTurnRead(element, reader.reading, reader.isJumping);
	const unkeep = keepReaderScroll(
		element,
		reader.sessionId,
		reader.reading,
		reader.answerOf,
	);
	for (const turn of reader.turns) {
		bodies.observe(turn);
		spy.observe(turn);
	}
	return {
		bodies,
		spy,
		stop: () => {
			unkeep();
			detachFollower();
			element.removeEventListener("pointerdown", letGo);
			element.removeEventListener("scroll", fadeTop);
			bodies.disconnect();
			spy.disconnect();
		},
	};
}
