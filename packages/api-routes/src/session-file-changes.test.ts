import { describe, expect, test } from "bun:test";
import {
	SessionRunCheckSchema,
	SessionRunStepSchema,
} from "./session-file-changes.js";

const step = (check: unknown) => ({
	agentId: "",
	at: "2026-10-21T10:00:00.000Z",
	check,
	eventId: "e1",
	failed: false,
	kind: "check",
	label: "tsc",
	launched: null,
	paths: [],
	verb: "Ran",
});

describe("a run step's check", () => {
	test("is one of the four checks, or none", () => {
		expect(SessionRunCheckSchema.options).toEqual([
			"build",
			"lint",
			"test",
			"typecheck",
		]);
		for (const check of [...SessionRunCheckSchema.options, null])
			expect(SessionRunStepSchema.parse(step(check)).check).toBe(check);
	});

	test("is no other text", () => {
		expect(SessionRunStepSchema.safeParse(step("deploy")).success).toBe(false);
	});
});
