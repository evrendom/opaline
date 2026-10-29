import type { RefObject } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import type { RunUiStore } from "../model/session-reader-run-ui-store";
import { readerScrollerOf } from "../reader-dom";
import { CALL_PARAM, TURN_PARAM } from "../reader-params";
import { jumpNearThenEaseTo } from "./reader-jump-scroll";
import { pinTurn, type useTurnPin } from "./reader-turn-pin";

const WAIT_MS = 15_000;

export function useReaderOpenCall(
	runUi: RunUiStore,
	searchParams: URLSearchParams,
	turnPin: ReturnType<typeof useTurnPin>,
	turnElementsRef: RefObject<Map<string, HTMLElement>>,
) {
	useMountEffect(() => {
		const call = searchParams.get(CALL_PARAM);
		const turn = searchParams.get(TURN_PARAM);
		if (!call || !turn) return;
		runUi.pick(turn, call);
		const selector = `[data-step-row="${CSS.escape(call)}"]`;
		const rowOf = () => document.querySelector<HTMLElement>(selector);
		let frame = 0;
		let release = () => {};
		const until = performance.now() + WAIT_MS;
		const find = () => {
			const row = rowOf();
			const scroller = readerScrollerOf(row);
			if (!row || !scroller) {
				if (performance.now() < until) frame = requestAnimationFrame(find);
				return;
			}
			turnPin.release();
			turnPin.pinnedRef.current = undefined;
			jumpNearThenEaseTo(scroller, row, 0.5, () => {
				release = pinTurn(
					scroller,
					rowOf,
					turnElementsRef.current.values(),
					() => {},
				);
			});
		};
		frame = requestAnimationFrame(find);
		return () => {
			cancelAnimationFrame(frame);
			release();
		};
	});
}
