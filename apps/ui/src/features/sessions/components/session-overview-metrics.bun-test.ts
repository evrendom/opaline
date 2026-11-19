import { describe, expect, test } from "bun:test";
import {
	resolveSessionErrorCount,
	resolveSessionSubagentCount,
} from "./session-overview-metrics";

describe("session overview metric compatibility", () => {
	test("keeps the authoritative subagent count when the API provides it", () => {
		expect(resolveSessionSubagentCount(4, ["reviewer", "tester"])).toBe(4);
	});

	test("falls back to legacy subagent types when the count is absent", () => {
		expect(resolveSessionSubagentCount(undefined, ["reviewer", "tester"])).toBe(
			2,
		);
	});

	test("adds linked children without changing native fallback semantics", () => {
		expect(
			resolveSessionSubagentCount(2, ["reviewer"], 1, [{ model: "gpt-5.5" }]),
		).toBe(3);
		expect(
			resolveSessionSubagentCount(undefined, ["reviewer"], undefined, [
				{ model: "claude-fable-5" },
			]),
		).toBe(2);
	});

	test("distinguishes unavailable error counts from confirmed zero", () => {
		expect(resolveSessionErrorCount(undefined)).toBeNull();
		expect(resolveSessionErrorCount(null)).toBeNull();
		expect(resolveSessionErrorCount(-1)).toBeNull();
		expect(resolveSessionErrorCount(Number.NaN)).toBeNull();
		expect(resolveSessionErrorCount(0)).toBe(0);
		expect(resolveSessionErrorCount(2)).toBe(2);
	});
});
