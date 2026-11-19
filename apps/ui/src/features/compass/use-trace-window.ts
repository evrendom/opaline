import { type RefObject, useLayoutEffect, useRef } from "react";
import type { SessionReaderWaterfall } from "@/features/sessions/reader/model/session-reader-run-steps";
import { readerScrollerOf } from "@/features/sessions/reader/reader-dom";
import type { Span } from "./run-lanes-model";

function scrollBoxOf(element: HTMLElement): HTMLElement | null {
	const reader = readerScrollerOf(element);
	if (reader) return reader;
	for (let box = element.parentElement; box; box = box.parentElement) {
		const { overflowY } = getComputedStyle(box);
		if (overflowY === "auto" || overflowY === "scroll") return box;
	}
	return null;
}

const placings = new Set<() => () => void>();
let placingFrame = 0;
function requestPlacing(read: () => () => void) {
	placings.add(read);
	if (placingFrame) return;
	placingFrame = requestAnimationFrame(() => {
		placingFrame = 0;
		const reads = [...placings];
		placings.clear();
		const writes = reads.map((each) => each());
		for (const write of writes) write();
	});
}

export function useTraceWindow(
	trace: RefObject<HTMLElement | null> | undefined,
	waterfall: SessionReaderWaterfall,
	view: Span,
) {
	const windowRef = useRef<HTMLSpanElement>(null);
	const agentWindowRef = useRef<HTMLSpanElement>(null);
	const runningRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const list = trace?.current;
		if (!list) return;
		const boxes = () =>
			[windowRef.current, agentWindowRef.current].filter(
				(each): each is HTMLSpanElement => each !== null,
			);
		const scroller = scrollBoxOf(list);
		const steps = new Map(waterfall.allSteps.map((step) => [step.id, step]));
		const total = Math.max(view.to - view.from, 1);
		const pct = (ms: number) =>
			Math.min(Math.max(((ms - view.from) / total) * 100, 0), 100);
		let groups: {
			box: HTMLElement | null;
			rows: { element: HTMLElement; from: number; to: number }[];
		}[] = [];
		const hide = () => {
			for (const box of boxes())
				if (!box.classList.contains("hidden")) box.classList.add("hidden");
		};
		// Whether the trace is on screen, told by the browser rather than read
		// each frame: a trace off screen sits in a turn the browser skips
		// (content-visibility), and reading its geometry made the browser style
		// that turn again, for every trace, on every scroll frame.
		let onScreen = false;
		const watch = new IntersectionObserver(
			(entries) => {
				onScreen = entries[entries.length - 1]?.isIntersecting ?? false;
				requestPlacing(place);
			},
			{ root: scroller },
		);
		watch.observe(list);
		const place = (): (() => void) => {
			if (!onScreen) return hide;
			const seen = scroller
				? scroller.getBoundingClientRect()
				: { bottom: window.innerHeight, top: 0 };
			const all = list.getBoundingClientRect();
			if (all.bottom <= seen.top || all.top >= seen.bottom) return hide;
			let from = Number.POSITIVE_INFINITY;
			let to = Number.NEGATIVE_INFINITY;
			let inView = 0;
			const shows = (at: DOMRect) =>
				at.bottom > seen.top && at.top < seen.bottom;
			for (const group of groups) {
				if (group.box && !shows(group.box.getBoundingClientRect())) continue;
				for (const row of group.rows) {
					const at = row.element.getBoundingClientRect();
					if (!shows(at)) continue;
					inView++;
					const span = Math.max(row.to - row.from, 0);
					const height = Math.max(at.height, 1);
					const above = Math.min(Math.max((seen.top - at.top) / height, 0), 1);
					const below = Math.min(
						Math.max((at.bottom - seen.bottom) / height, 0),
						1,
					);
					from = Math.min(from, row.from + span * above);
					to = Math.max(to, row.to - span * below);
				}
			}
			return () => {
				if (inView > 0) markRunning(runningRef.current, from, to);
				for (const box of boxes()) {
					box.classList.toggle("hidden", inView === 0);
					if (inView === 0) continue;
					box.style.left = `${pct(from)}%`;
					box.style.width = `${Math.max(pct(to) - pct(from), 0.5)}%`;
				}
			};
		};
		const collect = () => {
			const byBox = new Map<HTMLElement | null, (typeof groups)[number]>();
			for (const element of list.querySelectorAll<HTMLElement>(
				"[data-step-row], [data-fold-from]",
			)) {
				const step = steps.get(element.dataset.stepRow ?? "");
				const from = step
					? step.startMs
					: Number(element.dataset.foldFrom ?? Number.NaN);
				const to = step
					? (step.backgroundFromMs ?? step.endMs)
					: Number(element.dataset.foldTo ?? Number.NaN);
				if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
				const attempt = element.closest<HTMLElement>("[data-attempt]");
				let group = byBox.get(attempt);
				if (!group) {
					group = { box: attempt, rows: [] };
					byBox.set(attempt, group);
				}
				group.rows.push({ element, from, to });
			}
			groups = [...byBox.values()];
			requestPlacing(place);
		};
		collect();
		const resize = new ResizeObserver(collect);
		resize.observe(list);
		const swaps = new MutationObserver(collect);
		swaps.observe(list, { childList: true });
		const onScroll = () => requestPlacing(place);
		const target: HTMLElement | Window = scroller ?? window;
		target.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			placings.delete(place);
			watch.disconnect();
			resize.disconnect();
			swaps.disconnect();
			target.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [trace, waterfall, view.from, view.to]);
	return [windowRef, agentWindowRef, runningRef] as const;
}

function markRunning(row: HTMLElement | null, from: number, to: number) {
	if (!row) return;
	let running = 0;
	const icons = row.querySelectorAll<HTMLElement>("[data-from]");
	for (const icon of icons) {
		const on =
			Number(icon.dataset.from) <= to && Number(icon.dataset.to) >= from;
		if (icon.classList.contains("opacity-30") === on) {
			icon.classList.toggle("opacity-30", !on);
			icon.classList.toggle("grayscale", !on);
		}
		if (on) running++;
	}
	const count = row.querySelector("[data-running-count]");
	const text = `${running} of ${icons.length} working`;
	if (count && count.textContent !== text) count.textContent = text;
}
