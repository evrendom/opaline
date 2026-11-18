import { describe, expect, test } from "bun:test";
import {
	digestWindow,
	duePeriods,
	periodOf,
	sendDeadline,
	sendTime,
} from "./schedule.js";

// 2026-10-12 is a Monday.
const at = (iso: string) => new Date(iso);
const starts = (kind: "daily" | "weekly", iso: string) =>
	duePeriods(kind, at(iso)).map((period) => period.start);

describe("usage digest schedule", () => {
	test("the weekly digest covers the ISO week before, due all week from Monday 02:00 UTC", () => {
		expect(duePeriods("weekly", at("2026-10-12T02:00:00Z"))).toEqual([
			{
				kind: "weekly",
				start: "2026-10-05",
				end: "2026-10-12",
				previousStart: "2026-09-28",
				previousEnd: "2026-10-05",
			},
		]);
		// Until then the week before last is still the due one.
		expect(starts("weekly", "2026-10-12T01:59:59Z")).toEqual(["2026-09-28"]);
		// Enabled midweek, it still sends the week before.
		expect(starts("weekly", "2026-10-13T14:00:00Z")).toEqual(["2026-10-05"]);
	});

	test("the daily digest covers each weekday, open from the first 19:00 on it until its last midnight", () => {
		expect(duePeriods("daily", at("2026-10-14T17:10:00Z"))).toEqual([
			{
				kind: "daily",
				start: "2026-10-14",
				end: "2026-10-15",
				previousStart: "2026-10-07",
				previousEnd: "2026-10-08",
			},
		]);
		// 19:00 on Wednesday comes first at UTC+14, Wednesday 05:00 UTC; Tuesday is still open.
		expect(starts("daily", "2026-10-14T04:59:59Z")).toEqual(["2026-10-13"]);
		expect(starts("daily", "2026-10-14T05:00:00Z")).toEqual([
			"2026-10-13",
			"2026-10-14",
		]);
		// Wednesday ends last at UTC-12, Thursday 12:00 UTC, by when Thursday is open.
		expect(starts("daily", "2026-10-15T11:59:00Z")).toEqual([
			"2026-10-14",
			"2026-10-15",
		]);
		expect(starts("daily", "2026-10-15T12:00:00Z")).toEqual(["2026-10-15"]);
		// Monday gets a daily too; Saturday and Sunday get none.
		expect(starts("daily", "2026-10-12T18:00:00Z")).toEqual(["2026-10-12"]);
		expect(starts("daily", "2026-10-17T18:00:00Z")).toEqual([]);
		expect(starts("daily", "2026-10-18T18:00:00Z")).toEqual([]);
		// Friday's stays open into Saturday morning for the Americas.
		expect(starts("daily", "2026-10-17T02:00:00Z")).toEqual(["2026-10-16"]);
	});

	test("each member gets the weekly at 09:00 Monday in their time zone, never before the week is ready", () => {
		const week = periodOf("weekly", "2026-10-05");
		// Berlin is on summer time (UTC+2) until 2026-10-25.
		expect(sendTime(week, "Europe/Berlin").toISOString()).toBe(
			"2026-10-12T07:00:00.000Z",
		);
		expect(sendTime(week, "America/New_York").toISOString()).toBe(
			"2026-10-12T13:00:00.000Z",
		);
		expect(sendTime(week, "UTC").toISOString()).toBe(
			"2026-10-12T09:00:00.000Z",
		);
		// 09:00 Monday in Auckland is Sunday evening in UTC: it waits for the week to end.
		expect(sendTime(week, "Pacific/Auckland").toISOString()).toBe(
			"2026-10-12T02:00:00.000Z",
		);
		// Across the change to winter time, Berlin's 09:00 is 08:00 UTC.
		expect(
			sendTime(periodOf("weekly", "2026-10-19"), "Europe/Berlin").toISOString(),
		).toBe("2026-10-26T08:00:00.000Z");
		expect(sendDeadline(week, "Europe/Berlin")).toBeNull();
	});

	test("each member gets the daily at 19:00 that day, until their midnight", () => {
		const tuesday = periodOf("daily", "2026-10-13");
		expect(sendTime(tuesday, "Europe/Berlin").toISOString()).toBe(
			"2026-10-13T17:00:00.000Z",
		);
		expect(sendTime(tuesday, "America/Los_Angeles").toISOString()).toBe(
			"2026-10-14T02:00:00.000Z",
		);
		expect(sendTime(tuesday, "Asia/Tokyo").toISOString()).toBe(
			"2026-10-13T10:00:00.000Z",
		);
		expect(sendDeadline(tuesday, "Europe/Berlin")?.toISOString()).toBe(
			"2026-10-13T22:00:00.000Z",
		);
		expect(sendDeadline(tuesday, "America/Los_Angeles")?.toISOString()).toBe(
			"2026-10-14T07:00:00.000Z",
		);
	});

	test("the daily reads the member's day until 19:00 against the same hours a week before", () => {
		expect(
			digestWindow(periodOf("daily", "2026-10-13"), "Europe/Berlin"),
		).toEqual({
			timeZone: "Europe/Berlin",
			from: Date.parse("2026-10-12T22:00:00Z"),
			to: Date.parse("2026-10-13T17:00:00Z"),
			previousFrom: Date.parse("2026-10-05T22:00:00Z"),
			previousTo: Date.parse("2026-10-06T17:00:00Z"),
		});
		// The weekly reads whole UTC weeks, whoever reads it.
		expect(
			digestWindow(periodOf("weekly", "2026-10-05"), "America/New_York"),
		).toEqual({
			timeZone: "UTC",
			from: Date.parse("2026-10-05T00:00:00Z"),
			to: Date.parse("2026-10-12T00:00:00Z"),
			previousFrom: Date.parse("2026-09-28T00:00:00Z"),
			previousTo: Date.parse("2026-10-05T00:00:00Z"),
		});
	});
});
