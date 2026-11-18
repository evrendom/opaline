import { expect, test } from "bun:test";
import { isOnUtcDays, sessionsOnUtcDays } from "./session-day-slice";

const day = { start: "2026-11-13", end: "2026-11-13" };

test("a day holds the sessions that started on it in UTC, as the list query counts them", () => {
	const sessions = [
		{ id: "before-midnight", session_date: "2026-11-12T23:59:59Z" },
		{ id: "at-midnight", session_date: "2026-11-13T00:00:00Z" },
		{ id: "late", session_date: "2026-11-13T23:59:59Z" },
		{ id: "next-day", session_date: "2026-11-14T00:00:00Z" },
	];
	expect(sessionsOnUtcDays(sessions, day).map((session) => session.id)).toEqual(
		["at-midnight", "late"],
	);
});

test("a week holds every day from its first to its last", () => {
	const week = { start: "2026-11-10", end: "2026-11-16" };
	expect(isOnUtcDays("2026-11-10T00:00:00Z", week)).toBe(true);
	expect(isOnUtcDays("2026-11-16T23:00:00Z", week)).toBe(true);
	expect(isOnUtcDays("2026-11-17T00:00:00Z", week)).toBe(false);
	expect(isOnUtcDays("2026-11-09T23:59:59.999Z", week)).toBe(false);
});

test("subagent rows keep their order among the day's rows", () => {
	const rows = [
		{ id: "parent", session_date: "2026-11-13T10:00:00Z" },
		{ id: "agent", session_date: "2026-11-13T10:00:00Z" },
		{ id: "other-day", session_date: "2026-11-11T10:00:00Z" },
	];
	expect(sessionsOnUtcDays(rows, day).map((row) => row.id)).toEqual([
		"parent",
		"agent",
	]);
});
