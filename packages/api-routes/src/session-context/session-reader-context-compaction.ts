import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import { fullestCall } from "./session-reader-context-runs.js";

export function segmentOf(
	turns: readonly SessionDetailTurnSummary[],
	target: SessionDetailTurnSummary,
): SessionDetailTurnSummary[] {
	const at = turns.indexOf(target);
	if (at < 0) return [];
	let start = 0;
	for (let index = at; index >= 0; index -= 1)
		if (compacts(turns[index])) {
			start = index;
			break;
		}
	const next = turns.findIndex((turn, index) => index > at && compacts(turn));
	return turns.slice(start, next < 0 ? undefined : next);
}

const compacts = (turn: SessionDetailTurnSummary | undefined) =>
	(turn?.compactions ?? 0) > 0;

export function fullestOf<T extends SessionDetailTurnSummary>(
	turns: readonly T[],
): T | undefined {
	let best: T | undefined;
	let bestShare = 0;
	for (const each of turns) {
		const share = fullestCall(each)?.share ?? 0;
		if (share > bestShare) {
			best = each;
			bestShare = share;
		}
	}
	return best;
}

export type CompactionSides = {
	with: SessionDetailTurnSummary;
	without: SessionDetailTurnSummary;
};

export function compactionSides(
	turns: readonly SessionDetailTurnSummary[],
	target: SessionDetailTurnSummary,
): CompactionSides | null {
	const at = turns.indexOf(target);
	if (at < 0) return null;
	let start = 0;
	for (let index = at; index >= 0; index -= 1)
		if (compacts(turns[index])) {
			start = index;
			break;
		}
	const next = turns.findIndex((turn, index) => index > at && compacts(turn));
	if (next >= 0) {
		const after = turns.findIndex(
			(turn, index) => index > next && compacts(turn),
		);
		const fullest = fullestOf(turns.slice(next, after < 0 ? undefined : after));
		return fullest ? { with: fullest, without: target } : null;
	}
	if (start > 0 && compacts(turns[start])) {
		let previous = 0;
		for (let index = start - 1; index >= 0; index -= 1)
			if (compacts(turns[index])) {
				previous = index;
				break;
			}
		const fullest = fullestOf(turns.slice(previous, start));
		return fullest ? { with: target, without: fullest } : null;
	}
	return null;
}

export function compactedLater(
	turns: readonly SessionDetailTurnSummary[],
	runs: readonly SessionDetailTurnSummary[],
): Set<string> {
	let last = -1;
	turns.forEach((turn, index) => {
		if (compacts(turn)) last = index;
	});
	return new Set(
		runs
			.filter((run) => turns.indexOf(run) < last)
			.map((run) => `run:${run.turnId}`),
	);
}
