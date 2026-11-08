import { readTurnMarks } from "../reader-dom";

export { subagentTalkedTo } from "@rudel/api-routes/session-context/session-reader-subagents";

export type SubagentEnd = { until: string | null };

export function subagentDoneAt(
	trace: Element,
	from: number,
	untilRow: string | null,
	endMs: number,
	later: readonly HTMLElement[] = [],
	self: Element | null = null,
): number {
	const own = untilRow
		? trace.querySelector(`[data-step-row="${CSS.escape(untilRow)}"]`)
		: null;
	const ownAt = own?.getBoundingClientRect().top;
	if (ownAt !== undefined && ownAt > from) return ownAt;
	for (const row of trace.querySelectorAll<HTMLElement>("[data-start-ms]")) {
		if (Number(row.dataset.startMs) < endMs || self?.contains(row)) continue;
		const at = row.getBoundingClientRect().top;
		if (at > from) return at;
	}
	for (const turn of later) {
		const started = readTurnMarks(turn).startMs;
		if (!Number.isFinite(started) || started < endMs) {
			for (const row of turn.querySelectorAll<HTMLElement>("[data-start-ms]"))
				if (Number(row.dataset.startMs) >= endMs)
					return row.getBoundingClientRect().top;
			continue;
		}
		return turn.getBoundingClientRect().top;
	}
	return later.length > 0
		? (later.at(-1) as HTMLElement).getBoundingClientRect().bottom
		: trace.getBoundingClientRect().bottom;
}
