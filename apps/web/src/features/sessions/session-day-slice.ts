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
