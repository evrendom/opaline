import { afterEach, expect, test } from "bun:test";
import {
	getAnalyticsDatePresets,
	resolveMatchingAnalyticsPreset,
} from "@/features/analytics/date-range/date-presets";
import { DEMO_NOW, demoClockStart } from "./demo-clock";
import { DEMO_RANGE } from "./demo-runtime";

// Bun ignores later changes once TZ is deleted, so put back the zone by name.
const ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
	process.env.TZ = ZONE;
});

// UTC−11 to UTC+14: Tokyo, Auckland and Kiritimati are past midnight at DEMO_NOW.
const ZONES = [
	"Pacific/Pago_Pago",
	"America/Los_Angeles",
	"UTC",
	"Europe/Berlin",
	"Asia/Kolkata",
	"Asia/Tokyo",
	"Pacific/Auckland",
	"Pacific/Kiritimati",
];

test("every date preset is the same days in every time zone on the demo clock", () => {
	for (const zone of ZONES) {
		process.env.TZ = zone;
		const today = new Date(demoClockStart());
		const ranges = Object.fromEntries(
			getAnalyticsDatePresets().map((preset) => [
				preset.id,
				preset.resolveRange(today),
			]),
		);
		expect({ zone, ranges }).toEqual({
			zone,
			ranges: {
				today: { startDate: "2026-11-27", endDate: "2026-11-27" },
				"this-week": { startDate: "2026-11-23", endDate: "2026-11-29" },
				"last-7-days": { startDate: "2026-11-20", endDate: "2026-11-27" },
				"last-30-days": { startDate: "2026-10-28", endDate: "2026-11-27" },
				"last-60-days": { startDate: "2026-09-28", endDate: "2026-11-27" },
				"last-90-days": { startDate: "2026-08-29", endDate: "2026-11-27" },
				"this-month": { startDate: "2026-11-01", endDate: "2026-11-27" },
				"this-quarter": { startDate: "2026-10-01", endDate: "2026-11-27" },
				"this-year": { startDate: "2026-01-01", endDate: "2026-11-27" },
			},
		});
		expect(
			resolveMatchingAnalyticsPreset(
				DEMO_RANGE.startDate,
				DEMO_RANGE.endDate,
				today,
			)?.id,
		).toBe("last-30-days");
	}
});

test("the clock starts when the data ends wherever that is early enough on its day", () => {
	for (const zone of ["Pacific/Pago_Pago", "UTC", "Europe/Berlin"]) {
		process.env.TZ = zone;
		expect(demoClockStart()).toBe(DEMO_NOW);
	}
	process.env.TZ = "Asia/Tokyo";
	expect(new Date(demoClockStart()).toISOString()).toBe(
		"2026-11-27T13:00:00.000Z",
	);
});
