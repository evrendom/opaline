import { describe, expect, test } from "vitest";
import { isProcessing } from "./local-processing";

describe("isProcessing", () => {
	test("busy while sessions import or their runs and repos are still built", () => {
		expect(isProcessing({ state: "importing", sessionsQueued: 3 })).toBe(true);
		expect(isProcessing({ state: "idle", derivedQueued: 12 })).toBe(true);
		expect(
			isProcessing({ state: "idle", sessionsQueued: 0, derivedQueued: 0 }),
		).toBe(false);
		expect(isProcessing(null)).toBe(false);
	});
});
