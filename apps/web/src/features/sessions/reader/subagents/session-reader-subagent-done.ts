import { getRawToolInput } from "@rudel/api-routes";
import type { SessionReaderStep } from "../model/session-reader-model";
import { readTurnMarks } from "../reader-dom";

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

export function subagentTalkedTo(
	step: Partial<
		Pick<SessionReaderStep, "harness" | "notification" | "toolEvent">
	>,
): string | null {
	if (step.harness === "notification" && step.notification?.agent)
		return step.notification.taskId;
	if (step.toolEvent?.toolName !== "SendMessage") return null;
	const to = getRawToolInput(step.toolEvent.input).to;
	return typeof to === "string" && to ? to : null;
}
