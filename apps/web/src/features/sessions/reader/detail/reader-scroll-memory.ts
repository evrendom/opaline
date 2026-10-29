import { useState } from "react";
import { readerScrollerOf, readTurnMarks } from "../reader-dom";
import { jumpNearThenEaseTo } from "./reader-jump-scroll";

export type ReaderScroll = { offset: number; turnId: string };

const kept = new Map<string, ReaderScroll>();

export function useReaderOpening(
	sessionId: string,
	{
		asked,
		follows,
		subagent,
	}: { asked: string | undefined; follows: boolean; subagent: boolean },
): { resume: ReaderScroll | undefined; startTurnId: string | undefined } {
	const [resume] = useState(() => (subagent ? undefined : kept.get(sessionId)));
	return {
		resume,
		startTurnId: asked ?? (follows ? undefined : resume?.turnId),
	};
}

export function keptReaderScroll(sessionId: string): ReaderScroll | undefined {
	return kept.get(sessionId);
}

export function openAtTurn(
	answer: HTMLElement,
	turnId: string,
	resume: ReaderScroll | undefined,
) {
	const scroller = readerScrollerOf(answer);
	if (resume?.turnId !== turnId || !scroller) {
		answer.scrollIntoView({ block: "start" });
		return;
	}
	scroller.scrollTop +=
		answer.getBoundingClientRect().top -
		scroller.getBoundingClientRect().top -
		resume.offset;
}

export function keepReaderScroll(
	scroller: HTMLElement,
	sessionId: string,
	reading: {
		get: () => string | null;
		subscribe: (listener: () => void) => () => void;
	},
	answerOf: (turnId: string) => HTMLElement | null,
): () => void {
	let frame = 0;
	const keep = () => {
		frame = 0;
		const turnId = reading.get();
		const answer = turnId ? answerOf(turnId) : null;
		if (!turnId || !answer?.isConnected) return;
		kept.set(sessionId, {
			offset:
				answer.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top,
			turnId,
		});
	};
	const schedule = () => {
		frame ||= requestAnimationFrame(keep);
	};
	scroller.addEventListener("scroll", schedule, { passive: true });
	const unsubscribe = reading.subscribe(schedule);
	return () => {
		cancelAnimationFrame(frame);
		scroller.removeEventListener("scroll", schedule);
		unsubscribe();
	};
}

export function watchTurnRead(
	root: HTMLElement,
	store: { set: (turnId: string) => void },
	held: () => boolean = () => false,
): IntersectionObserver {
	const inBand = new Map<string, number>();
	return new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const { index, turnId } = readTurnMarks(entry.target as HTMLElement);
				if (!turnId) continue;
				if (entry.isIntersecting) inBand.set(turnId, Number(index));
				else inBand.delete(turnId);
			}
			let active: [string, number] | undefined;
			for (const candidate of inBand) {
				if (!active || candidate[1] < active[1]) active = candidate;
			}
			if (active && !held()) store.set(active[0]);
		},
		{ root, rootMargin: "0px 0px -75% 0px" },
	);
}

export function markScrollEdges(scroller: HTMLElement) {
	scroller.toggleAttribute("data-fade-top", scroller.scrollTop > 1);
	scroller.toggleAttribute(
		"data-fade-bottom",
		scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1,
	);
}

export function jumpToRead(
	answer: HTMLElement,
	turnId: string,
	store: { set: (turnId: string) => void },
	held: { current: boolean },
) {
	store.set(turnId);
	const scroller = readerScrollerOf(answer);
	if (!scroller) {
		answer.scrollIntoView({ block: "start" });
		return;
	}
	held.current = true;
	jumpNearThenEaseTo(scroller, answer, 0, () => {
		held.current = false;
	});
}
