import { turnElementsIn } from "../reader-dom";

export type PageSpans = { edges: number[]; end: number; ids: string };

export function readSpans(scroller: HTMLElement): PageSpans {
	const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
	const ids: string[] = [];
	const edges: number[] = [];
	for (const turn of turnElementsIn(scroller)) {
		if (turn.hidden) continue;
		const box = turn.getBoundingClientRect();
		ids.push(turn.dataset.turnId ?? "");
		edges.push(box.top - origin, box.bottom - origin);
	}
	return { edges, end: scroller.scrollHeight, ids: ids.join(" ") };
}

function along(from: readonly number[], to: readonly number[], y: number) {
	let low = 0;
	let high = from.length - 1;
	if (y <= (from[0] ?? 0)) return (to[0] ?? 0) + y - (from[0] ?? 0);
	if (y >= (from[high] ?? 0)) return (to[high] ?? 0) + y - (from[high] ?? 0);
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if ((from[middle] ?? 0) <= y) low = middle;
		else high = middle;
	}
	const x0 = from[low] ?? 0;
	const x1 = from[high] ?? 0;
	const y0 = to[low] ?? 0;
	const y1 = to[high] ?? 0;
	return x1 > x0 ? y0 + ((y - x0) / (x1 - x0)) * (y1 - y0) : y0;
}

export function continuesDrawn(
	drawn: PageSpans | null,
	now: PageSpans | null,
): boolean {
	if (!drawn || !now) return false;
	return (
		drawn.ids === now.ids ||
		(drawn.ids.length > 0 && now.ids.startsWith(`${drawn.ids} `))
	);
}

export function spanMapping(
	drawn: PageSpans | null,
	now: PageSpans | null,
): { toDrawn: (y: number) => number; toNow: (y: number) => number } | null {
	if (!drawn || !now || !continuesDrawn(drawn, now)) return null;
	const edges = now.edges.slice(0, drawn.edges.length);
	if (
		drawn.end === now.end &&
		drawn.edges.every((edge, index) => edge === edges[index])
	)
		return null;
	const from = [0, ...edges, now.end];
	const to = [0, ...drawn.edges, drawn.end];
	return {
		toDrawn: (y) => along(from, to, y),
		toNow: (y) => along(to, from, y),
	};
}
