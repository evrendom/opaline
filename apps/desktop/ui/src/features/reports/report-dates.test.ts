import { describe, expect, it } from "vitest";
import { dataWindow, formatDay } from "./report-dates";

const cutoff = "2026-11-07T10:13:26.719Z";

describe("dataWindow", () => {
	it("shows the saved scope when the analysis has one", () => {
		expect(
			dataWindow({
				scope: { from: "2026-10-06", to: "2026-11-03", filters: {} },
				cutoff,
			}),
		).toBe("Data 2026-10-06 to 2026-11-03");
		expect(
			dataWindow({
				scope: { from: "2026-10-06", to: null, filters: {} },
				cutoff,
			}),
		).toBe("Data from 2026-10-06");
		expect(
			dataWindow({
				scope: { from: null, to: "2026-11-03", filters: {} },
				cutoff,
			}),
		).toBe("Data to 2026-11-03");
	});

	it("falls back to the cutoff, labelled as such, without a scope", () => {
		expect(
			dataWindow({ scope: { from: null, to: null, filters: {} }, cutoff }),
		).toBe("Data through Nov 7, 2026");
	});
});

describe("formatDay", () => {
	it("formats in UTC and keeps unparseable input as is", () => {
		expect(formatDay("2026-11-01T23:30:00.000Z")).toBe("Nov 1, 2026");
		expect(formatDay("not a date")).toBe("not a date");
	});
});
