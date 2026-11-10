import { createContext, useLayoutEffect, useState } from "react";
import { subagentDoneAt } from "./session-reader-subagent-done";
import "./session-reader-frozen-subagents.css";
import {
	KEEPS_PICK,
	readerContentOf,
	readerScrollerOf,
	readTurnMarks,
	turnElementOf,
	turnElementsIn,
} from "../reader-dom";

export const FrozenSubagentsContext = createContext<HTMLElement | null>(null);

export const LaunchedSubagentsContext = createContext<HTMLElement | null>(null);

const GAP_PX = 12;
const STARTED_ROW = "[data-start-ms]";

const LINE_PX = 16;

type Span = { from: number; to: number };

function spanOf(visible: Iterable<HTMLElement>): Span | null {
	let from = Number.POSITIVE_INFINITY;
	let to = Number.NEGATIVE_INFINITY;
	for (const row of visible) {
		if (!row.isConnected) continue;
		const ms = Number(row.dataset.startMs);
		from = Math.min(from, ms);
		to = Math.max(to, ms);
	}
	return Number.isFinite(from) ? { from, to } : null;
}

function launchedOf(scroller: HTMLElement, wrap: HTMLElement) {
	const id = wrap.dataset.frozenWrap ?? "";
	return scroller.querySelector<HTMLElement>(
		`[data-launched-subagent="${CSS.escape(id)}"]`,
	);
}

function layOut(
	scroller: HTMLElement,
	root: HTMLElement,
	slot: HTMLElement,
	pushed: Set<HTMLElement>,
) {
	const origin = root.getBoundingClientRect().top;
	const turns = turnElementsIn(scroller);
	const push = new Map<HTMLElement, number>();
	for (const wrap of slot.querySelectorAll<HTMLElement>("[data-frozen-wrap]")) {
		const launched = launchedOf(scroller, wrap);
		const held = launched?.closest<HTMLElement>(KEEPS_PICK);
		const column = held?.parentElement;
		const turn = launched ? turnElementOf(launched) : null;
		if (!launched || !held || !column || !turn || turn.hidden) {
			wrap.classList.add("hidden");
			continue;
		}
		const columnEnd = column.getBoundingClientRect().bottom;
		if (columnEnd > turn.getBoundingClientRect().bottom + 1) {
			wrap.classList.add("hidden");
			continue;
		}
		const card = launched.offsetHeight;
		const from = Number(wrap.dataset.frozenFrom);
		const to = Number(wrap.dataset.frozenTo);
		const later = turns.slice(turns.indexOf(turn) + 1);
		const done = subagentDoneAt(column, columnEnd, null, to, later, null);
		const top = columnEnd - card - origin;
		wrap.style.top = `${top}px`;
		const view = scroller.getBoundingClientRect();
		const heldTop = Number.parseFloat(getComputedStyle(held).top) || LINE_PX;
		const letGo =
			scroller.scrollTop +
			(columnEnd - held.getBoundingClientRect().height) -
			(view.top + heldTop);
		const sticky = wrap.querySelector<HTMLElement>("[data-frozen-subagent]");
		const line =
			(sticky && Number.parseFloat(getComputedStyle(sticky).top)) || LINE_PX;
		const atLine = scroller.scrollTop + (columnEnd - card) - (view.top + line);
		const handoff = (letGo + atLine) / 2;
		for (const each of [launched, wrap])
			each.style.setProperty("--frozen-handoff", `${handoff}px`);
		const doneIn = later.find((each) => {
			const box = each.getBoundingClientRect();
			return box.top <= done && done < box.bottom;
		});
		const doneHeld = doneIn?.querySelector<HTMLElement>(KEEPS_PICK);
		const letsGo = doneHeld?.parentElement
			? Math.min(
					done,
					doneHeld.parentElement.getBoundingClientRect().bottom -
						doneHeld.offsetHeight -
						GAP_PX,
				)
			: done;
		wrap.style.height = `${Math.max(letsGo - origin - top, card)}px`;
		wrap.classList.remove("hidden");
		for (const each of later) {
			const started = readTurnMarks(each).startMs;
			if ((started > from && started < to) || each === doneIn)
				push.set(each, (push.get(each) ?? 0) + card + GAP_PX);
		}
	}
	for (const turn of pushed)
		if (!push.has(turn)) turn.style.removeProperty("--frozen-subagents");
	pushed.clear();
	for (const [turn, by] of push) {
		turn.style.setProperty("--frozen-subagents", `${by}px`);
		pushed.add(turn);
	}
}

function clockRead(
	scroller: HTMLElement,
	reading: Span,
): { from: number; to: number; turn: HTMLElement } | null {
	let turn: HTMLElement | undefined;
	for (const each of turnElementsIn(scroller))
		if (readTurnMarks(each).startMs <= reading.from) turn = each;
	const lanes = turn?.querySelector<HTMLElement>("[data-run-from]");
	if (!turn || !lanes) return null;
	return {
		from: Number(lanes.dataset.runFrom),
		to: Number(lanes.dataset.runTo),
		turn,
	};
}

