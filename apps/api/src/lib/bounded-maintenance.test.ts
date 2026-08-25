import { describe, expect, test } from "bun:test";
import { drainMaintenancePasses } from "./bounded-maintenance.js";

describe("bounded maintenance pass draining", () => {
	test("drains a multi-page backlog until a pass reports no more work", async () => {
		let remainingPages = 3;

		const result = await drainMaintenancePasses({
			deadlineAt: 1_000,
			maxIterations: 10,
			now: () => 0,
			runPass: async () => {
				remainingPages -= 1;
				return { hasMore: remainingPages > 0 };
			},
		});

		expect(result).toMatchObject({
			hasMore: false,
			iterations: 3,
			stopReason: "complete",
		});
		expect(result.results).toHaveLength(3);
	});

	test("stops starting new passes after the wall-clock deadline", async () => {
		let now = 0;
		let passes = 0;

		const result = await drainMaintenancePasses({
			deadlineAt: 50,
			maxIterations: 10,
			now: () => now,
			runPass: async () => {
				now += 30;
				passes += 1;
				return { hasMore: true };
			},
		});

		expect(passes).toBe(2);
		expect(result).toMatchObject({
			hasMore: true,
			iterations: 2,
			stopReason: "deadline",
		});
	});

	test("caps an always-growing backlog by iteration count", async () => {
		const result = await drainMaintenancePasses({
			deadlineAt: 1_000,
			maxIterations: 3,
			now: () => 0,
			runPass: async () => ({ hasMore: true }),
		});

		expect(result).toMatchObject({
			hasMore: true,
			iterations: 3,
			stopReason: "max-iterations",
		});
	});
});
