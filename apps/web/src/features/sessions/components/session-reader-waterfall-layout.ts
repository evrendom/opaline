// The waterfall rows' shared layout: one grid for every row (label | track |
// totals), the indent by nesting depth, a row's look when selected or hovered,
// and where a span's bar sits on the track.

/** How far each level of open group's frozen row sits below the one above:
 * a row's height (min-h-10) and the gap after it, in rem. */
export const FROZEN_ROW_REM = 2.625;

/** A row's left padding by nesting depth (`--depth` set inline): one 12px step
 * per level from the root row's 4px, and tighter 8px steps in a narrow
 * container where the label column has less to give. */
export const INDENT =
	"pl-[calc(var(--depth)*8px+4px)] @lg:pl-[calc(var(--depth)*12px+4px)]";

export const GRID =
	"grid grid-cols-[9.5rem_minmax(0,1fr)_3.25rem] @lg:grid-cols-[15rem_minmax(0,1fr)_6.5rem]";

export const ROW =
	"min-h-10 w-full cursor-pointer items-center rounded-md py-1 text-left text-xs @lg:text-sm";

export function rowState(selected: boolean): string {
	return selected
		? "bg-accent dark:bg-accent/70"
		: "hover:bg-accent/80 dark:hover:bg-accent/50";
}

/** Bar geometry on the shared track, clamped so a bar that hits the min-width
 * floor near the end can't spill past the track's right edge. */
export function barGeometry(
	fromMs: number,
	toMs: number,
	startMs: number,
	total: number,
) {
	const offsetMs = fromMs - startMs;
	const durationMs = Math.max(toMs - fromMs, 0);
	const offset = (offsetMs / total) * 100;
	const width = Math.min(
		Math.max((durationMs / total) * 100, 1.5),
		Math.max(100 - offset, 0),
	);
	return { durationMs, offset, offsetMs, width };
}
