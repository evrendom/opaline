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
});