function show(scroller: HTMLElement, slot: HTMLElement, reading: Span | null) {
	const read = reading ? clockRead(scroller, reading) : null;
	for (const wrap of slot.querySelectorAll<HTMLElement>("[data-frozen-wrap]")) {
		const launched = launchedOf(scroller, wrap);
		const sticky = wrap.querySelector<HTMLElement>("[data-frozen-subagent]");
		if (!launched || !sticky) continue;
		const launchTurn = turnElementOf(launched);
		const clock =
			read && read.turn !== launchTurn
				? read
				: {
						from: Number(sticky.dataset.launchFrom),
						to: Number(sticky.dataset.launchTo),
					};
		const base = Number(sticky.dataset.clockBase);
		for (const card of [launched, sticky]) {
			if (Number(card.dataset.clockFrom) === clock.from) continue;
			card.dataset.clockFrom = String(clock.from);
			card.dataset.clockTo = String(clock.to);
			card.style.setProperty("--clock-from", String(clock.from - base));
			card.style.setProperty(
				"--clock-span",
				String(Math.max(clock.to - clock.from, 1)),
			);
		}
		for (const card of [launched, sticky]) {
			const from = Number(card.dataset.clockFrom);
			const to = Number(card.dataset.clockTo);
			const total = Math.max(to - from, 1);
			const shown = !!reading && reading.to >= from && reading.from <= to;
			for (const box of card.querySelectorAll<HTMLElement>(
				"[data-frozen-window]",
			)) {
				box.classList.toggle("hidden", !shown);
				if (!shown || !reading) continue;
				const left = Math.max(((reading.from - from) / total) * 100, 0);
				const width =
					((Math.min(reading.to, to) - Math.max(reading.from, from)) / total) *
					100;
				box.style.left = `${left}%`;
				box.style.width = `${Math.max(width, 0.5)}%`;
			}
		}
	}
}

export function FrozenSubagentsLayer({
	onSlot,
}: {
	onSlot: (slot: HTMLElement | null) => void;
}) {
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const [slot, setSlot] = useState<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		onSlot(slot);
		const scroller = readerScrollerOf(slot);
		if (!root || !slot || !scroller) return;
		const visible = new Set<HTMLElement>();
		let last: Span | null = null;
		const pushed = new Set<HTMLElement>();
		const refresh = () => {
			scroller.style.setProperty(
				"--scrollbar",
				`${scroller.offsetWidth - scroller.clientWidth}px`,
			);
			layOut(scroller, root, slot, pushed);
			last = spanOf(visible) ?? last;
			show(scroller, slot, last);
		};
		const onScroll = () => show(scroller, slot, last);
		const seen = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const row = entry.target as HTMLElement;
					if (entry.isIntersecting) visible.add(row);
					else visible.delete(row);
				}
				last = spanOf(visible) ?? last;
				show(scroller, slot, last);
			},
			{ root: scroller },
		);
		const watched = new WeakSet<Element>();
		const resize = new ResizeObserver(() => collect());
		const watch = (row: Element) => {
			if (watched.has(row)) return;
			watched.add(row);
			seen.observe(row);
		};
		const watchRows = () => {
			for (const row of scroller.querySelectorAll(STARTED_ROW)) watch(row);
		};
		const watchAdded = (records: MutationRecord[]) => {
			for (const record of records)
				for (const node of record.addedNodes) {
					if (!(node instanceof Element)) continue;
					if (node.matches(STARTED_ROW)) watch(node);
					for (const row of node.querySelectorAll(STARTED_ROW)) watch(row);
				}
		};
		const collect = () => {
			watchRows();
			for (const held of scroller.querySelectorAll(KEEPS_PICK)) {
				if (watched.has(held)) continue;
				watched.add(held);
				resize.observe(held);
			}
			refresh();
		};
		collect();
		scroller.addEventListener("scroll", onScroll, { passive: true });
		const changes = new MutationObserver(refresh);
		changes.observe(slot, { childList: true });
		const drawn = new MutationObserver(watchAdded);
		drawn.observe(scroller, { childList: true, subtree: true });
		resize.observe(slot);
		const content = readerContentOf(scroller);
		if (content) resize.observe(content);
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			changes.disconnect();
			drawn.disconnect();
			resize.disconnect();
			seen.disconnect();
			for (const turn of pushed)
				turn.style.removeProperty("--frozen-subagents");
			scroller.style.removeProperty("--scrollbar");
			onSlot(null);
		};
	}, [root, slot, onSlot]);
	return (
		<div ref={setRoot} className="relative z-30 -mb-8 hidden h-0 xl:block">
			<div
				ref={setSlot}
				className="pointer-events-none absolute inset-x-0 top-0"
			/>
		</div>
	);
}
