import { describe, expect, test } from "bun:test";
import {
	createTranscriptRecordsDeadline,
	TranscriptRecordsDeadlineExceededError,
} from "./transcript-records-deadline.js";

describe("absolute transcript records deadline", () => {
	test("checks the clock after I/O even when the event loop has not delivered the timer", async () => {
		let clock = 100;
		const deadline = createTranscriptRecordsDeadline({
			deadlineAt: 110,
			now: () => clock,
			signal: undefined,
		});
		await expect(
			deadline.wait(async () => {
				clock += 20;
			}),
		).rejects.toBeInstanceOf(TranscriptRecordsDeadlineExceededError);
		expect(deadline.signal.aborted).toBe(true);
		let called = false;
		await expect(
			deadline.wait(async () => {
				called = true;
			}),
		).rejects.toBeInstanceOf(TranscriptRecordsDeadlineExceededError);
		expect(called).toBe(false);
		deadline.dispose();
	});

	test("uses one deadline rather than refreshing it for each wait", async () => {
		let clock = 100;
		const deadline = createTranscriptRecordsDeadline({
			deadlineAt: 110,
			now: () => clock,
			signal: undefined,
		});
		await deadline.wait(async () => {
			clock += 4;
		});
		await deadline.wait(async () => {
			clock += 5;
		});
		await expect(
			deadline.wait(async () => {
				clock++;
			}),
		).rejects.toBeInstanceOf(TranscriptRecordsDeadlineExceededError);
		deadline.dispose();
	});

	test("bounds an unresolved fence or I/O wait and aborts its request signal", async () => {
		const deadline = createTranscriptRecordsDeadline({
			deadlineAt: Date.now() + 20,
			now: Date.now,
			signal: undefined,
		});
		await expect(
			deadline.wait(() => new Promise<void>(() => {})),
		).rejects.toBeInstanceOf(TranscriptRecordsDeadlineExceededError);
		expect(deadline.signal.aborted).toBe(true);
		deadline.dispose();
	});

	test("forwards caller cancellation to in-flight waits and their request signal", async () => {
		const controller = new AbortController();
		const reason = new Error("backfill cancelled");
		const deadline = createTranscriptRecordsDeadline({
			deadlineAt: undefined,
			now: Date.now,
			signal: controller.signal,
		});
		const pending = deadline.wait(() => new Promise<void>(() => {}));
		controller.abort(reason);
		await expect(pending).rejects.toBe(reason);
		expect(deadline.signal.reason).toBe(reason);
		deadline.dispose();
	});

	test("refuses to start work with an already-cancelled request", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled before start"));
		const deadline = createTranscriptRecordsDeadline({
			deadlineAt: undefined,
			now: Date.now,
			signal: controller.signal,
		});
		let called = false;
		await expect(
			deadline.wait(async () => {
				called = true;
			}),
		).rejects.toThrow("cancelled before start");
		expect(called).toBe(false);
		deadline.dispose();
	});
});
