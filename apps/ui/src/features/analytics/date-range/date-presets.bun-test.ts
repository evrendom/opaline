import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
	formatDashboardDateRangeTriggerLabel,
	getAnalyticsDatePresets,
} from "./date-presets";

test("shows Today and This week in the selected date tag", () => {
	const today = new Date(2026, 3, 8, 15);
	expect(
		formatDashboardDateRangeTriggerLabel("2026-04-08", "2026-04-08", today),
	).toBe("Today");
	expect(
		formatDashboardDateRangeTriggerLabel("2026-04-06", "2026-04-12", today),
	).toBe("This week");
	expect(
		formatDashboardDateRangeTriggerLabel("2026-04-01", "2026-04-08", today),
	).toBe("Apr 1 - Apr 8, 2026");
});

test.each([
	{ today: new Date(2026, 3, 6), start: "2026-04-06", end: "2026-04-12" },
	{ today: new Date(2026, 3, 8), start: "2026-04-06", end: "2026-04-12" },
	{ today: new Date(2026, 3, 12), start: "2026-04-06", end: "2026-04-12" },
	{ today: new Date(2026, 0, 1), start: "2025-12-29", end: "2026-01-04" },
	{ today: new Date(2026, 2, 29), start: "2026-03-23", end: "2026-03-29" },
])("selects the complete Monday–Sunday week for $today", ({
	today,
	start,
	end,
}) => {
	const preset = getAnalyticsDatePresets().find(({ id }) => id === "this-week");
	assert(preset);
	expect(preset.resolveRange(today)).toEqual({
		startDate: start,
		endDate: end,
	});
	expect(formatDashboardDateRangeTriggerLabel(start, end, today)).toBe(
		"This week",
	);
});
