export const READER_SCROLL_MARK = { "data-reader-scroll": "" } as const;
const READER_SCROLL = "[data-reader-scroll]";

export const READER_CONTENT_MARK = { "data-reader-content": "" } as const;

export const TURNS_PENDING_MARK = { "data-turns-pending": "" } as const;
export const TURNS_PENDING = "[data-turns-pending]";

export const KEEPS_PICK_MARK = { "data-keeps-pick": "" } as const;
export const KEEPS_PICK = "[data-keeps-pick]";

export const WATERFALL_MARK = { "data-waterfall": "" } as const;
export const WATERFALL = "[data-waterfall]";

export const KEEPS_PICK_TARGET = `${WATERFALL} button, ${KEEPS_PICK}`;

export const TURN = "[data-turn-id]";

export const LAID_OUT_ATTRIBUTE = "data-laid-out";
export const MEASURING_ATTRIBUTE = "data-measuring";

export const TURN_SLOT_LAYOUT_VARIANTS = {
	[LAID_OUT_ATTRIBUTE]: "not-data-laid-out:min-h-(--turn-kept)",
	[MEASURING_ATTRIBUTE]: "data-measuring:[content-visibility:visible]",
} as const;

export const TURN_SLOT_LAYOUT_CLASS = Object.values(
	TURN_SLOT_LAYOUT_VARIANTS,
).join(" ");

export function markLaidOut(element: HTMLElement): void {
	element.setAttribute(LAID_OUT_ATTRIBUTE, "");
}

export function markMeasuring(element: HTMLElement, on: boolean): void {
	element.toggleAttribute(MEASURING_ATTRIBUTE, on);
}

export const TURN_ANSWER_MARK = { "data-turn-answer": "" } as const;
export const TURN_ANSWER = "[data-turn-answer]";
export const TURN_REPLY_MARK = { "data-turn-reply": "" } as const;
export const TURN_REPLY = "[data-turn-reply]";

const flag = (on: boolean) => (on ? "" : undefined);

export function turnMarks(turn: {
	apology?: boolean;
	errors?: boolean;
	frustrated?: boolean;
	index: number;
	startMs?: number;
	turnId: string;
}) {
	return {
		"data-turn-apology": flag(turn.apology === true),
		"data-turn-errors": flag(turn.errors === true),
		"data-turn-frustrated": flag(turn.frustrated === true),
		"data-turn-id": turn.turnId,
		"data-turn-index": turn.index,
		"data-turn-start-ms": turn.startMs,
	};
}

export function readTurnMarks(element: HTMLElement) {
	const { turnId, turnIndex, turnStartMs } = element.dataset;
	return {
		apology: element.hasAttribute("data-turn-apology"),
		errors: element.hasAttribute("data-turn-errors"),
		frustrated: element.hasAttribute("data-turn-frustrated"),
		index: turnIndex === undefined ? undefined : Number(turnIndex),
		startMs: Number(turnStartMs),
		turnId,
	};
}

export function readerScrollerOf(
	element: Element | null | undefined,
): HTMLElement | null {
	return element?.closest<HTMLElement>(READER_SCROLL) ?? null;
}

export function readerContentOf(scroller: Element): HTMLElement | null {
	return scroller.querySelector<HTMLElement>(":scope > [data-reader-content]");
}

export type PlacedTurn = {
	bottom: number;
	element: HTMLElement | undefined;
	marks: { apology: boolean; errors: boolean; frustrated: boolean };
	top: number;
	turnId: string;
};

const placedTurns = new WeakMap<Element, () => PlacedTurn[] | null>();

export function setPlacedTurns(
	scroller: Element,
	read: () => PlacedTurn[] | null,
): () => void {
	placedTurns.set(scroller, read);
	return () => {
		if (placedTurns.get(scroller) === read) placedTurns.delete(scroller);
	};
}

export function placedTurnsIn(scroller: Element): PlacedTurn[] | null {
	return placedTurns.get(scroller)?.() ?? null;
}

export function turnElementsIn(scroller: ParentNode): HTMLElement[] {
	return [...scroller.querySelectorAll<HTMLElement>(TURN)];
}

export function turnElementOf(element: Element): HTMLElement | null {
	return element.closest<HTMLElement>(TURN);
}
