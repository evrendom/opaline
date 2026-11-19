import { describe, expect, test } from "bun:test";
import {
	type CalendarFit,
	columnLabel,
	fitCalendar,
	nearestSlot,
	rowLabel,
	slotKey,
	slotLabel,
	slotPlace,
	slotRowLabel,
} from "./cost-dot-calendar";

const box = { width: 232, height: 172 };

const pitchOf = (fit: CalendarFit) => fit.size + fit.gap;

const span = (fit: CalendarFit, lines: number) =>
	lines * pitchOf(fit) - fit.gap + 2 * fit.inset;

function mustFit(fit: CalendarFit | null): CalendarFit {
	if (!fit) throw new Error("no fit");
	const spareWidth = box.width - fit.gutter - span(fit, fit.columns);
	const spareHeight = box.height - fit.strip - span(fit, fit.rows);
	expect(spareWidth).toBeGreaterThanOrEqual(0);
	expect(spareHeight).toBeGreaterThanOrEqual(0);
	expect(spareWidth).toBeLessThan(2 * pitchOf(fit));
	expect(spareHeight).toBeLessThan(2 * pitchOf(fit));
	return fit;
}

const keys = (fit: CalendarFit, interval: Parameters<typeof slotKey>[1]) =>
	Array.from({ length: fit.rows * fit.columns }, (_, slot) =>
		slotKey(fit, interval, slot),
	);

describe("daily", () => {
	const fit = mustFit(fitCalendar("daily", "2026-10-05", "2026-11-03", box));

	test("a week per column, starting on Monday", () => {
		expect(fit.rows).toBe(7);
		expect(fit.flow).toBe("column");
		expect(slotKey(fit, "daily", 0)).toBe(
			slotKey(fit, "daily", 7)?.replace(/\d\d$/, (day) =>
				String(Number(day) - 7).padStart(2, "0"),
			) ?? "",
		);
		expect(new Date(`${slotKey(fit, "daily", 0)}T00:00:00Z`).getUTCDay()).toBe(
			1,
		);
	});

	test("every day in the range has a box", () => {
		const all = keys(fit, "daily");
		expect(all).toContain("2026-10-05");
		expect(all).toContain("2026-11-03");
	});

	test("rows read M to S", () => {
		expect(rowLabel(fit, "daily", 0)).not.toBe(rowLabel(fit, "daily", 6));
	});

	test("a long range stacks whole weeks per column", () => {
		const year = mustFit(fitCalendar("daily", "2025-11-04", "2026-11-03", box));
		expect(year.rows % 7).toBe(0);
		expect(year.rows).toBeGreaterThan(7);
		expect(keys(year, "daily")).toContain("2025-11-04");
		expect(keys(year, "daily")).toContain("2026-11-03");
	});
});

describe("weekly", () => {
	const fit = mustFit(fitCalendar("weekly", "2026-08-31", "2026-11-02", box));

	test("weeks run in order, left to right and top to bottom", () => {
		expect(fit.flow).toBe("row");
		const all = keys(fit, "weekly");
		const start = all.indexOf("2026-08-31");
		expect(start).toBeGreaterThanOrEqual(0);
		expect(all[start + 1]).toBe("2026-09-07");
		expect(all.slice(start, start + 10)).toEqual([
			"2026-08-31",
			"2026-09-07",
			"2026-09-14",
			"2026-09-21",
			"2026-09-28",
			"2026-10-05",
			"2026-10-12",
			"2026-10-19",
			"2026-10-26",
			"2026-11-02",
		]);
		expect(all.every((key) => key !== null)).toBe(true);
	});

	test("rows are labelled by the week they start with", () => {
		const all = keys(fit, "weekly");
		const second = all[fit.columns];
		expect(rowLabel(fit, "weekly", 1)).toBe(
			new Date(`${second}T00:00:00Z`).toLocaleDateString(undefined, {
				day: "numeric",
				month: "short",
				timeZone: "UTC",
			}),
		);
		expect(fit.gutter).toBeGreaterThan(0);
	});

	test("hovering a week shows its start on the left and its end on top", () => {
		const all = keys(fit, "weekly");
		const slot = all.indexOf("2026-11-02");
		const day = (date: string) =>
			new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
				day: "numeric",
				month: "short",
				timeZone: "UTC",
			});
		expect(slotRowLabel(fit, "weekly", slot)).toBe(day("2026-11-02"));
		expect(slotLabel(fit, "weekly", slot)).toBe(day("2026-11-08"));
	});
});

describe("monthly and quarterly", () => {
	test("monthly is January to December with a row per year", () => {
		const fit = mustFit(
			fitCalendar("monthly", "2025-11-01", "2026-11-01", box),
		);
		expect(fit).toMatchObject({ columns: 12, flow: "row" });
		expect(columnLabel(fit, "monthly", 0)).not.toBe(
			columnLabel(fit, "monthly", 11),
		);
		const all = keys(fit, "monthly");
		expect(all).toContain("2025-11-01");
		expect(all).toContain("2026-11-01");
		const year = Number(fit.origin.slice(0, 4));
		expect(rowLabel(fit, "monthly", 2025 - year)).toBe("’25");
	});

	test("quarterly is Q1 to Q4 with a row per year", () => {
		const fit = mustFit(
			fitCalendar("quarterly", "2025-10-01", "2026-10-01", box),
		);
		expect(fit).toMatchObject({ columns: 4, flow: "row" });
		const all = keys(fit, "quarterly");
		expect(all).toContain("2025-10-01");
		expect(all).toContain("2026-07-01");
		expect(columnLabel(fit, "quarterly", 3)).toBe("Q4");
	});
});

describe("yearly", () => {
	const fit = mustFit(fitCalendar("yearly", "2025-01-01", "2026-01-01", box));

	test("columns are the year's last digit and rows are decades", () => {
		expect(fit).toMatchObject({ columns: 10, flow: "row" });
		const all = keys(fit, "yearly");
		expect(all).toContain("2025-01-01");
		expect(all).toContain("2026-01-01");
		const slot = all.indexOf("2026-01-01");
		expect(slotPlace(fit, slot).column).toBe(6);
		expect(rowLabel(fit, "yearly", slotPlace(fit, slot).row)).toBe("2020s");
		expect(slotLabel(fit, "yearly", slot)).toBe("’26");
	});
});

describe("nearestSlot", () => {
	const fit = mustFit(fitCalendar("daily", "2026-10-05", "2026-11-03", box));

	test("a point in the gap between boxes belongs to the nearest box", () => {
		const pitch = pitchOf(fit);
		const middle = (line: number) => fit.inset + line * pitch + fit.size / 2;
		const gapAfter = (line: number) =>
			fit.inset + line * pitch + fit.size + fit.gap / 4;
		expect(nearestSlot(fit, middle(2), middle(3))).toBe(2 * fit.rows + 3);
		expect(nearestSlot(fit, gapAfter(2), middle(3))).toBe(2 * fit.rows + 3);
		expect(nearestSlot(fit, middle(2), gapAfter(3))).toBe(2 * fit.rows + 3);
	});

	test("points past the edges stay on the edge boxes", () => {
		expect(nearestSlot(fit, -10, -10)).toBe(0);
		expect(nearestSlot(fit, 9999, 9999)).toBe(fit.rows * fit.columns - 1);
	});
});

test("nothing fits in no room", () => {
	expect(
		fitCalendar("daily", "2026-10-05", "2026-11-03", { width: 0, height: 0 }),
	).toBeNull();
});
