import { describe, expect, test } from "bun:test";
import {
	drainMaintenancePasses,
	hasMaintenanceTimeRemaining,
} from "./bounded-maintenance.js";

describe("bounded maintenance pass draining", () => {
	test("drains a multi-page backlog until a pass reports no more work", async () => {
		let remainingPages = 3;

		const result = await drainMaintenancePasses({
			deadline: { deadlineAt: 1_000, now: () => 0 },
			maxIterations: 10,
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
			deadline: { deadlineAt: 50, now: () => now },
			maxIterations: 10,
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
			deadline: { deadlineAt: 1_000, now: () => 0 },
			maxIterations: 3,
			runPass: async () => ({ hasMore: true }),
		});

		expect(result).toMatchObject({
			hasMore: true,
			iterations: 3,
			stopReason: "max-iterations",
		});
	});

	test("stops an oversized pass between items and reports remaining work", async () => {
		const backlog = ["job-1", "job-2", "job-3", "job-4"];
		let now = 0;
		const deadline = { deadlineAt: 50, now: () => now };
		const incompleteReports: Array<{
			iterations: number;
			stopReason: string;
		}> = [];

		const result = await drainMaintenancePasses({
			deadline,
			maxIterations: 50,
			onIncomplete: (drain) => {
				incompleteReports.push({
					iterations: drain.iterations,
					stopReason: drain.stopReason,
				});
			},
			runPass: async () => {
				let processed = 0;
				while (
					processed < backlog.length &&
					hasMaintenanceTimeRemaining(deadline)
				) {
					processed += 1;
					now += 30;
				}
				return { hasMore: processed < backlog.length, processed };
			},
		});

		expect(result).toMatchObject({
			hasMore: true,
			iterations: 1,
			stopReason: "deadline",
		});
		expect(result.results).toEqual([{ hasMore: true, processed: 2 }]);
		expect(incompleteReports).toEqual([
			{ iterations: 1, stopReason: "deadline" },
		]);
	});
});
