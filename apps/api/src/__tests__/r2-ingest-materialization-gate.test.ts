import { describe, expect, test } from "bun:test";
import { createHash, randomFillSync } from "node:crypto";
import { createR2IngestMaterializationGate } from "../services/r2-ingest-materialization-gate.js";

const MEBIBYTE = 1024 * 1024;
const LOAD_BYTES = 101 * MEBIBYTE;

describe("R2 ingest materialization gate", () => {
	test("serializes concurrent 100 MiB+ high-entropy jobs before allocation", async () => {
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * MEBIBYTE,
			maxJobs: 1,
			maxQueuedJobs: 2,
			operationTimeoutMs: 5_000,
			queueTimeoutMs: 5_000,
		});
		let activeJobs = 0;
		let maxActiveJobs = 0;
		let releaseFirst: () => void = () => {};
		const firstMayFinish = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const runLoad = async (hold: Promise<void>): Promise<string> => {
			activeJobs += 1;
			maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
			const bytes = Buffer.allocUnsafe(LOAD_BYTES);
			randomFillSync(bytes);
			await hold;
			const digest = createHash("sha256").update(bytes).digest("hex");
			activeJobs -= 1;
			return digest;
		};

		const first = gate.run(LOAD_BYTES, () => runLoad(firstMayFinish));
		await Promise.resolve();
		const second = gate.run(LOAD_BYTES, () => runLoad(Promise.resolve()));
		expect(gate.getStats()).toEqual({
			activeBytes: LOAD_BYTES,
			activeJobs: 1,
			queuedBytes: LOAD_BYTES,
			queuedJobs: 1,
		});

		releaseFirst();
		const digests = await Promise.all([first, second]);
		expect(digests[0]).not.toBe(digests[1]);
		expect(maxActiveJobs).toBe(1);
		expect(gate.getStats()).toEqual({
			activeBytes: 0,
			activeJobs: 0,
			queuedBytes: 0,
			queuedJobs: 0,
		});
	}, 30_000);

	test("bounds queued jobs and times out queued work", async () => {
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * MEBIBYTE,
			maxJobs: 1,
			maxQueuedJobs: 1,
			operationTimeoutMs: 5_000,
			queueTimeoutMs: 20,
		});
		let releaseActive: () => void = () => {};
		const activeHold = new Promise<void>((resolve) => {
			releaseActive = resolve;
		});
		const active = gate.run(1, async () => {
			await activeHold;
			return "active";
		});
		await Promise.resolve();
		const queued = gate.run(1, async () => "queued");
		await expect(gate.run(1, async () => "overflow")).rejects.toMatchObject({
			code: "R2_INGEST_GATE_FULL",
		});
		await expect(queued).rejects.toMatchObject({
			code: "R2_INGEST_GATE_QUEUE_TIMEOUT",
		});
		expect(gate.getStats().queuedJobs).toBe(0);
		releaseActive();
		await expect(active).resolves.toBe("active");
	});

	test("retains capacity when cancellation cannot settle the operation", async () => {
		const recycleRequested = Promise.withResolvers<Error>();
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * MEBIBYTE,
			maxJobs: 1,
			maxQueuedJobs: 1,
			operationTimeoutMs: 20,
			queueTimeoutMs: 50,
			recycleUnsettledOperation: recycleRequested.resolve,
			unsettledOperationTimeoutMs: 10,
		});
		let observedCancellation = false;
		let nextStarted = false;
		const hung = gate.run(1, async (signal) => {
			signal.addEventListener(
				"abort",
				() => {
					observedCancellation = true;
				},
				{ once: true },
			);
			return new Promise<never>(() => {});
		});
		await Promise.resolve();
		const next = gate.run(1, async () => {
			nextStarted = true;
			return "next";
		});

		await expect(hung).rejects.toMatchObject({
			code: "R2_INGEST_GATE_OPERATION_TIMEOUT",
		});
		expect(observedCancellation).toBe(true);
		await expect(recycleRequested.promise).resolves.toMatchObject({
			code: "R2_INGEST_GATE_OPERATION_TIMEOUT",
		});
		expect(nextStarted).toBe(false);
		expect(gate.getStats()).toEqual({
			activeBytes: 1,
			activeJobs: 1,
			queuedBytes: 1,
			queuedJobs: 1,
		});
		await expect(next).rejects.toMatchObject({
			code: "R2_INGEST_GATE_QUEUE_TIMEOUT",
		});
		expect(nextStarted).toBe(false);
		expect(gate.getStats()).toEqual({
			activeBytes: 1,
			activeJobs: 1,
			queuedBytes: 0,
			queuedJobs: 0,
		});
	});

	test("rejects jobs above the standard budget without a large-job ceiling", async () => {
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * MEBIBYTE,
			maxJobs: 1,
			maxQueuedJobs: 1,
			operationTimeoutMs: 5_000,
			queueTimeoutMs: 5_000,
		});

		expect(gate.maxJobBytes).toBe(128 * MEBIBYTE);
		await expect(
			gate.run(128 * MEBIBYTE + 1, async () => "large"),
		).rejects.toMatchObject({ code: "R2_INGEST_GATE_FULL" });
	});

	test("runs a large job alone and nothing beside it", async () => {
		const gate = createR2IngestMaterializationGate({
			largeJobMaxBytes: 256 * MEBIBYTE,
			maxBytes: 128 * MEBIBYTE,
			maxJobs: 2,
			maxQueuedJobs: 4,
			operationTimeoutMs: 5_000,
			queueTimeoutMs: 5_000,
		});
		const order: string[] = [];
		const hold = (name: string) => {
			let release: () => void = () => {};
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			const run = gate.run(
				name === "large" ? 256 * MEBIBYTE : MEBIBYTE,
				async () => {
					order.push(`start:${name}`);
					await promise;
					order.push(`end:${name}`);
					return name;
				},
			);
			return { release, run };
		};

		expect(gate.maxJobBytes).toBe(256 * MEBIBYTE);
		const small = hold("small");
		await Promise.resolve();
		const large = hold("large");
		await Promise.resolve();
		const after = hold("after");
		await Promise.resolve();
		expect(order).toEqual(["start:small"]);
		expect(gate.getStats()).toMatchObject({ activeJobs: 1, queuedJobs: 2 });

		small.release();
		await small.run;
		await Promise.resolve();
		expect(order).toEqual(["start:small", "end:small", "start:large"]);
		expect(gate.getStats()).toMatchObject({
			activeBytes: 256 * MEBIBYTE,
			activeJobs: 1,
			queuedJobs: 1,
		});

		large.release();
		after.release();
		await expect(Promise.all([large.run, after.run])).resolves.toEqual([
			"large",
			"after",
		]);
		expect(order).toEqual([
			"start:small",
			"end:small",
			"start:large",
			"end:large",
			"start:after",
			"end:after",
		]);
		await expect(
			gate.run(256 * MEBIBYTE + 1, async () => "too large"),
		).rejects.toMatchObject({ code: "R2_INGEST_GATE_FULL" });
	});
});
