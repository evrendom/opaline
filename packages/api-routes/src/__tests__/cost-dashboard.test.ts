import { expect, test } from "bun:test";
import { CostDashboardInputSchema } from "../schemas/cost-dashboard.js";

test("defaults to the total chart and allows combined, multi-select dimensions", () => {
	const parsed = CostDashboardInputSchema.parse({
		startDate: "2026-09-01",
		endDate: "2026-09-16",
		members: ["one", "two"],
		models: ["claude-sonnet-4-5"],
	});
	expect(parsed.splitBy).toBe("none");
	expect(parsed.repositories).toEqual([]);
	expect(parsed.members).toHaveLength(2);
});

test("rejects inverted and unbounded cost ranges", () => {
	for (const range of [
		{ startDate: "2026-09-16", endDate: "2026-09-01" },
		{ startDate: "2020-01-01", endDate: "2026-09-16" },
	])
		expect(CostDashboardInputSchema.safeParse(range).success).toBe(false);
});

test("rejects unsupported dimensions and excessive filter values", () => {
	const range = { startDate: "2026-09-01", endDate: "2026-09-16" };
	expect(
		CostDashboardInputSchema.safeParse({ ...range, splitBy: "session_content" })
			.success,
	).toBe(false);
	expect(
		CostDashboardInputSchema.safeParse({
			...range,
			members: Array(101).fill("one"),
		}).success,
	).toBe(false);
	expect(
		CostDashboardInputSchema.safeParse({ ...range, models: ["x".repeat(513)] })
			.success,
	).toBe(false);
});

test("supports bounded multi-select signal and verbatim filters", () => {
	const range = { startDate: "2026-09-01", endDate: "2026-09-16" };
	const defaults = CostDashboardInputSchema.parse(range);
	expect(defaults.signalTypes).toEqual([]);
	expect(defaults.phrases).toEqual([]);
	const selected = CostDashboardInputSchema.parse({
		...range,
		signalTypes: ["modelApologies", "userPositive"],
		phrases: ["Sorry", "Great work"],
		splitBy: "phrases",
	});
	expect(selected.phrases).toEqual(["Sorry", "Great work"]);
	for (const invalid of [
		{ signalTypes: ["swear"] },
		{ phrases: [""] },
		{ phrases: ["x".repeat(4097)] },
		{ phrases: Array(101).fill("Sorry") },
	])
		expect(
			CostDashboardInputSchema.safeParse({ ...range, ...invalid }).success,
		).toBe(false);
});
