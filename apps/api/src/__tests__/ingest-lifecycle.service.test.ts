import { describe, expect, test } from "bun:test";
import {
	createIngestLifecycle,
	IngestShuttingDownError,
} from "../services/ingest-lifecycle.service.js";

describe("ingest lifecycle", () => {
	test("registers an ingest before its operation reaches the first await", async () => {
		const lifecycle = createIngestLifecycle();
		let release: (() => void) | undefined;
		const blocker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ingest = lifecycle.run(async () => {
			await blocker;
			return "done";
		});

		expect(lifecycle.activeCount()).toBe(1);
		release?.();
		expect(await ingest).toBe("done");
		await lifecycle.waitForIdle();
		expect(lifecycle.activeCount()).toBe(0);
	});

	test("rejects new ingestion after shutdown starts while draining active work", async () => {
		const lifecycle = createIngestLifecycle();
		let release: (() => void) | undefined;
		const blocker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const active = lifecycle.run(() => blocker);

		lifecycle.beginShutdown();
		expect(lifecycle.isShuttingDown()).toBe(true);
		await expect(lifecycle.run(async () => "late")).rejects.toBeInstanceOf(
			IngestShuttingDownError,
		);
		release?.();
		await active;
		await lifecycle.waitForIdle();
	});
});
