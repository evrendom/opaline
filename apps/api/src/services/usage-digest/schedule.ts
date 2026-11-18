/**
 * When each usage digest goes out and which days it covers. The weekly one
 * covers the ISO week before (Monday to Sunday, in UTC days, as the session
 * data is) and reaches each member on Monday at 09:00 in their own time zone.
 * The daily one covers a member's own weekday, Monday to Friday, from
 * midnight until 19:00 in their time zone, and reaches them at 19:00.
 */

export const WEEKLY_SEND_HOUR = 9;
export const DAILY_SEND_HOUR = 19;
/** A week is sent no earlier than this long after it ends, so its last sessions are in. */
const READY_AFTER_MS = 2 * 60 * 60 * 1000;
/** Members whose time zone is unknown get the digests on UTC's clock. */
export const FALLBACK_TIME_ZONE = "UTC";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Clocks run from UTC-12 to UTC+14: the first and the last place a day's 19:00 comes. */
const EARLIEST_OFFSET_MS = 14 * HOUR_MS;
const LATEST_OFFSET_MS = 12 * HOUR_MS;

export type DigestKind = "daily" | "weekly";

export interface DigestPeriod {
	kind: DigestKind;
	/** First day of the period, YYYY-MM-DD (UTC for the weekly, the member's own for the daily). */
	start: string;
	/** Day after the last one, YYYY-MM-DD. */
	end: string;
	/** The period compared against: the week before, or the same weekday a week before. */
	previousStart: string;
	previousEnd: string;
}

/** The instants (ms) one member's digest reads, and the time zone its days are told in. */
export interface DigestWindow {
	timeZone: string;
	from: number;
	to: number;
	previousFrom: number;
	previousTo: number;
}

export function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
	return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** 0 for Monday through 6 for Sunday. */
function weekday(day: string): number {
	return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * The periods whose digests are open at `now`. The weekly: the latest week
 * that ended at least READY_AFTER_MS ago; it stays due until the next one
 * is, so a digest enabled midweek still sends the week before. The daily:
 * each weekday from the first 19:00 on it anywhere (UTC+14) until its last
 * midnight (UTC-12), so at most that day and the day before.
 */
export function duePeriods(kind: DigestKind, now: Date): DigestPeriod[] {
	if (kind === "weekly") {
		const readyDay = utcDay(new Date(now.getTime() - READY_AFTER_MS));
		return [periodOf(kind, addDays(readyDay, -weekday(readyDay) - 7))];
	}
	const today = utcDay(now);
	return [addDays(today, -1), today]
		.filter(
			(day) =>
				weekday(day) < 5 &&
				Date.parse(`${day}T${DAILY_SEND_HOUR}:00:00Z`) - EARLIEST_OFFSET_MS <=
					now.getTime() &&
				now.getTime() <
					Date.parse(`${addDays(day, 1)}T00:00:00Z`) + LATEST_OFFSET_MS,
		)
		.map((day) => periodOf(kind, day));
}

/**
 * When a member gets a period's digest. The weekly: 09:00 on Monday in
 * their time zone, but never before the week is ready (far east of UTC,
 * 09:00 Monday comes before Sunday has ended in UTC). The daily: 19:00 on
 * the day.
 */
export function sendTime(period: DigestPeriod, timeZone: string): Date {
	if (period.kind === "daily")
		return new Date(localTime(period.start, DAILY_SEND_HOUR, timeZone));
	const ready = Date.parse(`${period.end}T00:00:00Z`) + READY_AFTER_MS;
	return new Date(
		Math.max(ready, localTime(period.end, WEEKLY_SEND_HOUR, timeZone)),
	);
}

/**
 * The last moment a member still gets the digest: a daily only until
 * midnight in their time zone, so it never arrives the day after. A weekly
 * has none; it goes out until the next week is due.
 */
export function sendDeadline(
	period: DigestPeriod,
	timeZone: string,
): Date | null {
	return period.kind === "daily"
		? new Date(localTime(period.end, 0, timeZone))
		: null;
}

/**
 * What a member's digest reads: the weekly the UTC weeks; the daily their
 * own day until 19:00, against the same hours a week before, so a day not
 * yet over is never set against a whole one.
 */
export function digestWindow(
	period: DigestPeriod,
	timeZone: string,
): DigestWindow {
	if (period.kind === "weekly")
		return {
			timeZone: "UTC",
			from: Date.parse(`${period.start}T00:00:00Z`),
			to: Date.parse(`${period.end}T00:00:00Z`),
			previousFrom: Date.parse(`${period.previousStart}T00:00:00Z`),
			previousTo: Date.parse(`${period.previousEnd}T00:00:00Z`),
		};
	return {
		timeZone,
		from: localTime(period.start, 0, timeZone),
		to: localTime(period.start, DAILY_SEND_HOUR, timeZone),
		previousFrom: localTime(period.previousStart, 0, timeZone),
		previousTo: localTime(period.previousStart, DAILY_SEND_HOUR, timeZone),
	};
}

/** The instant (ms) when the clock in `timeZone` reads `hour`:00 on `day`. */
function localTime(day: string, hour: number, timeZone: string): number {
	const wall = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
	// The offset at the wall time read as UTC, then again at the result: right across a DST change too.
	const first = wall - offset(wall, timeZone);
	return wall - offset(first, timeZone);
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offset(instant: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(instant));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
	const asUtc = Date.UTC(
		part("year"),
		part("month") - 1,
		part("day"),
		part("hour"),
		part("minute"),
		part("second"),
	);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The period of a queued row. */
export function periodOf(kind: DigestKind, start: string): DigestPeriod {
	const length = kind === "weekly" ? 7 : 1;
	return {
		kind,
		start,
		end: addDays(start, length),
		previousStart: addDays(start, -7),
		previousEnd: addDays(start, length - 7),
	};
}
