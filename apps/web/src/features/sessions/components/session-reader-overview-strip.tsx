import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	useCallback,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";
import { createSessionContinuousTurnViewportStore } from "./session-continuous-turn-viewport-store";
import { buildSessionDetailOverviewTurnOptions } from "./session-detail-overview-model";
import type { ActiveTurnStore } from "./session-reader-turn-rail";
import type { SessionThreadOverviewStripConfig } from "./session-thread-overview-config";
import type {
	SessionOverviewReadingPosition,
	SessionOverviewReadingSource,
} from "./session-thread-overview-reading-line";
import { SessionThreadOverviewStrip } from "./session-thread-overview-strip";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "./sessions-overview-table-utils";

// The timeline's chart strip over the reader: the session's turns across
// time, a line where you're reading, and a click on one scrolling to it. It
// subscribes to the turn in view itself, so reading along re-renders the
// strip, not the turns.

/** The strip's box: the overview's colors, as the timeline sets them on its
 * page, around just a strip here, not the page — the loading view's chart
 * sits in the same box. */
export const READER_STRIP_CLASS_NAME = cn(
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
	"flex-none shrink-0 overflow-visible px-8 pb-3",
);

// No band tracking the transcript's viewport — the reading line does that —
// and no recorded actions: the transcript below shows those.
const READER_STRIP_CONFIG = {
	showActivity: false,
	showViewportBand: false,
} satisfies Partial<SessionThreadOverviewStripConfig>;

/** How far down the view the reader reads: the top quarter, the band the
 * reader picks the turn in view by. */
const READING_EDGE = 0.25;

type ReadingStore = SessionOverviewReadingSource & {
	set: (position: SessionOverviewReadingPosition | null) => void;
};

function createReadingStore(): ReadingStore {
	let value: SessionOverviewReadingPosition | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => value,
		set(position) {
			if (
				position?.index === value?.index &&
				position?.progress === value?.progress
			) {
				return;
			}
			value = position;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * A ref for the strip that keeps `store` at the reading position: the turn in
 * view, and how far the reading edge has got through its block. Measured once
 * a frame while the reader scrolls, resizes or moves to another turn.
 */
function useReadingPositionRef(
	activeTurn: ActiveTurnStore,
	turns: readonly SessionDetailTurnSummary[],
	store: ReadingStore,
) {
	const turnsRef = useRef(turns);
	turnsRef.current = turns;
	return useCallback(
		(strip: HTMLDivElement | null) => {
			if (!strip) return;
			let frame = 0;
			const measure = () => {
				frame = 0;
				const turnId = activeTurn.get();
				const index = turnsRef.current.findIndex(
					(turn) => turn.turnId === turnId,
				);
				const scroller = strip.parentElement?.querySelector<HTMLElement>(
					"[data-reader-scroll]",
				);
				const block =
					turnId && scroller
						? scroller.querySelector<HTMLElement>(
								`[data-turn-id="${CSS.escape(turnId)}"]`,
							)
						: null;
				if (index < 0 || !scroller || !block) {
					store.set(index < 0 ? null : { index, progress: 0 });
					return;
				}
				const view = scroller.getBoundingClientRect();
				const box = block.getBoundingClientRect();
				const edge = view.top + view.height * READING_EDGE;
				const progress =
					box.height > 0
						? Math.min(Math.max((edge - box.top) / box.height, 0), 1)
						: 0;
				store.set({ index, progress });
			};
			const schedule = () => {
				if (!frame) frame = requestAnimationFrame(measure);
			};
			schedule();
			const unsubscribe = activeTurn.subscribe(schedule);
			// Scroll doesn't bubble, but it does pass the document on the way
			// down.
			document.addEventListener("scroll", schedule, {
				capture: true,
				passive: true,
			});
			window.addEventListener("resize", schedule);
			return () => {
				unsubscribe();
				document.removeEventListener("scroll", schedule, { capture: true });
				window.removeEventListener("resize", schedule);
				cancelAnimationFrame(frame);
			};
		},
		[activeTurn, store],
	);
}

export function ReaderOverviewStrip({
	activeTurn,
	onSelect,
	turns,
}: {
	activeTurn: ActiveTurnStore;
	onSelect: (turnId: string) => void;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const turnInView = useSyncExternalStore(
		activeTurn.subscribe,
		activeTurn.get,
		activeTurn.get,
	);
	const options = useMemo(
		() => buildSessionDetailOverviewTurnOptions(turns),
		[turns],
	);
	// The strip reads a viewport store; with its band off, nothing writes it.
	const [viewportStore] = useState(createSessionContinuousTurnViewportStore);
	const [reading] = useState(createReadingStore);
	const stripRef = useReadingPositionRef(activeTurn, turns, reading);
	const selectedIndex = Math.max(
		turns.findIndex((turn) => turn.turnId === turnInView),
		0,
	);
	return (
		<div ref={stripRef} className={READER_STRIP_CLASS_NAME}>
			<SessionThreadOverviewStrip
				config={READER_STRIP_CONFIG}
				onSelect={(index) => {
					const turn = turns[index];
					if (turn) onSelect(turn.turnId);
				}}
				options={options}
				reading={reading}
				selectedIndex={selectedIndex}
				viewportStore={viewportStore}
			/>
		</div>
	);
}
