import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { SessionTurnEpisode } from "./session-turn-episodes";
import type { SessionTurnTableRow } from "./session-turn-table";
import {
	areSessionTurnTableGeometriesEqual,
	type SessionTurnRowGeometry,
	type SessionTurnTableGeometry,
} from "./session-turn-table-geometry";

const EMPTY_GEOMETRY: SessionTurnTableGeometry = {
	bodyTop: 0,
	headerHeight: 0,
	viewportHeight: 0,
	rows: [],
};

export function useSessionTurnTableGeometry({
	scrollElementRef,
	rows,
	episodeByStartIndex,
	collapsedEpisodeKeys,
}: {
	scrollElementRef: RefObject<HTMLDivElement | null>;
	rows: readonly SessionTurnTableRow[];
	episodeByStartIndex: ReadonlyMap<number, SessionTurnEpisode>;
	collapsedEpisodeKeys: ReadonlySet<string> | undefined;
}) {
	const bodyRef = useRef<HTMLTableSectionElement>(null);
	const [geometry, setGeometry] = useState(EMPTY_GEOMETRY);
	useLayoutEffect(() => {
		// Reordering/filtering and inserting episode separators change row offsets,
		// even when the table's total height stays the same. Viewed state does not.
		void episodeByStartIndex;
		void collapsedEpisodeKeys;
		const body = bodyRef.current;
		const scroll = scrollElementRef.current;
		if (!body || !scroll) return;
		const header = scroll.querySelector("thead");
		let frame: number | undefined;
		const measure = () => {
			frame = undefined;
			const bodyRect = body.getBoundingClientRect();
			const scrollRect = scroll.getBoundingClientRect();
			const measuredRows: SessionTurnRowGeometry[] = [];
			let previousRow: HTMLTableRowElement | undefined;
			for (const element of body.querySelectorAll<HTMLTableRowElement>(
				":scope > tr[data-visible-index]",
			)) {
				const visibleIndex = Number(element.dataset.visibleIndex);
				const row = rows[visibleIndex];
				if (!row) continue;
				const rect = element.getBoundingClientRect();
				measuredRows.push({
					key: row.key,
					visibleIndex,
					top: rect.top - bodyRect.top,
					bottom: rect.bottom - bodyRect.top,
					adjacentToPrevious: element.previousElementSibling === previousRow,
				});
				previousRow = element;
			}
			const next: SessionTurnTableGeometry = {
				bodyTop:
					bodyRect.top - scrollRect.top - scroll.clientTop + scroll.scrollTop,
				headerHeight: header?.getBoundingClientRect().height ?? 0,
				viewportHeight: scroll.clientHeight,
				rows: measuredRows,
			};
			// All DOM reads precede the state write. Selection changes only consume
			// this cache; they never schedule a new measurement.
			setGeometry((previous) =>
				areSessionTurnTableGeometriesEqual(previous, next) ? previous : next,
			);
		};
		const schedule = () => {
			if (frame === undefined) frame = requestAnimationFrame(measure);
		};
		schedule();
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(schedule);
		observer?.observe(body);
		observer?.observe(scroll);
		if (header) observer?.observe(header);
		// Observe separators too: their heights can change independently of rows.
		for (const child of body.children) {
			if (
				child instanceof HTMLTableRowElement &&
				!child.hasAttribute("aria-hidden") &&
				!child.hasAttribute("data-viewed-indicator-group")
			) {
				observer?.observe(child);
			}
		}
		return () => {
			observer?.disconnect();
			if (frame !== undefined) cancelAnimationFrame(frame);
		};
	}, [scrollElementRef, rows, episodeByStartIndex, collapsedEpisodeKeys]);
	return { bodyRef, geometry };
}
