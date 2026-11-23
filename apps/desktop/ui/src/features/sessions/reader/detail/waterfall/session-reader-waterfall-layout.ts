import type { SessionReaderStep } from "../../model/session-reader-run-steps";

export const FROZEN_ROW_REM = 2.625;

export const INDENT =
	"pl-[calc(var(--depth)*var(--space-m)+var(--space-xs))] @lg:pl-[calc(var(--depth)*var(--space-l)+var(--space-xs))]";

// The border step puts the rail on its parent's hairline.
export const MESSAGE_INDENT =
	"ml-[calc(var(--depth)*var(--space-m)+var(--border-m))] @lg:ml-[calc(var(--depth)*var(--space-l)+var(--border-m))]";

export const GRID =
	"grid grid-cols-[9.5rem_minmax(0,1fr)_3.25rem] @lg:grid-cols-[15rem_minmax(0,1fr)_6.5rem]";

export const GRID_TRACK = "right-13 left-38 @lg:right-26 @lg:left-60";

export const GRID_UNTIMED =
	"grid grid-cols-[8.75rem_minmax(0,1fr)_1rem] @lg:grid-cols-[13rem_minmax(0,1fr)_1rem]";

export const GRID_UNTIMED_TRACK = "right-4 left-35 @lg:left-52";

export const ROW =
	"min-h-10 w-full items-center corner-s py-xs text-left text-body-xl";

export function rowState(selected: boolean): string {
	return selected ? "bg-hover" : "hover:bg-hover";
}

export function barGeometry(
	fromMs: number,
	toMs: number,
	startMs: number,
	total: number,
) {
	const offsetMs = fromMs - startMs;
	const durationMs = Math.max(toMs - fromMs, 0);
	const offset = (offsetMs / total) * 100;
	const width = Math.min((durationMs / total) * 100, Math.max(100 - offset, 0));
	return { durationMs, offset, offsetMs, width };
}

export function solidSpan(
	step: Pick<
		SessionReaderStep,
		"backgroundFromMs" | "ci" | "endMs" | "startMs"
	>,
	startMs: number,
	total: number,
): { offset: number; width: number } | null {
	if (step.backgroundFromMs !== undefined)
		return barGeometry(step.startMs, step.backgroundFromMs, startMs, total);
	const started = step.ci?.kind === "job" ? step.ci.startedMs : null;
	if (started === null || started <= step.startMs) return null;
	return barGeometry(started, step.endMs, startMs, total);
}
