import { startTransition, useCallback, useLayoutEffect, useState } from "react";

const FIRST_RADIUS = 1;
const STEP = 3;

export function useMountedTurns(
	turns: readonly { turnId: string }[],
	startTurnId: string | undefined,
): (index: number) => boolean {
	const [start] = useState(() => {
		const index = turns.findIndex((turn) => turn.turnId === startTurnId);
		return index >= 0 ? index : Math.max(turns.length - 1, 0);
	});
	const [radius, setRadius] = useState(FIRST_RADIUS);
	const covers = start - radius <= 0 && start + radius >= turns.length - 1;
	useLayoutEffect(() => {
		if (covers) return;
		const next = radius + STEP;
		let timer = 0;
		const grow = () => {
			timer = window.setTimeout(() => startTransition(() => setRadius(next)));
		};
		let frame = 0;
		if (radius === FIRST_RADIUS) frame = requestAnimationFrame(grow);
		else grow();
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
		};
	}, [covers, radius]);
	return useCallback(
		(index: number) => Math.abs(index - start) <= radius,
		[start, radius],
	);
}
