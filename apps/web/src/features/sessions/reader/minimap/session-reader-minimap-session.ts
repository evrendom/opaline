import { type RefObject, useLayoutEffect, useRef } from "react";
import type { ReaderLayout } from "../detail/reader-layout";
import {
	readerScrollerOf,
	sessionModelIn,
	turnElementsIn,
} from "../reader-dom";
import {
	type Drawn,
	markReading,
	type minimapBox,
	movesOnMap,
} from "./session-reader-minimap-drawn";
import {
	continuesDrawn,
	type PageSpans,
	readSpans,
	spanMapping,
} from "./session-reader-minimap-hold";
import type { minimapLine } from "./session-reader-minimap-line";
import {
	measure,
	readTurnShape,
	type TurnShape,
	turnHeights,
} from "./session-reader-minimap-measure";
import { modelMap } from "./session-reader-minimap-model";
import {
	packAttempts,
	type SessionMap,
	type SessionMapKey,
	saveSessionMap,
} from "./session-reader-minimap-store";

export const MAX_SCALE = 0.12;

const SETTLE_MS = 200;
const SUBAGENT_ENDED = "[data-subagent][data-subagent-end-ms]";

export type SessionMapRefs = {
	drawnOnce: RefObject<boolean>;
	laidOut: RefObject<Map<string, TurnShape>>;
	reading: RefObject<number>;
	scale: RefObject<number>;
	session: RefObject<Drawn | null>;
	settled: RefObject<boolean>;
	subagents: RefObject<ReturnType<typeof minimapLine>["subagents"]>;
	toPage: RefObject<((y: number) => number) | null>;
};

export function attachSessionMap({
	box,
	content,
	key,
	layout,
	map,
	refs,
	scroller,
	setDrawn,
	stored,
	tags,
}: {
	box: ReturnType<typeof minimapBox>;
	content: Element;
	key: SessionMapKey | null;
	layout: ReaderLayout | null;
	map: HTMLElement;
	refs: SessionMapRefs;
	scroller: HTMLElement;
	setDrawn: (drawn: Drawn) => void;
	stored: SessionMap | null;
	tags: readonly string[];
}): { redraw: () => void; stop: () => void } {
	const keptShapes = new Map<string, TurnShape>(
		stored?.settled ? Object.entries(stored.shapes ?? {}) : [],
	);
	const seen = new Map(keptShapes);
	const trusted = (turnId: string) => {
		const read = refs.laidOut.current.get(turnId);
		if (read) return read.subagents.length === 0;
		return keptShapes.has(turnId) && !layout?.isLaidOut(turnId);
	};
	let keptSettled = stored?.settled === true;
	let drawnSpans: PageSpans | null = null;
	let nowSpans: PageSpans | null = null;
	let mapping: ReturnType<typeof spanMapping> = null;
	const remap = () => {
		mapping = spanMapping(drawnSpans, nowSpans);
		refs.toPage.current = mapping?.toNow ?? null;
	};
	const placeView = () => {
		const scale = refs.scale.current;
		const toMap = (y: number) => (mapping ? mapping.toDrawn(y) : y) * scale;
		const top = toMap(scroller.scrollTop);
		const height = toMap(scroller.scrollTop + scroller.clientHeight) - top;
		box.place(top, height);
		refs.reading.current = markReading(
			scroller,
			top,
			height,
			refs.subagents.current,
		);
	};
	let last: Drawn | null = null;
	let timer = 0;
	const keptParts =
		keptSettled && tags.length === 0 && stored && stored.parts.length > 0
			? stored
			: null;
	const draw = () => {
		timer = 0;
		nowSpans = readSpans(scroller);
		const model = sessionModelIn(scroller);
		if (model && model.length > 0) {
			const modelled = modelMap(model);
			const scale = map.clientHeight / Math.max(modelled.spans.end, 1);
			refs.scale.current = scale;
			const next: Drawn = {
				easing: refs.drawnOnce.current,
				height: map.clientHeight,
				parts: modelled.parts,
				scale,
				width: map.clientWidth,
			};
			if (!last || movesOnMap(last, next)) {
				last = next;
				setDrawn(next);
				box.ease();
				if (next.parts.length > 0) refs.drawnOnce.current = true;
			}
			refs.session.current = last;
			drawnSpans = modelled.spans;
			remap();
			placeView();
			return;
		}
		if (
			last &&
			last.parts.length > 0 &&
			!refs.settled.current &&
			last.height === map.clientHeight &&
			last.width === map.clientWidth &&
			continuesDrawn(drawnSpans, nowSpans)
		) {
			remap();
			placeView();
			return;
		}
		const fromKept =
			!refs.settled.current && (!last || continuesDrawn(drawnSpans, nowSpans))
				? keptParts
				: null;
		const scale = Math.min(
			map.clientHeight /
				Math.max(fromKept?.pageHeight ?? scroller.scrollHeight, 1),
			MAX_SCALE,
		);
		refs.scale.current = scale;
		const settledNow = refs.settled.current;
		for (const [turnId, shape] of refs.laidOut.current) seen.set(turnId, shape);
		const next: Drawn = {
			height: map.clientHeight,
			parts: fromKept?.parts ?? measure(scroller, seen, tags, trusted),
			easing: refs.drawnOnce.current,
			scale,
			width: map.clientWidth,
		};
		if (!last || movesOnMap(last, next)) {
			last = next;
			setDrawn(next);
			box.ease();
			if (next.parts.length > 0) refs.drawnOnce.current = true;
		}
		if (key && (settledNow || !keptSettled)) {
			keptSettled ||= settledNow;
			saveSessionMap(key, {
				pageHeight: scroller.scrollHeight,
				parts: next.parts,
				...(settledNow
					? {
							attempts: layout ? packAttempts(layout.shapes) : undefined,
							heights: {
								...(stored?.settled ? stored.heights : {}),
								...turnHeights(scroller),
							},
							settled: true,
							shapes: Object.fromEntries(seen),
						}
					: {}),
			});
		}
		refs.session.current = next;
		drawnSpans = nowSpans;
		remap();
		placeView();
	};
	draw();
	const settle = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(draw, SETTLE_MS);
	};
	const onScroll = () => {
		box.hold();
		placeView();
		if (timer) settle();
	};
	const resize = new ResizeObserver(() => {
		nowSpans = readSpans(scroller);
		remap();
		placeView();
		settle();
	});
	resize.observe(scroller);
	resize.observe(content);
	scroller.addEventListener("scroll", onScroll, { passive: true });
	return {
		redraw: settle,
		stop: () => {
			refs.toPage.current = null;
			resize.disconnect();
			scroller.removeEventListener("scroll", onScroll);
			window.clearTimeout(timer);
			box.hold();
		},
	};
}

export function useLaidOutShapes(layout: ReaderLayout | null) {
	const laidOut = useRef(new Map<string, TurnShape>());
	useLayoutEffect(() => {
		if (!layout) return;
		const read = (turnId: string, turn: HTMLElement) => {
			const scroller = turn.querySelector(SUBAGENT_ENDED)
				? readerScrollerOf(turn)
				: null;
			const turns = scroller ? turnElementsIn(scroller) : [];
			laidOut.current.set(
				turnId,
				readTurnShape(turn, turns.slice(turns.indexOf(turn) + 1)),
			);
		};
		layout.laidOutListeners.add(read);
		return () => {
			layout.laidOutListeners.delete(read);
		};
	}, [layout]);
	return laidOut;
}
