import { describe, expect, test } from "bun:test";
import {
	hasLargeR2IngestWorkerFiles,
	readLargeR2IngestWorkerState,
} from "./large-r2-ingest-worker-config.js";
import { canMaterializeLargeR2IngestJobs } from "./r2-ingest-materialization-gate.js";

describe("large R2 ingest worker mode", () => {
	test("stays off unless the flag is exactly true", () => {
		for (const value of [undefined, "", "1", "TRUE", "yes"]) {
			expect(
				readLargeR2IngestWorkerState({
					AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "4096",
					R2_LARGE_INGEST_WORKER: value,
				}),
			).toEqual({ enabled: false, memoryMb: 4096, reason: "flag_off" });
		}
	});

	test("refuses a function without the memory for one large session", () => {
		expect(
			readLargeR2IngestWorkerState({
				AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "2048",
				R2_LARGE_INGEST_WORKER: "true",
			}),
		).toEqual({
			enabled: false,
			memoryMb: 2048,
			reason: "insufficient_memory",
		});
	});

	test("enables a 4 GB function with the flag", () => {
		expect(
			readLargeR2IngestWorkerState({
				AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "4096",
				R2_LARGE_INGEST_WORKER: "true",
			}),
		).toEqual({ enabled: true, memoryMb: 4096 });
	});

	test("never lets main Vercel functions materialize large jobs, flag or not", () => {
		expect(
			canMaterializeLargeR2IngestJobs({
				R2_LARGE_INGEST_WORKER: "true",
				VERCEL: "1",
			}),
		).toBe(false);
		expect(canMaterializeLargeR2IngestJobs({})).toBe(true);
	});

	test("finds every Bun worker entry file next to the service", () => {
		expect(hasLargeR2IngestWorkerFiles()).toBe(true);
	});
});
