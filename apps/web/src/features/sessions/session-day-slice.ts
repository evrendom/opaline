import { useEffect, useState } from "react";

const FOCUS_SETTLE_MS = 120;
/** The longest range the desktop app holds whole to slice days from. */
export const SLICE_MAX_DAYS = 45;
/** A range with this many rows is asked for day by day instead. */
export const SLICE_ROW_LIMIT = 1000;

export type DayRange = { readonly start: string; readonly end: string };

export function isOnUtcDays(timestamp: string, days: DayRange): boolean {
	const day = timestamp.slice(0, 10);
	return day >= days.start && day <= days.end;
}

export function sessionsOnUtcDays<T extends { readonly session_date: string }>(
	sessions: readonly T[],
	days: DayRange,
): T[] {
	return sessions.filter((session) => isOnUtcDays(session.session_date, days));
}

/** The focus once it has held still for a moment, so passing hovers do not
 * each ask the server; without settling, the focus as it is. */
export function useSettledFocus(focus: DayRange | null, settle: boolean) {
	const delayMs = settle ? FOCUS_SETTLE_MS : 0;
	const key = focus ? `${focus.start}..${focus.end}` : "";
	const [settled, setSettled] = useState<{
		key: string;
		focus: DayRange | null;
	}>({ key, focus });
	useEffect(() => {
		if (delayMs === 0 || settled.key === key) return;
		const timer = window.setTimeout(() => setSettled({ key, focus }), delayMs);
		return () => window.clearTimeout(timer);
	}, [delayMs, key, focus, settled.key]);
	return delayMs === 0 ? focus : settled.focus;
}
