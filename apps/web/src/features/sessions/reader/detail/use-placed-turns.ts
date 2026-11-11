import type { LegendListRef } from "@legendapp/list/react";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { setPlacedTurns } from "../reader-dom";
import { estimateTurnPx, TURN_GAP_PX } from "./reader-turns-pending";

export function usePlacedTurns({
	isFrustrated,
	isTurnHidden,
	listRef,
	scrollElement,
	turnElementsRef,
	turns,
}: {
	isFrustrated: (turn: SessionDetailTurnSummary) => boolean;
	isTurnHidden: (turn: SessionDetailTurnSummary) => boolean;
	listRef: RefObject<LegendListRef | null>;
	scrollElement: HTMLElement | null;
	turnElementsRef: RefObject<Map<string, HTMLElement>>;
	turns: readonly SessionDetailTurnSummary[];
}): void {
	const placingRef = useRef({
		isFrustrated,
		isTurnHidden,
		turns,
	});
	placingRef.current = {
		isFrustrated,
		isTurnHidden,
		turns,
	};
	useLayoutEffect(() => {
		if (!scrollElement) return;
		return setPlacedTurns(scrollElement, () => {
			const state = listRef.current?.getState();
			const {
				isFrustrated,
				isTurnHidden: hiddenOf,
				turns: all,
			} = placingRef.current;
			if (!state || all.length === 0) return null;
			const scrollerTop =
				scrollElement.getBoundingClientRect().top - scrollElement.scrollTop;
			const indexes = new Map(all.map((turn, index) => [turn.turnId, index]));
			let origin: number | null = null;
			for (const [turnId, element] of turnElementsRef.current) {
				const index = indexes.get(turnId);
				if (index === undefined) continue;
				origin =
					element.getBoundingClientRect().top -
					scrollerTop -
					state.positionAtIndex(index);
				break;
			}
			if (origin === null) return null;
			const listTop = origin;
			return all.map((turn, index) => {
				const marks = {
					apology: (turn.modelApologyCount ?? turn.modelSignalCount) > 0,
					errors: turn.errorCount > 0,
					frustrated: isFrustrated(turn),
				};
				const element = turnElementsRef.current.get(turn.turnId);
				if (element) {
					const box = element.getBoundingClientRect();
					return {
						bottom: box.bottom - scrollerTop,
						element,
						marks,
						top: box.top - scrollerTop,
						turnId: turn.turnId,
					};
				}
				const top = listTop + state.positionAtIndex(index);
				const next = all[index + 1]
					? state.positionAtIndex(index + 1)
					: undefined;
				const size = Number.isFinite(state.sizeAtIndex(index))
					? state.sizeAtIndex(index)
					: next !== undefined && Number.isFinite(next)
						? next - state.positionAtIndex(index)
						: estimateTurnPx(turn) + TURN_GAP_PX;
				const height = hiddenOf(turn) ? 0 : Math.max(size - TURN_GAP_PX, 0);
				return {
					bottom: top + height,
					element: undefined,
					marks,
					top,
					turnId: turn.turnId,
				};
			});
		});
	}, [listRef, scrollElement, turnElementsRef]);
}

export function turnKey(turn: SessionDetailTurnSummary) {
	return turn.turnId;
}

export function turnSizeType(turn: SessionDetailTurnSummary) {
	return `turn:${Math.round(Math.log2(Math.max(estimateTurnPx(turn), 1)))}`;
}
