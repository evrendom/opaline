import { describe, expect, test } from "bun:test";
import {
	createLiveSessionGate,
	LiveSessionBusyError,
} from "./live-session-gate.js";

describe("createLiveSessionGate", () => {
	test("runs at most maxActive tasks at once and the next waiter when one ends", async () => {
		const gate = createLiveSessionGate({ maxActive: 2, maxWaitMs: 1_000 });
		let active = 0;
		let peak = 0;
		const order: number[] = [];
		await Promise.all(
			[1, 2, 3, 4].map((id) =>
				gate.run(async () => {
					active += 1;
					peak = Math.max(peak, active);
					await Bun.sleep(5);
					order.push(id);
					active -= 1;
				}),
			),
		);
		expect(peak).toBe(2);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	test("refuses a task that waited past maxWaitMs, and frees the slot of a failed task", async () => {
		const gate = createLiveSessionGate({ maxActive: 1, maxWaitMs: 20 });
		let release: () => void = () => {};
		const holding = gate.run(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		await expect(gate.run(async () => "late")).rejects.toBeInstanceOf(
			LiveSessionBusyError,
		);
		release();
		await holding;
		await expect(
			gate.run(async () => {
				throw new Error("task failed");
			}),
		).rejects.toThrow("task failed");
		expect(await gate.run(async () => "free")).toBe("free");
	});
});
