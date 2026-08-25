import { describe, expect, test } from "bun:test";
import {
	createIngestProcessingSemaphore,
	IngestProcessingCapacityError,
} from "./ingest-processing-ledger.service.js";

describe("ingest processing semaphore", () => {
	test("bounds queued work and admits it after active work releases", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 1_000,
		});
		const releaseActive = await semaphore.acquire();
		const queued = semaphore.acquire();
		await expect(semaphore.acquire()).rejects.toMatchObject({
			code: "INGEST_PROCESSING_QUEUE_FULL",
		});
		releaseActive();
		const releaseQueued = await queued;
		releaseQueued();
	});

	test("times out a bounded waiter", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 20,
		});
		const releaseActive = await semaphore.acquire();
		await expect(semaphore.acquire()).rejects.toBeInstanceOf(
			IngestProcessingCapacityError,
		);
		releaseActive();
	});

	test("cancels a queued waiter", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 1_000,
		});
		const releaseActive = await semaphore.acquire();
		const controller = new AbortController();
		const queued = semaphore.acquire(controller.signal);
		controller.abort(new Error("request cancelled"));
		await expect(queued).rejects.toThrow("request cancelled");
		releaseActive();
	});
});
