import { type RefObject, useLayoutEffect, useRef } from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { answerOf } from "./reader-jump-scroll";
import { keptReaderScroll, openAtTurn } from "./reader-scroll-memory";

export function useMainThreadReturn({
	focus,
	onReturn,
	pendingTurnIdRef,
	sessionId,
	turnElementsRef,
}: {
	focus: string | null;
	onReturn: (element: HTMLElement, turnId: string) => void;
	pendingTurnIdRef: RefObject<string | undefined>;
	sessionId: string;
	turnElementsRef: RefObject<Map<string, HTMLElement>>;
}) {
	const lastRef = useRef(focus);
	const onReturnRef = useLatestValueRef(onReturn);
	useLayoutEffect(() => {
		const left = lastRef.current !== null && focus === null;
		lastRef.current = focus;
		if (!left) return;
		const kept = keptReaderScroll(sessionId);
		const turnId = pendingTurnIdRef.current ?? kept?.turnId;
		const element = turnId ? turnElementsRef.current.get(turnId) : undefined;
		if (!turnId || !element) return;
		pendingTurnIdRef.current = undefined;
		openAtTurn(answerOf(element), turnId, kept);
		onReturnRef.current(element, turnId);
	}, [focus, onReturnRef, pendingTurnIdRef, sessionId, turnElementsRef]);
}
