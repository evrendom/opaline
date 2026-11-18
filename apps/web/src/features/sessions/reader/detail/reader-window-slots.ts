import { SESSION_DETAIL_WINDOW_INITIAL_TURNS } from "@rudel/api-routes";

export const MAX_WINDOWS_IN_FLIGHT = 2;
const WINDOW_REACH = Math.floor(SESSION_DETAIL_WINDOW_INITIAL_TURNS / 2);

type Turns = readonly { turnId: string }[];

const indexes = new WeakMap<Turns, Map<string, number>>();

function indexOf(turns: Turns, turnId: string) {
	let index = indexes.get(turns);
	if (!index) {
		index = new Map(turns.map((turn, at) => [turn.turnId, at]));
		indexes.set(turns, index);
	}
	return index.get(turnId);
}

export function canStartWindow(
	anchors: ReadonlySet<string>,
	turnId: string,
	turns: Turns | undefined,
) {
	if (anchors.size === 0) return true;
	if (anchors.size >= MAX_WINDOWS_IN_FLIGHT || !turns) return false;
	const at = indexOf(turns, turnId);
	if (at === undefined) return false;
	for (const anchor of anchors) {
		const from = indexOf(turns, anchor);
		if (from === undefined || Math.abs(from - at) <= WINDOW_REACH) return false;
	}
	return true;
}
