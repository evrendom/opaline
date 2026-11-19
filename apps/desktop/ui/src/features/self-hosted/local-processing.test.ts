import { describe, expect, test } from "vitest";
import { initialImportLabel, initialImportOf } from "./local-processing";

describe("initialImportOf", () => {
	test("shows only while the initial import is active, whatever else is queued", () => {
		expect(
			initialImportOf({
				initialImport: { active: true, sessionsDone: 120, sessionsTotal: 438 },
			}),
		).toEqual({ sessionsDone: 120, sessionsTotal: 438 });
		const liveWorkAfterwards = {
			state: "importing",
			sessionsQueued: 3,
			derivedQueued: 12,
			initialImport: { active: false, sessionsDone: 438, sessionsTotal: 438 },
		};
		expect(initialImportOf(liveWorkAfterwards)).toBeNull();
		const olderServer = { state: "importing", sessionsQueued: 3 };
		expect(initialImportOf(olderServer)).toBeNull();
		expect(initialImportOf(null)).toBeNull();
	});
});

describe("initialImportLabel", () => {
	test("counts sessions while they import, then names the remaining work", () => {
		expect(initialImportLabel({ sessionsDone: 120, sessionsTotal: 438 })).toBe(
			"Processing 120 of 438 sessions",
		);
		expect(
			initialImportLabel({ sessionsDone: 1_203, sessionsTotal: 4_380 }),
		).toBe("Processing 1,203 of 4,380 sessions");
		expect(initialImportLabel({ sessionsDone: 438, sessionsTotal: 438 })).toBe(
			"Processing sessions and repos",
		);
		expect(initialImportLabel({ sessionsDone: 0, sessionsTotal: 0 })).toBe(
			"Processing sessions and repos",
		);
	});
});
