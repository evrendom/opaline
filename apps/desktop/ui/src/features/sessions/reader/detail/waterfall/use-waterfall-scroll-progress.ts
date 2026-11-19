import { useCallback, useRef } from "react";

// While a turn's waterfall scrolls up under its frozen header, each frozen
// row's bar shows how far what it sums has been read: the header's root row
// over the top-level rows, and each open subagent call or fold — frozen just
// below it while its own rows go by — over those. A row gone wholly out of
// sight under the frozen row above it is laid into that row's bar (see
// ProgressBar); a whole group that has gone by reads there as its one bar.
// Driven by direct style writes, like the hover cursor, so scrolling never
// re-renders the rows.

/** The last of `items` gone wholly above `edge` — they run top to bottom, so
 * their bottoms rise in order and a binary search finds it; -1 for none. */
function lastAbove(items: readonly Element[], edge: number): number {
	let low = 0;
	let high = items.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if ((items[mid] as Element).getBoundingClientRect().bottom <= edge) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

/** A marked bar's color as a step: its own, or a summing bar's base fill. */
function markColor(mark: HTMLElement): string {
	if (mark.dataset.color) return mark.dataset.color;
	const base = mark.querySelector<HTMLElement>("[data-progress-base]");
	return getComputedStyle(base ?? mark).backgroundColor;
}

/** Fill `host` (a ProgressBar) for the rows under the frozen `head`. */
function syncLevel(
	head: Element,
	items: readonly Element[],
	host: HTMLElement,
) {
	const under = lastAbove(items, head.getBoundingClientRect().bottom);
	// A row's own bar, or — for a group — its frozen row's, which comes first.
	const mark = items[under]?.querySelector<HTMLElement>("[data-mark]");
	const fill = host.querySelector<HTMLElement>(":scope > [data-progress-fill]");
	const step = host.querySelector<HTMLElement>(":scope > [data-progress-step]");
	if (!mark || !fill || !step) {
		delete host.dataset.progress;
		return;
	}
	// Track percentages, into the host's own span.
	const hostLeft = Number(host.dataset.left);
	const hostWidth = Math.max(Number(host.dataset.width), 0.001);
	const left = Math.min(
		Math.max(((Number(mark.dataset.left) - hostLeft) / hostWidth) * 100, 0),
		100,
	);
	host.dataset.progress = "";
	fill.style.width = `${left}%`;
	step.style.left = `${left}%`;
	step.style.width = `${(Number(mark.dataset.width) / hostWidth) * 100}%`;
	step.style.backgroundColor = markColor(mark);
}

/**
 * Refs for the frozen header, the rows that scroll under it and the root
 * row's ProgressBar. Each row marks its bar `[data-mark]` with its place on
 * the track (`data-left`, `data-width`); each open group is a `[data-group]`
 * whose first child is its frozen row. Sets `--frozen-top` — the header's
 * height, where the groups freeze — on the header's parent.
 */
export function useWaterfallScrollProgress() {
	const rowsRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	const headerRef = useCallback((header: HTMLDivElement | null) => {
		if (!header) return;
		const measure = new ResizeObserver(() => {
			header.parentElement?.style.setProperty(
				"--frozen-top",
				`${header.offsetHeight}px`,
			);
		});
		measure.observe(header);
		let frame = 0;
		const sync = () => {
			frame = 0;
			const rows = rowsRef.current;
			if (!rows || !barRef.current) return;
			syncLevel(header, [...rows.children], barRef.current);
			for (const group of rows.querySelectorAll("[data-group]")) {
				const [head, ...items] = group.children;
				const host = head?.querySelector<HTMLElement>("[data-progress-host]");
				if (head && host) syncLevel(head, items, host);
			}
		};
		// Whichever element scrolls the reader: scroll doesn't bubble, but it
		// does pass the document on the way down.
		const onScroll = () => {
			if (!frame && rowsRef.current) frame = requestAnimationFrame(sync);
		};
		document.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			measure.disconnect();
			document.removeEventListener("scroll", onScroll, { capture: true });
			cancelAnimationFrame(frame);
		};
	}, []);
	return { barRef, headerRef, rowsRef };
}
